# functions/student_submissions.py
# Student-facing submission endpoints.
#
# POST   /api/submissions/student          — submit work against an open assignment (or unlabeled)
# GET    /api/submissions/student/{id}     — list this student's submissions (pending + graded)
# DELETE /api/submissions/student/{id}     — withdraw a pending submission
# GET    /api/marks/student/{student_id}   — list approved marks for a student

from __future__ import annotations

import json
import logging
from datetime import datetime
from uuid import uuid4

import azure.functions as func

from shared.auth import require_role
from shared.blob_client import generate_sas_url, upload_bytes, upload_scan
from shared.config import settings
from shared.cosmos_client import delete_item, get_item, query_items, upsert_item
from shared.models import AnswerKey
from shared.push_client import send_push_notification

logger = logging.getLogger(__name__)


def _ok(body, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}), status_code=status, mimetype="application/json"
    )


# ── File type detection ───────────────────────────────────────────────────────

def _detect_file_type(content_type: str, filename: str) -> str:
    """Return 'image', 'pdf', or 'docx'."""
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct in ("image/jpeg", "image/jpg", "image/png"):
        return "image"
    if ct == "application/pdf":
        return "pdf"
    if ct in (
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ):
        return "docx"
    ext = (filename or "").rsplit(".", 1)[-1].lower()
    if ext in ("jpg", "jpeg", "png"):
        return "image"
    if ext == "pdf":
        return "pdf"
    if ext in ("doc", "docx"):
        return "docx"
    return "image"


# ── Unlabeled answer key helper (CHANGE 1) ────────────────────────────────────

