"""Answer key management endpoints."""

from __future__ import annotations

import csv
import io
import logging

import google.auth
import google.auth.transport.requests
import requests as http
from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.config import settings
from shared.firestore_client import delete_doc, get_doc, query, upsert
from shared.gemma_client import (
    extract_answer_key_from_image,
    generate_marking_scheme,
)
from shared.models import AnswerKey

logger = logging.getLogger(__name__)
answer_keys_bp = Blueprint("answer_keys", __name__)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _teacher_owns_class(teacher_id: str, class_id: str) -> bool:
    cls = get_doc("classes", class_id)
    return bool(cls and cls.get("teacher_id") == teacher_id)


def _normalise_question(raw: dict, idx: int) -> dict:
    """Map Gemma output (various field names) to AnswerKeyQuestion fields."""
    return {
        "question_number": int(raw.get("question_number") or raw.get("number") or idx + 1),
        "question_text": (raw.get("question_text") or raw.get("text") or "").strip(),
        "answer": (raw.get("answer") or raw.get("correct_answer") or "").strip(),
        "marks": float(raw.get("marks") or raw.get("max_marks") or 1),
        "marking_notes": raw.get("marking_notes"),
    }


def _extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """Extract plain text from PDF, DOCX, or TXT. Returns empty string on failure."""
    try:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext == "pdf":
            import pdfplumber
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        elif ext in ("docx", "doc"):
            from docx import Document
            doc = Document(io.BytesIO(file_bytes))
            return "\n".join(p.text for p in doc.paragraphs)
        elif ext == "txt":
            return file_bytes.decode("utf-8-sig", errors="replace").strip()
    except Exception:
        logger.exception("_extract_text_from_file failed for %s", filename)
    return ""


