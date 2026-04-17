"""
Marking pipeline endpoint — POST /api/mark

Pipeline:
  1. Image quality gate (Gemma 4 multimodal)
  2. Grade against answer key (Gemma 4 multimodal — reads handwriting directly)
  3. Optional: bounding boxes from Document AI for pixel-accurate annotation
  4. Annotate image (Pillow)
  5. Upload annotated image to Cloud Storage
  6. Write Mark to Firestore
  7. Return JSON result
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.annotator import annotate_image
from shared.auth import require_role
from shared.config import settings
from shared.firestore_client import get_doc, increment_field, query, upsert
from shared.gcs_client import generate_signed_url, upload_bytes
from shared.gemma_client import check_image_quality, grade_submission
from shared.guardrails import log_ai_interaction, validate_output
from shared.models import GradingVerdict, Mark
from shared.router import AIRequestType, route_ai_request
from shared.user_context import get_user_context

logger = logging.getLogger(__name__)
mark_bp = Blueprint("mark", __name__)

# ─── Upload size limit ────────────────────────────────────────────────────────
_MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20 MB

# ─── Per-teacher daily rate limit ────────────────────────────────────────────
_MARK_DAILY_LIMIT = 500


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _mark_usage_doc_id(teacher_id: str) -> str:
    return f"mark_{teacher_id}_{_today_utc()}"


def _check_mark_rate_limit(teacher_id: str) -> bool:
    """Return True if the teacher is within the daily marking limit."""
    doc = get_doc("mark_usage", _mark_usage_doc_id(teacher_id))
    return not doc or doc.get("count", 0) < _MARK_DAILY_LIMIT


def _increment_mark_usage(teacher_id: str) -> None:
    doc_id = _mark_usage_doc_id(teacher_id)
    if get_doc("mark_usage", doc_id):
        increment_field("mark_usage", doc_id, "count")
    else:
        upsert("mark_usage", doc_id, {
            "teacher_id": teacher_id,
            "date": _today_utc(),
            "count": 1,
        })


_QUALITY_REJECTION: dict[str, str] = {
    "low light":     "The photo is too dark. Move to better lighting and try again.",
    "underexposed":  "The photo is too dark. Move to better lighting and try again.",
    "blur":          "The photo is blurry. Hold your phone steady and retake.",
    "out of focus":  "The photo is blurry. Hold your phone steady and retake.",
    "cut off":       "Part of the page is cut off. Step back and make sure the whole page is visible.",
    "glare":         "There is glare or shadow covering the text. Adjust the angle and retake.",
    "shadow":        "There is glare or shadow covering the text. Adjust the angle and retake.",
    "tilted":        "The page appears tilted. Straighten the book and retake.",
    "rotated":       "The page appears tilted. Straighten the book and retake.",
    "not a document": "That doesn't look like a page. Please photograph the student's exercise book.",
}


def _quality_message(reason: str) -> str:
    reason_lower = reason.lower()
    for keyword, msg in _QUALITY_REJECTION.items():
        if keyword in reason_lower:
            return msg
    return f"Image rejected: {reason}. Please retake."


@mark_bp.post("/mark")
def mark():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    # ── Rate limit ────────────────────────────────────────────────────────────
    if not _check_mark_rate_limit(teacher_id):
        return jsonify({
            "error": f"Daily marking limit of {_MARK_DAILY_LIMIT} reached. Resets at midnight UTC."
        }), 429

    # Expect multipart/form-data: image file + JSON fields
    image_file = request.files.get("image")
    if not image_file:
        return jsonify({"error": "image file is required"}), 400

    student_id = (request.form.get("student_id") or "").strip()
    answer_key_id = (request.form.get("answer_key_id") or "").strip()

    if not student_id or not answer_key_id:
        return jsonify({"error": "student_id and answer_key_id are required"}), 400

    # ── Image size guard ──────────────────────────────────────────────────────
    image_file.seek(0, 2)
    if image_file.tell() > _MAX_IMAGE_BYTES:
        return jsonify({"error": "Image too large (max 20 MB)"}), 413
    image_file.seek(0)

    image_bytes = image_file.read()

    # ── Route: all AI calls in this endpoint go to cloud ─────────────────────
    route_ai_request(AIRequestType.GRADING)  # always AIRoute.CLOUD on the backend

    # ── 1. Image quality gate ─────────────────────────────────────────────────
    quality = check_image_quality(image_bytes)
    if not quality.get("pass", True):
        msg = _quality_message(quality.get("reason", ""))
        return jsonify({"error": "image_quality_rejected", "message": msg}), 422

    # ── Fetch answer key and class info ───────────────────────────────────────
    answer_key = get_doc("answer_keys", answer_key_id)
    if not answer_key:
        return jsonify({"error": "Answer key not found"}), 404
    if answer_key["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

    class_doc = get_doc("classes", answer_key["class_id"])
    education_level = answer_key.get("education_level") or (
        class_doc.get("education_level") if class_doc else "Form 4"
    )

    # ── 2. Grade (Gemma 4 reads handwriting directly, with RAG context) ─────────
    class_id_for_ctx = answer_key.get("class_id") or (class_doc.get("id") if class_doc else None)
    user_ctx = get_user_context(teacher_id, "teacher", class_id=class_id_for_ctx)
    _t0 = time.time()
    raw_verdicts = grade_submission(image_bytes, answer_key, education_level,
                                    user_context=user_ctx)
    _latency_ms = int((time.time() - _t0) * 1000)

    # ── Output guardrails: validate grading JSON ──────────────────────────────
    _max_marks = float(answer_key.get("total_marks") or sum(
        q.get("marks", 0) for q in answer_key.get("questions", [])
    ) or 1)
    _raw_json = json.dumps(raw_verdicts) if isinstance(raw_verdicts, list) else str(raw_verdicts)
    # Validate each verdict's awarded_marks against total
    _total_awarded = sum(v.get("awarded_marks", 0) for v in raw_verdicts if isinstance(v, dict))
    _verdict_json = json.dumps({"score": _total_awarded})
    valid_out, _out_err = validate_output(
        _verdict_json, role="grading", context={"max_marks": _max_marks}
    )
    if not valid_out:
        log_ai_interaction(
            teacher_id, "teacher", "grading", answer_key_id, _raw_json,
            tokens_used=0, latency_ms=_latency_ms, blocked=True, block_reason=_out_err,
        )
        return jsonify({"error": "Grading response failed validation. Please retry."}), 422

    verdicts = [GradingVerdict(**v) for v in raw_verdicts if isinstance(v, dict)]
    score = sum(v.awarded_marks for v in verdicts)
    max_score = sum(v.max_marks for v in verdicts) or float(answer_key.get("total_marks", 1))
    percentage = round(score / max_score * 100, 1) if max_score else 0.0

    # ── 3. Optional bounding boxes for annotation ─────────────────────────────
    bounding_boxes: list[dict] = []
    if settings.DOCAI_PROCESSOR_ID:
        try:
            from shared.ocr_client import extract_text_with_boxes
            _, bounding_boxes = extract_text_with_boxes(image_bytes, mime_type="image/jpeg")
        except Exception:
            logger.warning("Document AI bounding boxes unavailable — annotating without.")

    # ── 4. Annotate image ─────────────────────────────────────────────────────
    verdicts_dicts = [v.model_dump() for v in verdicts]
    annotated_bytes = annotate_image(image_bytes, verdicts_dicts, bounding_boxes or None)

    # ── 5. Upload to Cloud Storage (private) ─────────────────────────────────
    blob_name = f"{student_id}/{uuid.uuid4()}.jpg"
    upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes, public=False)
    # Generate a 7-day signed URL for the response and persistent storage.
    marked_url = generate_signed_url(settings.GCS_BUCKET_MARKED, blob_name, expiry_minutes=60 * 24 * 7)

    # ── 6. Write Mark to Firestore ────────────────────────────────────────────
    mark_doc = Mark(
        student_id=student_id,
        class_id=answer_key["class_id"],
        answer_key_id=answer_key_id,
        teacher_id=teacher_id,
        score=score,
        max_score=max_score,
        percentage=percentage,
        verdicts=verdicts,
        marked_image_url=marked_url,
        source="teacher_scan",
        approved=True,
    )
    upsert("marks", mark_doc.id, mark_doc.model_dump())
    _increment_mark_usage(teacher_id)

    # ── Audit log ─────────────────────────────────────────────────────────────
    log_ai_interaction(
        teacher_id, "teacher", "grading", answer_key_id, json.dumps(verdicts_dicts),
        tokens_used=len(verdicts_dicts) * 10, latency_ms=_latency_ms, blocked=False,
    )

    # ── 7. Notify student ──────────────────────────────────────────────────────
    try:
        from functions.push import send_student_notification
        student_doc = get_doc("students", student_id)
        student_name = f"{(student_doc or {}).get('first_name', '')} {(student_doc or {}).get('surname', '')}".strip() or "Student"
        hw_title = answer_key.get("title") or answer_key.get("subject") or "Assignment"
        send_student_notification(
            student_id,
            "Your work has been marked",
            f"{hw_title}: {score}/{max_score} ({percentage}%)",
            {"screen": "StudentResults", "mark_id": mark_doc.id},
        )
    except Exception:
        pass  # non-fatal

    # ── 8. Return result ──────────────────────────────────────────────────────
    return jsonify({
        "mark_id": mark_doc.id,
        "score": score,
        "max_score": max_score,
        "percentage": percentage,
        "marked_image_url": marked_url,
        "verdicts": verdicts_dicts,
    }), 200


@mark_bp.put("/marks/<mark_id>")
def update_mark(mark_id: str):
    """Teacher reviews and overrides a mark."""
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    mark_doc = get_doc("marks", mark_id)
    if not mark_doc:
        return jsonify({"error": "Mark not found"}), 404
    if mark_doc["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    allowed = {"score", "approved", "verdicts", "overall_feedback", "manually_edited", "feedback"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if "score" in updates and "max_score" in mark_doc:
        updates["percentage"] = round(
            float(updates["score"]) / float(mark_doc["max_score"]) * 100, 1
        )

    upsert("marks", mark_id, updates)
    return jsonify({**mark_doc, **updates}), 200


@mark_bp.get("/marks/student/<student_id>")
def student_marks(student_id: str):
    """Student fetches their own marks."""
    req_student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    if req_student_id != student_id:
        return jsonify({"error": "forbidden"}), 403

    results = query(
        "marks",
        [("student_id", "==", student_id), ("approved", "==", True)],
        order_by="timestamp",
        direction="DESCENDING",
    )
    return jsonify(results), 200
