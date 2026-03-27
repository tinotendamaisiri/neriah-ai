# functions/mark.py
# POST /api/mark — Azure Functions HTTP trigger (App channel).
# Also exposes run_marking(MarkingRequest) -> MarkingResult, called directly
# by the WhatsApp webhook handler after downloading the image from the Media API.
#
# Pipeline order (see CLAUDE.md Section 7):
#   Step 1  Quality gate        (WhatsApp source only)
#   Step 2  Upload raw scan     → Azure Blob Storage (scans/)
#   Step 3  OCR                 → Azure Document Intelligence
#   Step 4  Load answer key     → Cosmos DB
#   Step 5  Grade               → GPT-4o-mini
#   Step 6  Group regions       → spatial bounding-box clustering
#   Step 7  Annotate            → Pillow (wrapped in try/except — must not block marking)
#   Step 8  Upload annotated    → Azure Blob Storage (marked/)
#   Step 9  Write Mark record   → Cosmos DB
#   Step 10 Return MarkingResult

from __future__ import annotations

import json
import logging
from typing import Optional
from uuid import uuid4

import azure.functions as func
from pydantic import BaseModel

from shared.annotator import annotate_image
from shared.blob_client import generate_sas_url, upload_marked, upload_scan
from shared.cosmos_client import get_item, upsert_item
from shared.models import AnswerKey, GradingVerdict, Mark
from shared.ocr_client import analyse_image, group_answer_regions
from shared.openai_client import check_image_quality, grade_submission

logger = logging.getLogger(__name__)

# ── Local request / result models ────────────────────────────────────────────

class MarkingRequest(BaseModel):
    teacher_id: str
    student_id: str
    class_id: str
    answer_key_id: str
    education_level: str
    image_bytes: bytes
    source: str = "app"   # "app" or "whatsapp"


class MarkingResult(BaseModel):
    mark_id: str
    student_id: str
    score: float
    max_score: float
    marked_image_url: Optional[str]
    verdicts: list[GradingVerdict]
    quality_passed: bool = True


# ── Azure Functions HTTP trigger ──────────────────────────────────────────────

bp = func.Blueprint()


@bp.route(route="mark", methods=["POST"])
async def mark(req: func.HttpRequest) -> func.HttpResponse:
    """REST endpoint consumed by the React Native App.

    Expects multipart/form-data with fields:
        image         — binary JPEG/PNG
        teacher_id    — str
        student_id    — str
        class_id      — str
        answer_key_id — str
        education_level — str
        source        — "app" (default) | "whatsapp"

    Returns JSON-serialised MarkingResult.
    """
    try:
        body = req.get_json()
        request = MarkingRequest(
            teacher_id=body["teacher_id"],
            student_id=body["student_id"],
            class_id=body["class_id"],
            answer_key_id=body["answer_key_id"],
            education_level=body["education_level"],
            image_bytes=req.get_body(),
            source=body.get("source", "app"),
        )
    except (KeyError, ValueError) as exc:
        return func.HttpResponse(
            json.dumps({"error": f"Invalid request: {exc}"}),
            status_code=400,
            mimetype="application/json",
        )

    try:
        result = await run_marking(request)
        return func.HttpResponse(
            result.model_dump_json(),
            status_code=200,
            mimetype="application/json",
        )
    except Exception as exc:
        logger.exception("Marking pipeline error for student=%s: %s", request.student_id, exc)
        return func.HttpResponse(
            json.dumps({"error": "Internal server error"}),
            status_code=500,
            mimetype="application/json",
        )


# ── Core pipeline ─────────────────────────────────────────────────────────────