def _questions_from_file(file_bytes: bytes, filename: str) -> list[dict] | None:
    """
    Process an uploaded file and return normalised question list.
    Returns None if the file type is unsupported.
    Images → Gemma multimodal.
    PDF/DOCX/TXT → extract text → generate_marking_scheme (caller must supply education_level).
    Returns (questions, extracted_text, error) tuple.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    image_exts = {"jpg", "jpeg", "png", "webp", "heic", "heif"}
    if ext in image_exts:
        result = extract_answer_key_from_image(file_bytes)
        qs = result.get("questions", [])
        return [_normalise_question(q, i) for i, q in enumerate(qs)], result.get("title"), None
    elif ext in ("pdf", "docx", "doc", "txt"):
        text = _extract_text_from_file(file_bytes, filename)
        return None, text, None  # caller must call generate_marking_scheme with education_level
    return None, None, f"Unsupported file type: .{ext}"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@answer_keys_bp.get("/answer-keys")
def list_answer_keys():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    class_id = request.args.get("class_id", "").strip()
    if not class_id:
        return jsonify({"error": "class_id query param is required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    results = query("answer_keys", [("class_id", "==", class_id)], order_by="created_at")
    return jsonify(results), 200


@answer_keys_bp.post("/answer-keys")
def create_answer_key():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    is_multipart = "multipart" in (request.content_type or "")

    if is_multipart:
        class_id = (request.form.get("class_id") or "").strip()
        title = (request.form.get("title") or "").strip()
        education_level = (request.form.get("education_level") or "").strip()
        subject = (request.form.get("subject") or "").strip() or None
        question_paper_text = (request.form.get("question_paper_text") or "").strip()
        open_for_submission = request.form.get("open_for_submission", "false").lower() == "true"
        file = request.files.get("file")
        questions_raw = None
    else:
        body = request.get_json(silent=True) or {}
        class_id = (body.get("class_id") or "").strip()
        title = (body.get("title") or "").strip()
        education_level = (body.get("education_level") or "").strip()
        subject = (body.get("subject") or "").strip() or None
        question_paper_text = (body.get("question_paper_text") or "").strip()
        open_for_submission = bool(body.get("open_for_submission", False))
        qs = body.get("questions")
        questions_raw = [_normalise_question(q, i) for i, q in enumerate(qs)] if qs else None
        file = None

    if not class_id or not title:
        return jsonify({"error": "class_id and title are required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    # Auto-lookup education_level from class if not provided
    if not education_level:
        cls = get_doc("classes", class_id)
        education_level = (cls or {}).get("education_level", "")

    generated = False

    # ── File upload processing ────────────────────────────────────────────────
    if file and file.filename:
        file_bytes = file.read()
        filename = (file.filename or "upload").lower()
        qs_from_file, extracted_title_or_text, file_err = _questions_from_file(file_bytes, filename)

        if file_err:
            return jsonify({"error": file_err}), 400

        if qs_from_file is not None:
            # Image path — Gemma returned questions directly
            questions_raw = qs_from_file
            if not title or title == "Auto-generated scheme":
                title = extracted_title_or_text or title
            generated = True
        elif extracted_title_or_text:
            # Text path — need to call generate_marking_scheme
            question_paper_text = extracted_title_or_text

    # ── Text → generate marking scheme ───────────────────────────────────────
    if not questions_raw and question_paper_text:
        scheme = generate_marking_scheme(question_paper_text, education_level)
        questions_raw = [_normalise_question(q, i) for i, q in enumerate(scheme.get("questions", []))]
        if not title or title == "Auto-generated scheme":
            title = scheme.get("title") or title
        generated = True

    # Allow creating with empty questions (teacher sets up marking scheme later)
    if questions_raw is None:
        questions_raw = []

    total_marks = sum(q.get("marks", 0) for q in questions_raw)
    key = AnswerKey(
        class_id=class_id,
        teacher_id=teacher_id,
        title=title,
        education_level=education_level,
        subject=subject,
        questions=questions_raw,
        total_marks=total_marks,
        open_for_submission=open_for_submission,
        generated=generated,
    )
    upsert("answer_keys", key.id, key.model_dump())
    return jsonify(key.model_dump()), 201


@answer_keys_bp.put("/answer-keys/<key_id>")
def update_answer_key(key_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    key = get_doc("answer_keys", key_id)
    if not key:
        return jsonify({"error": "Answer key not found"}), 404
    if key["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    is_multipart = "multipart" in (request.content_type or "")
    updates: dict = {}

    if is_multipart:
        # File upload for auto-generating marking scheme on an existing key
        for field in ("title", "education_level", "subject", "due_date", "status"):
            val = (request.form.get(field) or "").strip()
            if val:
                updates[field] = val
        open_val = request.form.get("open_for_submission")
        if open_val is not None:
            updates["open_for_submission"] = open_val.lower() == "true"

        file = request.files.get("file")
        question_paper_text = (request.form.get("question_paper_text") or "").strip()

        if file and file.filename:
            file_bytes = file.read()
            filename = (file.filename or "upload").lower()
            education_level = updates.get("education_level") or key.get("education_level", "")
            qs_from_file, extracted_title_or_text, file_err = _questions_from_file(file_bytes, filename)

            if file_err:
                return jsonify({"error": file_err}), 400

            if qs_from_file is not None:
                updates["questions"] = qs_from_file
                updates["total_marks"] = sum(q.get("marks", 0) for q in qs_from_file)
                updates["generated"] = True
            elif extracted_title_or_text:
                question_paper_text = extracted_title_or_text

        if not updates.get("questions") and question_paper_text:
            education_level = updates.get("education_level") or key.get("education_level", "")
            scheme = generate_marking_scheme(question_paper_text, education_level)
            qs = [_normalise_question(q, i) for i, q in enumerate(scheme.get("questions", []))]
            updates["questions"] = qs
            updates["total_marks"] = sum(q.get("marks", 0) for q in qs)
            updates["generated"] = True
            if not key.get("title") or key.get("title") == "Auto-generated scheme":
                updates.setdefault("title", scheme.get("title") or key.get("title"))

    else:
        body = request.get_json(silent=True) or {}
        allowed_scalar = {"title", "education_level", "subject", "open_for_submission",
                          "due_date", "status", "generated", "total_marks"}
        updates = {k: v for k, v in body.items() if k in allowed_scalar}

        if "questions" in body:
            qs = body["questions"]
            updates["questions"] = [_normalise_question(q, i) for i, q in enumerate(qs)]
            updates["total_marks"] = sum(q.get("marks", 0) for q in updates["questions"])

        # Auto-generate from question_paper_text on a PUT
        question_paper_text = (body.get("question_paper_text") or "").strip()
        if not updates.get("questions") and question_paper_text:
            education_level = updates.get("education_level") or key.get("education_level", "")
            scheme = generate_marking_scheme(question_paper_text, education_level)
            qs = [_normalise_question(q, i) for i, q in enumerate(scheme.get("questions", []))]
            updates["questions"] = qs
            updates["total_marks"] = sum(q.get("marks", 0) for q in qs)
            updates["generated"] = True
            if not key.get("title") or key.get("title") == "Auto-generated scheme":
                updates.setdefault("title", scheme.get("title") or key.get("title"))

    if not updates:
        return jsonify({"error": "No updatable fields"}), 400

    upsert("answer_keys", key_id, updates)
    return jsonify({**key, **updates}), 200


@answer_keys_bp.post("/answer-keys/<key_id>/close")
def close_answer_key(key_id: str):
    """
    Close submissions for an answer key and trigger the Cloud Run batch grading job.
    POST /api/answer-keys/{id}/close
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    key = get_doc("answer_keys", key_id)
    if not key:
        return jsonify({"error": "Answer key not found"}), 404
    if key["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    # Close submissions
    upsert("answer_keys", key_id, {"open_for_submission": False})

    # Count pending student submissions
    pending = query("student_submissions", [
        ("answer_key_id", "==", key_id),
        ("status", "==", "pending"),
    ])
    pending_count = len(pending)

    if pending_count > 0:
        _trigger_batch_grading_job(key_id)

    return jsonify({
        "message": "Submissions closed, grading started" if pending_count > 0 else "Submissions closed",
        "pending_count": pending_count,
    }), 200


def _trigger_batch_grading_job(answer_key_id: str) -> None:
    """Trigger the Cloud Run Job via the GCP REST API, injecting ANSWER_KEY_ID as an env override."""
    try:
        creds, project = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)

        job_name = (
            f"projects/{settings.GCP_PROJECT_ID}"
            f"/locations/{settings.GCP_REGION}"
            f"/jobs/{settings.CLOUD_RUN_JOB_NAME}"
        )
        url = f"https://run.googleapis.com/v2/{job_name}:run"

        payload = {
            "overrides": {
                "containerOverrides": [{
                    "env": [{"name": "ANSWER_KEY_ID", "value": answer_key_id}],
                }],
            },
        }

        resp = http.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {creds.token}"},
            timeout=15,
        )
        resp.raise_for_status()
        logger.info("Batch grading job triggered for answer_key_id=%s", answer_key_id)
    except Exception:
        logger.exception("Failed to trigger batch grading job for answer_key_id=%s", answer_key_id)


@answer_keys_bp.delete("/answer-keys/<key_id>")
def delete_answer_key(key_id: str):
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    key = get_doc("answer_keys", key_id)
    if not key:
        return jsonify({"error": "Answer key not found"}), 404
    if key["teacher_id"] != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    delete_doc("answer_keys", key_id)
    return jsonify({"message": "deleted"}), 200
