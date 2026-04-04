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

import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.annotator import annotate_image
from shared.auth import require_role
from shared.config import settings
from shared.firestore_client import get_doc, query, upsert
from shared.gcs_client import upload_bytes
from shared.gemma_client import check_image_quality, grade_submission
from shared.models import GradingVerdict, Mark

logger = logging.getLogger(__name__)
mark_bp = Blueprint("mark", __name__)

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

    # Expect multipart/form-data: image file + JSON fields
    image_file = request.files.get("image")
    if not image_file:
        return jsonify({"error": "image file is required"}), 400

    student_id = (request.form.get("student_id") or "").strip()
    answer_key_id = (request.form.get("answer_key_id") or "").strip()

    if not student_id or not answer_key_id:
        return jsonify({"error": "student_id and answer_key_id are required"}), 400

    image_bytes = image_file.read()

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

    # ── 2. Grade (Gemma 4 reads handwriting directly) ─────────────────────────
    raw_verdicts = grade_submission(image_bytes, answer_key, education_level)

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

    # ── 5. Upload to Cloud Storage ────────────────────────────────────────────
    blob_name = f"{student_id}/{uuid.uuid4()}.jpg"
    marked_url = upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes)

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

    # ── 7. Return result ──────────────────────────────────────────────────────
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
    allowed = {"score", "approved", "verdicts"}
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
