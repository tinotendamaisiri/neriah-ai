"""Answer key management endpoints."""

from __future__ import annotations

import csv
import io
import logging
import uuid
from datetime import datetime, timezone

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
    generate_marking_scheme_from_image,
)
from shared.models import AnswerKey
from shared.user_context import get_user_context

logger = logging.getLogger(__name__)
answer_keys_bp = Blueprint("answer_keys", __name__)
homework_bp = Blueprint("homework", __name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


# ── Generate marking scheme from question paper image ─────────────────────────

@answer_keys_bp.post("/answer-keys/generate")
def generate_answer_key_scheme():
    """
    POST /api/answer-keys/generate

    Upload a question paper image and get a generated marking scheme back for
    review. Does NOT save to Firestore — the teacher reviews and edits the
    scheme, then saves it via POST /api/answer-keys.

    Request: multipart/form-data
      image          — question paper image file (required)
      education_level — e.g. "Form 2" (required)
      class_id        — the class this will be used for (required)
      subject         — optional subject name hint
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    image_file = request.files.get("image")
    if not image_file:
        return jsonify({"error": "image file is required"}), 400

    education_level = (request.form.get("education_level") or "").strip()
    class_id = (request.form.get("class_id") or "").strip()
    subject = (request.form.get("subject") or "").strip() or None

    if not education_level:
        return jsonify({"error": "education_level is required"}), 400
    if not class_id:
        return jsonify({"error": "class_id is required"}), 400

    if not _teacher_owns_class(teacher_id, class_id):
        return jsonify({"error": "forbidden"}), 403

    image_bytes = image_file.read()
    user_ctx = get_user_context(teacher_id, "teacher", class_id=class_id)
    scheme = generate_marking_scheme_from_image(image_bytes, education_level, subject,
                                                user_context=user_ctx)

    if "error" in scheme:
        return jsonify({"error": scheme["error"]}), 422

    return jsonify({"generated": True, "scheme": scheme}), 200


# ── Generate marking scheme from an already-saved homework image ─────────────

def _download_image_from_url(url: str) -> bytes:
    """Download image bytes from a gs:// or https:// URL."""
    if url.startswith("gs://"):
        from google.cloud import storage
        from shared.config import settings as _s
        parts = url[5:].split("/", 1)
        bucket_name, blob_path = parts[0], parts[1]
        client = storage.Client(project=_s.GCP_PROJECT_ID)
        return client.bucket(bucket_name).blob(blob_path).download_as_bytes()
    else:
        import google.auth
        import google.auth.transport.requests
        import requests as _http
        creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        auth_req = google.auth.transport.requests.Request()
        creds.refresh(auth_req)
        resp = _http.get(url, headers={"Authorization": f"Bearer {creds.token}"}, timeout=30)
        resp.raise_for_status()
        return resp.content


@homework_bp.post("/homework/<homework_id>/generate-scheme")
def generate_scheme_from_homework(homework_id: str):
    """
    POST /api/homework/{homework_id}/generate-scheme

    Generate a marking scheme from the question paper image already stored on
    an existing homework (answer key) document. The homework must have a
    'question_paper_url' field pointing to a GCS image.

    Returns the generated scheme for review — does NOT save to Firestore.
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    homework = get_doc("answer_keys", homework_id)
    if not homework:
        return jsonify({"error": "Homework not found"}), 404
    if homework.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    question_paper_url = (homework.get("question_paper_url") or "").strip()
    if not question_paper_url:
        return jsonify({"error": "This homework has no stored question paper image. Upload the question paper to generate a scheme."}), 422

    education_level = homework.get("education_level") or ""
    if not education_level:
        cls = get_doc("classes", homework.get("class_id", ""))
        education_level = (cls or {}).get("education_level", "Form 4")

    subject = homework.get("subject") or None
    homework_class_id = homework.get("class_id") or ""

    try:
        image_bytes = _download_image_from_url(question_paper_url)
    except Exception:
        logger.exception("Failed to download question paper image for homework_id=%s", homework_id)
        return jsonify({"error": "Could not download the question paper image. Please try again."}), 502

    user_ctx = get_user_context(teacher_id, "teacher", class_id=homework_class_id)
    scheme = generate_marking_scheme_from_image(image_bytes, education_level, subject,
                                                user_context=user_ctx)

    if "error" in scheme:
        return jsonify({"error": scheme["error"]}), 422

    return jsonify({"generated": True, "scheme": scheme}), 200


# ── PATCH /api/homework/{id} ──────────────────────────────────────────────────

@homework_bp.patch("/homework/<homework_id>")
def patch_homework(homework_id: str):
    """
    Update homework fields.
    PATCH /api/homework/{homework_id}
    Body: { open_for_submission: bool, title: str, ... }
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    homework = get_doc("answer_keys", homework_id)
    if not homework:
        return jsonify({"error": "Homework not found"}), 404
    if homework.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    allowed = {"open_for_submission", "title", "subject", "education_level", "due_date", "status"}
    updates = {k: v for k, v in body.items() if k in allowed}

    if not updates:
        return jsonify({"error": "No updatable fields provided"}), 400

    upsert("answer_keys", homework_id, updates)
    return jsonify({**homework, **updates}), 200


# ── POST /api/homework/{id}/grade-all ─────────────────────────────────────────

@homework_bp.post("/homework/<homework_id>/grade-all")
def grade_all_submissions(homework_id: str):
    """
    Synchronous batch grading — grades every pending submission using Gemma 4.

    POST /api/homework/{homework_id}/grade-all

    Runs inline (no Cloud Run Job dispatch). Deploy with --timeout=540 to support
    classes up to ~40 students on Vertex AI, or use local Ollama for dev.

    Flow:
      1. Verify submissions are closed (open_for_submission == False)
      2. Verify answer key has questions
      3. Fetch all pending submissions
      4. For each: Gemma 4 multimodal grade → annotate → upload → write Mark
      5. Send teacher push notification when complete
      6. Return { graded, errors, results }
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    homework = get_doc("answer_keys", homework_id)
    if not homework:
        return jsonify({"error": "Homework not found"}), 404
    if homework.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    if homework.get("open_for_submission", True):
        return jsonify({"error": "Close submissions before grading"}), 400

    if not homework.get("questions"):
        return jsonify({"error": "No answer key found. Add one before grading."}), 400

    class_id = homework.get("class_id", "")
    class_doc = get_doc("classes", class_id)
    education_level = homework.get("education_level") or (
        class_doc.get("education_level") if class_doc else "Form 4"
    )

    # ── Fetch pending submissions ─────────────────────────────────────────────
    pending = query("student_submissions", [
        ("answer_key_id", "==", homework_id),
        ("status", "==", "pending"),
    ])

    if not pending:
        return jsonify({"message": "No pending submissions to grade", "graded": 0}), 200

    # Mark homework as grading in progress
    upsert("answer_keys", homework_id, {
        "grading_status": "in_progress",
        "grading_started_at": _now_iso(),
    })

    # Defer heavy imports to avoid cold-start overhead on every request
    from shared.annotator import annotate_image
    from shared.gcs_client import generate_signed_url, upload_bytes
    from shared.gemma_client import grade_submission as _grade
    from shared.models import GradingVerdict, Mark

    graded = 0
    errors = 0
    results = []

    for sub in pending:
        sub_id = sub.get("id") or sub.get("submission_id")
        student_id = sub.get("student_id", "")
        image_urls: list = sub.get("image_urls") or []

        if not image_urls:
            logger.warning("grade-all: submission %s has no images — skipping", sub_id)
            upsert("student_submissions", sub_id, {
                "status": "error",
                "error": "no images attached",
            })
            errors += 1
            continue

        # Mark as "grading" so a polling teacher sees intermediate progress
        upsert("student_submissions", sub_id, {"status": "grading"})

        try:
            # Download primary image from GCS
            image_bytes = _download_image_from_url(image_urls[0])

            # Grade — Gemma 4 reads handwriting directly (single multimodal call)
            raw_verdicts = _grade(image_bytes, homework, education_level)
            verdicts = [GradingVerdict(**v) for v in raw_verdicts if isinstance(v, dict)]
            score = sum(v.awarded_marks for v in verdicts)
            max_score = (
                sum(v.max_marks for v in verdicts)
                or float(homework.get("total_marks") or 1)
            )
            percentage = round(score / max_score * 100, 1) if max_score else 0.0

            # Annotate original image with ticks/crosses/scores
            verdicts_dicts = [v.model_dump() for v in verdicts]
            annotated_bytes = annotate_image(image_bytes, verdicts_dicts, None)

            # Upload annotated image to GCS marked bucket (private)
            blob_name = f"{student_id}/{uuid.uuid4()}.jpg"
            upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes, public=False)
            marked_url = generate_signed_url(settings.GCS_BUCKET_MARKED, blob_name, expiry_minutes=60 * 24 * 7)

            # Write Mark document (teacher review required before student can see)
            mark_doc = Mark(
                student_id=student_id,
                class_id=class_id,
                answer_key_id=homework_id,
                teacher_id=teacher_id,
                score=score,
                max_score=max_score,
                percentage=percentage,
                verdicts=verdicts,
                marked_image_url=marked_url,
                source="student_submission",
                approved=False,
            )
            upsert("marks", mark_doc.id, mark_doc.model_dump())

            # Update submission: status → graded, link mark
            now = _now_iso()
            upsert("student_submissions", sub_id, {
                "status": "graded",
                "mark_id": mark_doc.id,
                "score": score,
                "max_score": max_score,
                "percentage": percentage,
                "marked_image_url": marked_url,
                "graded_at": now,
                "grading_model": "gemma4-26b",
                "verdicts": verdicts_dicts,
            })

            graded += 1
            results.append({
                "submission_id": sub_id,
                "student_id": student_id,
                "score": score,
                "max_score": max_score,
                "percentage": percentage,
            })
            logger.info("grade-all: graded submission %s — %.1f%%", sub_id, percentage)

        except Exception:
            logger.exception("grade-all: failed to grade submission %s", sub_id)
            upsert("student_submissions", sub_id, {
                "status": "error",
                "error": "grading_failed",
            })
            errors += 1

    # ── Mark homework complete ────────────────────────────────────────────────
    upsert("answer_keys", homework_id, {
        "grading_status": "complete",
        "grading_completed_at": _now_iso(),
    })

    # ── Notify teacher ────────────────────────────────────────────────────────
    # ── Push notification ─────────────────────────────────────────────────────
    try:
        from functions.push import send_teacher_notification
        hw_title = homework.get("title", "Homework")
        body_msg = (
            f"{graded} submission(s) graded. {errors} could not be processed."
            if errors
            else f"All {graded} submission(s) graded successfully."
        )
        send_teacher_notification(
            teacher_id=teacher_id,
            title=f"Grading complete — {hw_title}",
            body=body_msg,
            data={
                "screen": "HomeworkDetail",
                "answer_key_id": homework_id,
                "class_id": homework.get("class_id", ""),
                "class_name": homework.get("title", hw_title),
            },
        )
    except Exception:
        logger.warning("grade-all: push notification failed (non-fatal)")

    # ── WhatsApp notification to teacher ──────────────────────────────────────
    # Sends a message to open the free 24-hour session window. The teacher can
    # then reply "results" to review and approve submissions via WhatsApp.
    try:
        teacher_doc = get_doc("teachers", teacher_id)
        if teacher_doc and teacher_doc.get("phone"):
            from shared.whatsapp_client import send_text as _wa_send
            hw_title = homework.get("title", "Homework")
            class_id = homework.get("class_id", "")
            class_doc = get_doc("classes", class_id)
            class_name = class_doc.get("name", "") if class_doc else ""
            label = f"{class_name} — {hw_title}" if class_name else hw_title
            if errors:
                summary = f"{graded} graded, {errors} error(s)."
            else:
                summary = f"All {graded} submission(s) graded."
            _wa_send(
                teacher_doc["phone"],
                f"Grading complete for *{label}* ✅\n"
                f"{summary}\n\n"
                "Reply *results* to review and approve submissions on WhatsApp.",
            )
    except Exception:
        logger.warning("grade-all: WhatsApp notification failed (non-fatal)")

    return jsonify({
        "graded": graded,
        "errors": errors,
        "results": results,
    }), 200


# ── POST /api/homework/{id}/approve-all ───────────────────────────────────────

@homework_bp.post("/homework/<homework_id>/approve-all")
def approve_all_submissions(homework_id: str):
    """
    Batch-approve all graded submissions for a homework.
    POST /api/homework/{homework_id}/approve-all
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    homework = get_doc("answer_keys", homework_id)
    if not homework:
        return jsonify({"error": "Homework not found"}), 404
    if homework.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    graded_subs = query("student_submissions", [
        ("answer_key_id", "==", homework_id),
        ("status", "==", "graded"),
    ])

    if not graded_subs:
        return jsonify({"message": "No graded submissions to approve", "approved": 0}), 200

    now = _now_iso()
    approved_count = 0
    for sub in graded_subs:
        sub_id = sub.get("id") or sub.get("submission_id")
        upsert("student_submissions", sub_id, {
            "status": "approved",
            "approved_at": now,
            "approved_by": teacher_id,
        })
        mark_id = sub.get("mark_id")
        if mark_id:
            upsert("marks", mark_id, {"approved": True, "approved_at": now})
        approved_count += 1

    return jsonify({
        "message": f"Approved {approved_count} submission(s)",
        "approved": approved_count,
    }), 200