async def run_marking(request: MarkingRequest) -> MarkingResult:
    """Execute the full marking pipeline and return a MarkingResult.

    Called by the HTTP trigger above (App channel) and directly by
    whatsapp_webhook._handle_image_submission (WhatsApp channel).

    Only Step 7 (annotation) is wrapped in try/except — all other failures
    propagate so the caller can handle them (e.g. send an error message to the teacher).
    """
    logger.info("run_marking start student_id=%s source=%s", request.student_id, request.source)

    # ── Step 1: Quality gate (WhatsApp only) ─────────────────────────────────
    if request.source == "whatsapp":
        logger.debug("Step 1: quality gate")
        quality = await check_image_quality(request.image_bytes)
        if not quality.pass_check:
            logger.info(
                "Quality gate FAILED student_id=%s reason=%s",
                request.student_id, quality.reason,
            )
            return MarkingResult(
                mark_id=str(uuid4()),
                student_id=request.student_id,
                score=0.0,
                max_score=0.0,
                marked_image_url=None,
                verdicts=[],
                quality_passed=False,
            )

    # ── Step 2: Upload raw scan ───────────────────────────────────────────────
    logger.debug("Step 2: upload raw scan")
    scan_filename = (
        f"{request.teacher_id}/{request.class_id}"
        f"/{request.student_id}/{uuid4()}.jpg"
    )
    await upload_scan(request.image_bytes, scan_filename)

    # ── Step 3: OCR ──────────────────────────────────────────────────────────
    logger.debug("Step 3: OCR")
    ocr_text, bounding_box = await analyse_image(request.image_bytes)

    # ── Step 4: Load answer key ───────────────────────────────────────────────
    logger.debug("Step 4: load answer key id=%s", request.answer_key_id)
    answer_key_doc = await get_item(
        "answer_keys", request.answer_key_id, request.class_id
    )
    if answer_key_doc is None:
        raise ValueError(f"Answer key {request.answer_key_id} not found")
    answer_key = AnswerKey(**answer_key_doc)

    # ── Step 5: Grade ─────────────────────────────────────────────────────────
    logger.debug("Step 5: grade submission education_level=%s", request.education_level)
    verdicts: list[GradingVerdict] = await grade_submission(
        ocr_text, answer_key, request.education_level
    )

    # ── Step 6: Group answer regions ──────────────────────────────────────────
    logger.debug("Step 6: group answer regions")
    regions = await group_answer_regions(bounding_box, answer_key)

    # ── Step 7: Annotate ──────────────────────────────────────────────────────
    # Wrapped in try/except — annotation failure must not prevent the mark being stored.
    logger.debug("Step 7: annotate image")
    annotated_bytes: bytes | None = None
    try:
        annotated_bytes = annotate_image(request.image_bytes, regions, verdicts)
    except Exception as exc:
        logger.error(
            "Annotation failed for student_id=%s — mark will be stored without image: %s",
            request.student_id, exc,
        )

    # ── Step 8: Upload annotated image ────────────────────────────────────────
    logger.debug("Step 8: upload annotated image")
    marked_image_url: str | None = None
    if annotated_bytes is not None:
        marked_filename = (
            f"{request.teacher_id}/{request.class_id}"
            f"/{request.student_id}/marked_{uuid4()}.jpg"
        )
        await upload_marked(annotated_bytes, marked_filename)
        marked_image_url = generate_sas_url(
            settings_container_marked(), marked_filename, expiry_hours=168
        )

    # ── Step 9: Write Mark to Cosmos ──────────────────────────────────────────
    logger.debug("Step 9: write mark to Cosmos")
    score = sum(v.awarded_marks for v in verdicts)
    max_score = sum(q.max_marks for q in answer_key.questions)

    mark = Mark(
        teacher_id=request.teacher_id,
        student_id=request.student_id,
        answer_key_id=request.answer_key_id,
        score=score,
        max_score=max_score,
        marked_image_url=marked_image_url,
        raw_ocr_text=ocr_text,
    )
    await upsert_item("marks", mark.model_dump(mode="json"))

    # ── Step 10: Return ───────────────────────────────────────────────────────
    logger.info(
        "run_marking complete student_id=%s score=%.1f/%.1f",
        request.student_id, score, max_score,
    )
    return MarkingResult(
        mark_id=mark.id,
        student_id=request.student_id,
        score=score,
        max_score=max_score,
        marked_image_url=marked_image_url,
        verdicts=verdicts,
        quality_passed=True,
    )


# ── Helper ────────────────────────────────────────────────────────────────────

def settings_container_marked() -> str:
    """Return the marked-images container name from config.
    Imported lazily so the module loads without credentials present.
    """
    from shared.config import settings
    return settings.azure_storage_container_marked