async def _get_or_create_unlabeled(class_id: str) -> tuple[str, str]:
    """Find or create the Unlabeled (pending_setup) answer key for a class.

    Returns (answer_key_id, teacher_id).
    """
    existing = await query_items(
        "answer_keys",
        "SELECT c.id, c.teacher_id FROM c WHERE c.class_id = @cid AND c.status = 'pending_setup'",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    if existing:
        return existing[0]["id"], existing[0].get("teacher_id", "")

    # Get teacher_id from the class (cross-partition query)
    class_results = await query_items(
        "classes",
        "SELECT c.teacher_id FROM c WHERE c.id = @id",
        [{"name": "@id", "value": class_id}],
    )
    teacher_id: str = class_results[0]["teacher_id"] if class_results else ""

    ak = AnswerKey(
        class_id=class_id,
        subject="Unlabeled",
        title="Unlabeled",
        teacher_id=teacher_id,
        questions=[],
        generated=False,
        open_for_submission=True,
        status="pending_setup",
    )
    await upsert_item("answer_keys", ak.model_dump(mode="json"))
    logger.info("_get_or_create_unlabeled: created %s for class %s", ak.id, class_id)
    return ak.id, teacher_id


# ── Store without grading (pending_setup or non-image) ───────────────────────

async def _store_submission_without_grading(
    student_id: str,
    class_id: str,
    teacher_id: str,
    answer_key_id: str,
    file_bytes: bytes,
    file_name: str,
    file_content_type: str,
    file_type: str,
    answer_key_doc: dict,
) -> func.HttpResponse:
    """Upload the file and create a mark record without running the grading pipeline."""
    ct_map = {
        "image": "image/jpeg",
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }
    blob_ct = ct_map.get(file_type, file_content_type)
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else "bin"
    blob_name = f"{teacher_id or 'unknown'}/{class_id}/{student_id}/{uuid4()}.{ext}"

    await upload_bytes(
        file_bytes, blob_name,
        container_name=settings.azure_storage_container_scans,
        content_type=blob_ct,
    )
    file_url = generate_sas_url(
        settings.azure_storage_container_scans, blob_name, expiry_hours=24 * 365
    )

    mark_id = str(uuid4())
    mark_doc = {
        "id": mark_id,
        "student_id": student_id,
        "teacher_id": teacher_id or "",
        "class_id": class_id,
        "answer_key_id": answer_key_id,
        "score": 0.0,
        "max_score": 0.0,
        "raw_ocr_text": "",
        "marked_image_url": file_url,
        "source": "student_submission",
        "approved": False,
        "timestamp": datetime.utcnow().isoformat(),
        "verdicts": [],
        "file_type": file_type,
    }
    await upsert_item("marks", mark_doc)
    logger.info("_store_submission_without_grading: stored mark %s (type=%s)", mark_id, file_type)

    # Push notification to teacher
    if teacher_id:
        try:
            teacher_results = await query_items(
                "teachers",
                "SELECT c.push_token FROM c WHERE c.id = @id",
                [{"name": "@id", "value": teacher_id}],
            )
            if teacher_results and teacher_results[0].get("push_token"):
                student_results = await query_items(
                    "students",
                    "SELECT c.first_name, c.surname FROM c WHERE c.id = @id",
                    [{"name": "@id", "value": student_id}],
                )
                student_name = ""
                if student_results:
                    s = student_results[0]
                    student_name = f"{s.get('first_name', '')} {s.get('surname', '')}".strip()
                assignment_title = (
                    answer_key_doc.get("title") or answer_key_doc.get("subject", "assignment")
                )
                await send_push_notification(
                    teacher_results[0]["push_token"],
                    title="New submission",
                    body=f"{student_name} submitted {assignment_title}",
                    data={"mark_id": mark_id, "student_id": student_id},
                )
        except Exception as exc:
            logger.warning("_store_submission_without_grading: push notify failed: %s", exc)

    return _ok(
        {
            "submission_id": mark_id,
            "status": "pending",
            "message": "Submitted successfully. Your teacher will grade this.",
        },
        status=201,
    )


# ── POST /api/submissions/student ─────────────────────────────────────────────

async def handle_student_submission_create(req: func.HttpRequest) -> func.HttpResponse:
    """Student submits work against an open assignment (or unlabeled).

    answer_key_id is now optional — if omitted the backend finds or creates an
    Unlabeled assignment for the class (CHANGE 1).

    Accepts image files (JPEG/PNG) and document files (PDF, Word) via the
    'image' or 'file' form field. Non-image files are stored without grading
    and the mark stays pending until the teacher grades manually (CHANGE 4).

    Request: multipart/form-data
        student_id      — must match JWT id
        class_id        — the student's class
        answer_key_id   — optional; omit to submit to the Unlabeled assignment
        image           — JPEG/PNG (original field name, kept for back-compat)
        file            — any accepted file type (PDF, Word, JPEG, PNG)
        content_type    — optional explicit MIME type override

    Response 201:
        { submission_id, status: "pending", message }
    """
    try:
        user = require_role(req, "student")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        form = req.form
        files = req.files
        student_id: str = form.get("student_id", "").strip()
        class_id: str = form.get("class_id", "").strip()
        answer_key_id: str = form.get("answer_key_id", "").strip()  # optional

        if not all([student_id, class_id]):
            return _err("student_id and class_id are required")

        # Accept 'image' (legacy) or 'file' field
        file_obj = files.get("image") or files.get("file")
        if file_obj is not None:
            file_bytes = file_obj.read()
            # Explicit content_type field overrides detected one
            file_content_type = form.get("content_type") or file_obj.content_type or "image/jpeg"
            file_name = file_obj.filename or "upload"
        else:
            file_bytes = req.get_body()
            file_content_type = "image/jpeg"
            file_name = "scan.jpg"

        if not file_bytes:
            return _err("file or image is required")

    except (KeyError, ValueError) as exc:
        return _err(f"Invalid request: {exc}")

    # Verify student_id matches JWT
    if student_id != user["id"]:
        return _err("student_id does not match authenticated user.", status=403)

    # Detect file type
    file_type = _detect_file_type(file_content_type, file_name)

    # ── CHANGE 1: No answer_key_id → find/create Unlabeled ───────────────────
    if not answer_key_id:
        try:
            answer_key_id, teacher_id = await _get_or_create_unlabeled(class_id)
        except Exception as exc:
            logger.exception("handle_student_submission_create: _get_or_create_unlabeled failed: %s", exc)
            return _err("Could not create assignment. Please try again.", status=500)

        ak_results = await query_items(
            "answer_keys",
            "SELECT * FROM c WHERE c.id = @id",
            [{"name": "@id", "value": answer_key_id}],
            partition_key=class_id,
        )
        answer_key_doc = ak_results[0] if ak_results else {"questions": [], "status": "pending_setup"}
        return await _store_submission_without_grading(
            student_id, class_id, teacher_id, answer_key_id,
            file_bytes, file_name, file_content_type, file_type, answer_key_doc,
        )

    # ── Normal path: answer_key_id provided ──────────────────────────────────

    # Load answer key and check it's open
    ak_results = await query_items(
        container_name="answer_keys",
        query="SELECT * FROM c WHERE c.id = @id AND c.class_id = @cid",
        parameters=[
            {"name": "@id", "value": answer_key_id},
            {"name": "@cid", "value": class_id},
        ],
        partition_key=class_id,
    )
    if not ak_results:
        return _err("Assignment not found.", status=404)

    answer_key_doc = ak_results[0]
    if not answer_key_doc.get("open_for_submission", False):
        return _err("This assignment is not currently open for submission.", status=403)

    teacher_id = answer_key_doc.get("teacher_id", "")

    # Check for duplicate pending submission
    existing = await query_items(
        container_name="marks",
        query=(
            "SELECT c.id FROM c "
            "WHERE c.student_id = @sid "
            "AND c.answer_key_id = @akid "
            "AND c.source = 'student_submission' "
            "AND (NOT IS_DEFINED(c.approved) OR c.approved = false)"
        ),
        parameters=[
            {"name": "@sid", "value": student_id},
            {"name": "@akid", "value": answer_key_id},
        ],
        partition_key=student_id,
    )
    if existing:
        return _err(
            "You already have a pending submission for this assignment. "
            "Withdraw it first to resubmit.",
            status=409,
        )

    # ── CHANGE 4: Non-image file OR pending_setup key → store without grading ─
    ak_status = answer_key_doc.get("status")
    has_questions = bool(answer_key_doc.get("questions"))
    if ak_status == "pending_setup" or not has_questions or file_type != "image":
        return await _store_submission_without_grading(
            student_id, class_id, teacher_id, answer_key_id,
            file_bytes, file_name, file_content_type, file_type, answer_key_doc,
        )

    # ── Full marking pipeline (image + valid answer key) ─────────────────────
    from functions.mark import MarkingRequest, run_marking

    try:
        answer_key_obj = AnswerKey(**answer_key_doc)
        education_level: str = answer_key_doc.get("education_level") or "grade_7"
        request = MarkingRequest(
            teacher_id=teacher_id,
            student_id=student_id,
            class_id=class_id,
            answer_key_id=answer_key_id,
            education_level=education_level,
            image_bytes=file_bytes,
            source="student_submission",
        )
        result = await run_marking(request)
    except Exception as exc:
        logger.exception("student_submission: marking pipeline error: %s", exc)
        return _err("Grading failed. Please try again.", status=500)

    # Update the stored mark with student-submission-specific fields
    try:
        mark_doc = await get_item("marks", result.mark_id, student_id)
        mark_doc["source"] = "student_submission"
        mark_doc["approved"] = False
        mark_doc["class_id"] = class_id
        mark_doc["file_type"] = "image"
        mark_doc["percentage"] = (
            round(result.score / result.max_score * 100, 1)
            if result.max_score > 0 else 0.0
        )
        mark_doc["verdicts"] = [v.model_dump() for v in result.verdicts]
        await upsert_item("marks", mark_doc)
    except Exception as exc:
        logger.warning("student_submission: could not update mark fields: %s", exc)

    # Push notification to teacher
    if teacher_id:
        try:
            teacher_results = await query_items(
                "teachers",
                "SELECT c.push_token, c.first_name, c.surname FROM c WHERE c.id = @id",
                [{"name": "@id", "value": teacher_id}],
            )
            if teacher_results:
                t = teacher_results[0]
                push_token = t.get("push_token")
                if push_token:
                    student_results = await query_items(
                        "students",
                        "SELECT c.first_name, c.surname FROM c WHERE c.id = @id",
                        [{"name": "@id", "value": student_id}],
                    )
                    student_name = ""
                    if student_results:
                        s = student_results[0]
                        student_name = f"{s.get('first_name', '')} {s.get('surname', '')}".strip()
                    assignment_title = (
                        answer_key_doc.get("title")
                        or answer_key_doc.get("subject", "assignment")
                    )
                    await send_push_notification(
                        push_token,
                        title="New submission",
                        body=f"{student_name} submitted {assignment_title}",
                        data={"mark_id": result.mark_id, "student_id": student_id},
                    )
        except Exception as exc:
            logger.warning("student_submission: push notify teacher failed: %s", exc)

    return _ok(
        {
            "submission_id": result.mark_id,
            "status": "pending",
            "message": "Submitted successfully. Your teacher will review and grade this.",
        },
        status=201,
    )


# ── GET /api/submissions/student/{id} ─────────────────────────────────────────

async def handle_student_submissions_list(req: func.HttpRequest) -> func.HttpResponse:
    """List all submissions (marks with source=student_submission) for a student."""
    try:
        user = require_role(req, "student")
    except ValueError as exc:
        return _err(str(exc), status=401)

    student_id: str = req.route_params.get("id", "").strip()
    if not student_id:
        return _err("student_id is required in the URL path")

    if student_id != user["id"]:
        return _err("Cannot view another student's submissions.", status=403)

    marks = await query_items(
        container_name="marks",
        query=(
            "SELECT * FROM c "
            "WHERE c.student_id = @sid "
            "AND c.source = 'student_submission' "
            "ORDER BY c.timestamp DESC"
        ),
        parameters=[{"name": "@sid", "value": student_id}],
        partition_key=student_id,
    )

    ak_ids = list({m["answer_key_id"] for m in marks if m.get("answer_key_id")})
    ak_titles: dict[str, str] = {}
    for ak_id in ak_ids:
        try:
            ak_results = await query_items(
                "answer_keys",
                "SELECT c.id, c.title, c.subject FROM c WHERE c.id = @id",
                [{"name": "@id", "value": ak_id}],
            )
            if ak_results:
                ak = ak_results[0]
                ak_titles[ak_id] = ak.get("title") or ak.get("subject", "")
        except Exception:
            pass

    submissions = []
    for m in marks:
        approved: bool = m.get("approved", False)
        entry: dict = {
            "mark_id": m["id"],
            "answer_key_id": m.get("answer_key_id"),
            "answer_key_title": ak_titles.get(m.get("answer_key_id", ""), ""),
            "status": "graded" if approved else "pending",
            "submitted_at": m.get("timestamp"),
            "graded_at": m.get("timestamp") if approved else None,
            "file_type": m.get("file_type", "image"),
        }
        if approved:
            entry["score"] = m.get("score")
            entry["max_score"] = m.get("max_score")
            entry["percentage"] = m.get("percentage")
            entry["marked_image_url"] = m.get("marked_image_url")
        else:
            entry["score"] = None
            entry["max_score"] = None
        submissions.append(entry)

    return _ok(submissions)


# ── DELETE /api/submissions/student/{id} ──────────────────────────────────────

async def handle_student_submission_delete(req: func.HttpRequest) -> func.HttpResponse:
    """Withdraw a pending student submission."""
    try:
        user = require_role(req, "student")
    except ValueError as exc:
        return _err(str(exc), status=401)

    mark_id: str = req.route_params.get("id", "").strip()
    if not mark_id:
        return _err("mark_id is required in the URL path")

    results = await query_items(
        "marks",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": mark_id}],
    )
    if not results:
        return _err("Submission not found.", status=404)

    mark_doc = results[0]

    if mark_doc.get("student_id") != user["id"]:
        return _err("Cannot withdraw another student's submission.", status=403)

    if mark_doc.get("approved", False):
        return _err("Cannot withdraw a graded submission.", status=403)

    await delete_item("marks", mark_doc["id"], mark_doc["student_id"])
    return _ok({"success": True, "message": "Submission withdrawn successfully."})


# ── GET /api/marks/student/{student_id} ──────────────────────────────────────

async def handle_student_marks_list(req: func.HttpRequest) -> func.HttpResponse:
    """List all approved marks for a student (their results feed)."""
    try:
        user = require_role(req, "student")
    except ValueError as exc:
        return _err(str(exc), status=401)

    student_id: str = req.route_params.get("student_id", "").strip()
    if not student_id:
        return _err("student_id is required in the URL path")

    if student_id != user["id"]:
        return _err("Cannot view another student's marks.", status=403)

    marks = await query_items(
        container_name="marks",
        query=(
            "SELECT * FROM c "
            "WHERE c.student_id = @sid "
            "AND c.approved = true "
            "ORDER BY c.timestamp DESC"
        ),
        parameters=[{"name": "@sid", "value": student_id}],
        partition_key=student_id,
    )

    ak_ids = list({m["answer_key_id"] for m in marks if m.get("answer_key_id")})
    ak_titles: dict[str, str] = {}
    for ak_id in ak_ids:
        try:
            ak_results = await query_items(
                "answer_keys",
                "SELECT c.id, c.title, c.subject FROM c WHERE c.id = @id",
                [{"name": "@id", "value": ak_id}],
            )
            if ak_results:
                ak = ak_results[0]
                ak_titles[ak_id] = ak.get("title") or ak.get("subject", "")
        except Exception:
            pass

    results_list = []
    for m in marks:
        results_list.append({
            "id": m["id"],
            "answer_key_id": m.get("answer_key_id"),
            "answer_key_title": ak_titles.get(m.get("answer_key_id", ""), ""),
            "score": m.get("score"),
            "max_score": m.get("max_score"),
            "percentage": m.get("percentage"),
            "marked_image_url": m.get("marked_image_url"),
            "source": m.get("source", "teacher_scan"),
            "approved": m.get("approved", False),
            "feedback": m.get("feedback"),
            "timestamp": m.get("timestamp"),
            "verdicts": m.get("verdicts", []),
            "file_type": m.get("file_type", "image"),
        })

    return _ok(results_list)
