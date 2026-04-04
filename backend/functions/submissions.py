# functions/submissions.py
# GET  /api/submissions              — list submissions for a teacher
# POST /api/submissions              — create submission + run full grading pipeline
# POST /api/submissions/{id}/approve — lecturer approves draft feedback

from __future__ import annotations

import json
import logging
from datetime import datetime
from uuid import uuid4

import azure.functions as func

from shared.blob_client import download_blob, generate_sas_url, upload_bytes, upload_marked
from shared.config import settings
from shared.cosmos_client import get_item, query_items, upsert_item
from shared.document_extractor import detect_document_type, extract_text
from shared.email_client import send_draft_to_lecturer, send_feedback_to_student
from shared.feedback_generator import generate_feedback_pdf
from shared.models import Rubric, Submission, SubmissionStatus
from shared.openai_client import grade_document

logger = logging.getLogger(__name__)


# ── Router ────────────────────────────────────────────────────────────────────

async def handle_submissions(req: func.HttpRequest) -> func.HttpResponse:
    """Route GET → list_submissions, POST → create_submission."""
    if req.method == "GET":
        return await list_submissions(req)
    return await create_submission(req)


# ── GET — list submissions ────────────────────────────────────────────────────

async def list_submissions(req: func.HttpRequest) -> func.HttpResponse:
    """List submissions for a teacher, with optional status, class_id, and type filters.

    Query params:
        teacher_id  — required
        status      — optional: pending | graded (primary) / draft | approved | released (tertiary)
        class_id    — optional
        type        — optional: primary | tertiary | all (default: all)
                      primary   = homework marking results (marks container, source=student_submission)
                      tertiary  = typed documents (submissions container, PDF/DOCX)
                      all       = primary (homework marks) — tertiary has its own approval UI
    """
    teacher_id = req.params.get("teacher_id")
    if not teacher_id:
        return func.HttpResponse(
            json.dumps({"error": "teacher_id query param required"}),
            status_code=400,
            mimetype="application/json",
        )

    status_filter = req.params.get("status")
    class_id_filter = req.params.get("class_id")
    type_filter = (req.params.get("type") or "all").lower()

    # ── Tertiary: query submissions container (typed documents) ───────────────────
    if type_filter == "tertiary":
        query = "SELECT * FROM c WHERE c.teacher_id = @teacher_id"
        parameters: list[dict] = [{"name": "@teacher_id", "value": teacher_id}]
        if status_filter:
            query += " AND c.status = @status"
            parameters.append({"name": "@status", "value": status_filter})
        if class_id_filter:
            query += " AND c.class_id = @class_id"
            parameters.append({"name": "@class_id", "value": class_id_filter})
        query += " AND (c.document_type = 'pdf' OR c.document_type = 'docx')"
        results = await query_items("submissions", query, parameters)
        return func.HttpResponse(
            json.dumps(results, default=str), status_code=200, mimetype="application/json"
        )

    # ── Primary / all: query marks container for student homework submissions ─────
    # These are created by student_submissions.py and teacher marking pipeline.
    query = (
        "SELECT * FROM c "
        "WHERE c.teacher_id = @teacher_id "
        "AND c.source = 'student_submission'"
    )
    parameters = [{"name": "@teacher_id", "value": teacher_id}]

    if class_id_filter:
        query += " AND c.class_id = @class_id"
        parameters.append({"name": "@class_id", "value": class_id_filter})

    if status_filter == "pending":
        query += " AND (NOT IS_DEFINED(c.approved) OR c.approved = false)"
    elif status_filter == "graded":
        query += " AND c.approved = true"

    marks = await query_items("marks", query, parameters)

    # Enrich: batch-load student names
    student_ids = list({m["student_id"] for m in marks if m.get("student_id")})
    student_names: dict[str, str] = {}
    for sid in student_ids:
        try:
            sr = await query_items(
                "students",
                "SELECT c.id, c.first_name, c.surname FROM c WHERE c.id = @id",
                [{"name": "@id", "value": sid}],
            )
            if sr:
                s = sr[0]
                student_names[sid] = f"{s.get('first_name', '')} {s.get('surname', '')}".strip()
        except Exception:
            pass

    # Enrich: batch-load answer key titles
    ak_ids = list({m["answer_key_id"] for m in marks if m.get("answer_key_id")})
    ak_titles: dict[str, str] = {}
    for ak_id in ak_ids:
        try:
            ar = await query_items(
                "answer_keys",
                "SELECT c.id, c.title, c.subject FROM c WHERE c.id = @id",
                [{"name": "@id", "value": ak_id}],
            )
            if ar:
                ak = ar[0]
                ak_titles[ak_id] = ak.get("title") or ak.get("subject", "")
        except Exception:
            pass

    # Shape into TeacherSubmission format expected by the mobile app
    result: list[dict] = []
    for m in marks:
        approved: bool = m.get("approved", False)
        result.append({
            "id": m["id"],
            "mark_id": m["id"],
            "student_id": m.get("student_id", ""),
            "student_name": student_names.get(m.get("student_id", ""), ""),
            "class_id": m.get("class_id", ""),
            "answer_key_id": m.get("answer_key_id", ""),
            "answer_key_title": ak_titles.get(m.get("answer_key_id", ""), ""),
            "status": "graded" if approved else "pending",
            "submitted_at": m.get("timestamp", ""),
            "graded_at": m.get("timestamp") if approved else None,
            # Score/max always included so teacher can see auto-graded result before approving
            "score": m.get("score"),
            "max_score": m.get("max_score"),
            "marked_image_url": m.get("marked_image_url"),
            "source": m.get("source", "student_submission"),
            # Feedback fields
            "verdicts": m.get("verdicts", []),
            "overall_feedback": m.get("feedback"),   # mark.feedback = overall teacher comment
            "manually_edited": m.get("manually_edited", False),
        })

    return func.HttpResponse(
        json.dumps(result, default=str),
        status_code=200,
        mimetype="application/json",
    )


# ── POST — create submission + full pipeline ──────────────────────────────────

async def create_submission(req: func.HttpRequest) -> func.HttpResponse:
    """Accept a document submission and run the full tertiary grading pipeline."""
    # Parse multipart form
    try:
        data_field = req.form.get("data")
        if not data_field:
            return func.HttpResponse(
                json.dumps({"error": "Missing 'data' form field"}),
                status_code=400,
                mimetype="application/json",
            )
        data = json.loads(data_field)

        required = ["student_id", "class_id", "teacher_id", "rubric_id",
                    "assignment_name", "submission_code"]
        missing = [f for f in required if not data.get(f)]
        if missing:
            return func.HttpResponse(
                json.dumps({"error": f"Missing required fields: {missing}"}),
                status_code=400,
                mimetype="application/json",
            )

        doc_file = req.files.get("document")
        if not doc_file:
            return func.HttpResponse(
                json.dumps({"error": "Missing 'document' file field"}),
                status_code=400,
                mimetype="application/json",
            )
        file_bytes = doc_file.read()
        filename = doc_file.filename or "submission"

    except (ValueError, KeyError) as exc:
        return func.HttpResponse(
            json.dumps({"error": f"Invalid request: {exc}"}),
            status_code=400,
            mimetype="application/json",
        )

    student_id    = data["student_id"]
    class_id      = data["class_id"]
    teacher_id    = data["teacher_id"]
    rubric_id     = data["rubric_id"]
    assignment_name = data["assignment_name"]
    submission_code = data["submission_code"]
    student_email = data.get("student_email")

    try:
        # Step 1 — Detect document type and extract text
        doc_type = detect_document_type(file_bytes, filename)
        extracted_text, doc_type = await extract_text(file_bytes, filename, doc_type)
        logger.info("create_submission: extracted %d chars, type=%s", len(extracted_text), doc_type)

        # Step 2 — Upload original document to Blob Storage
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
        blob_uuid = str(uuid4())
        doc_blob_name = f"{teacher_id}/{class_id}/{student_id}/{blob_uuid}.{ext}"
        content_type_map = {
            "pdf": "application/pdf",
            "pdf_scanned": "application/pdf",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "image": "image/jpeg",
        }
        doc_content_type = content_type_map.get(doc_type, "application/octet-stream")
        await upload_bytes(
            file_bytes, doc_blob_name,
            container_name="submissions",
            content_type=doc_content_type,
        )
        document_url = generate_sas_url("submissions", doc_blob_name, expiry_hours=24 * 365)

        # Step 3 — Load rubric from Cosmos
        try:
            rubric_doc = await get_item("rubrics", rubric_id, class_id)
        except Exception:
            return func.HttpResponse(
                json.dumps({"error": f"Rubric '{rubric_id}' not found"}),
                status_code=404,
                mimetype="application/json",
            )
        rubric = Rubric(**rubric_doc)

        # Step 4 — Load class for education_level, then grade
        try:
            class_doc = await get_item("classes", class_id, teacher_id)
        except Exception:
            class_doc = {}
        education_level = class_doc.get("education_level", "tertiary")

        verdicts, plagiarism_flag = await grade_document(extracted_text, rubric, education_level)
        total_score = sum(v.awarded_marks for v in verdicts)
        max_score   = sum(v.max_marks for v in verdicts)

        # Step 5 — Load teacher for name, then generate feedback PDF
        try:
            teacher_doc = await get_item("teachers", teacher_id, teacher_id)
        except Exception:
            teacher_doc = {}
        # Build lecturer display name — supports both old single-name docs and new first_name/surname docs
        lecturer_name = (
            teacher_doc.get("name")
            or f"{teacher_doc.get('first_name', '')} {teacher_doc.get('surname', '')}".strip()
            or "Lecturer"
        )

        try:
            student_doc = await get_item("students", student_id, class_id)
        except Exception:
            student_doc = {}
        # Build student display name — supports both old single-name docs and new first_name/surname docs
        student_name = (
            student_doc.get("name")
            or f"{student_doc.get('first_name', '')} {student_doc.get('surname', '')}".strip()
            or "Student"
        )

        feedback_pdf_bytes = generate_feedback_pdf(
            student_name=student_name,
            assignment_name=assignment_name,
            submission_code=submission_code,
            verdicts=verdicts,
            total_score=total_score,
            max_score=max_score,
            plagiarism_flag=plagiarism_flag,
            lecturer_name=lecturer_name,
        )

        # Step 6 — Upload feedback PDF to "marked" container
        pdf_blob_name = f"{teacher_id}/{class_id}/{student_id}/feedback_{blob_uuid}.pdf"
        await upload_marked(feedback_pdf_bytes, pdf_blob_name)
        feedback_pdf_url = generate_sas_url("marked", pdf_blob_name, expiry_hours=24 * 365)

        # Step 7 — Send draft to lecturer (skip if no email)
        lecturer_email = teacher_doc.get("email")
        submission_id = str(uuid4())
        if lecturer_email:
            await send_draft_to_lecturer(
                lecturer_email=lecturer_email,
                lecturer_name=lecturer_name,
                student_name=student_name,
                assignment_name=assignment_name,
                total_score=total_score,
                max_score=max_score,
                feedback_pdf_bytes=feedback_pdf_bytes,
                submission_id=submission_id,
                submission_code=submission_code,
                function_key=settings.function_app_key,
            )
        else:
            logger.warning(
                "create_submission: no email on teacher %s — skipping draft email", teacher_id
            )

        # Step 8 — Write Submission to Cosmos
        submission = Submission(
            id=submission_id,
            student_id=student_id,
            class_id=class_id,
            teacher_id=teacher_id,
            rubric_id=rubric_id,
            assignment_name=assignment_name,
            submission_code=submission_code,
            document_url=document_url,
            document_type=doc_type,
            extracted_text=extracted_text,
            feedback_pdf_url=feedback_pdf_url,
            verdicts=verdicts,
            total_score=total_score,
            max_score=max_score,
            plagiarism_flag=plagiarism_flag,
            status=SubmissionStatus.DRAFT,
            student_email=student_email,
            graded_at=datetime.utcnow(),
        )
        await upsert_item("submissions", submission.model_dump(mode="json"))

        # Step 9 — Return result
        result = {
            "submission_id": submission_id,
            "status": SubmissionStatus.DRAFT.value,
            "total_score": total_score,
            "max_score": max_score,
            "feedback_pdf_url": feedback_pdf_url,
            "message": "Submission graded. Draft sent to lecturer for approval.",
        }
        return func.HttpResponse(
            json.dumps(result),
            status_code=201,
            mimetype="application/json",
        )

    except Exception as exc:
        logger.exception("create_submission pipeline error: %s", exc)
        return func.HttpResponse(
            json.dumps({"error": "Pipeline error", "detail": str(exc)}),
            status_code=500,
            mimetype="application/json",
        )


# ── POST — approve submission ─────────────────────────────────────────────────

async def handle_submission_approve(req: func.HttpRequest) -> func.HttpResponse:
    """Route wrapper — extracts submission_id from route params."""
    submission_id = req.route_params.get("submission_id", "")
    if not submission_id:
        return func.HttpResponse(
            json.dumps({"error": "submission_id is required"}),
            status_code=400,
            mimetype="application/json",
        )
    return await approve_submission(req, submission_id)


async def approve_submission(
    req: func.HttpRequest,
    submission_id: str,
) -> func.HttpResponse:
    """Lecturer approves a draft submission and releases feedback to student."""
    # Step 1 — Load submission (cross-partition query since we only have the id)
    results = await query_items(
        container_name="submissions",
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": submission_id}],
    )
    if not results:
        return func.HttpResponse(
            json.dumps({"error": f"Submission '{submission_id}' not found"}),
            status_code=404,
            mimetype="application/json",
        )
    sub_doc = results[0]

    # Step 2 — Guard against double-approval
    if sub_doc.get("status") != SubmissionStatus.DRAFT.value:
        return func.HttpResponse(
            json.dumps({
                "error": "Submission is not in DRAFT state",
                "current_status": sub_doc.get("status"),
            }),
            status_code=409,
            mimetype="application/json",
        )

    # Step 3 — Approve
    now = datetime.utcnow().isoformat()
    sub_doc["status"] = SubmissionStatus.APPROVED.value
    sub_doc["approved_at"] = now

    # Step 4 — Release to student if email is available
    student_email = sub_doc.get("student_email")
    if student_email and sub_doc.get("feedback_pdf_url"):
        try:
            # Extract blob name from the SAS URL (path component before '?')
            pdf_url: str = sub_doc["feedback_pdf_url"]
            blob_path = pdf_url.split(".net/marked/", 1)[-1].split("?")[0]
            pdf_bytes = await download_blob("marked", blob_path)
            await send_feedback_to_student(
                student_email=student_email,
                student_name=sub_doc.get("student_id", "Student"),
                assignment_name=sub_doc.get("assignment_name", "Assignment"),
                total_score=sub_doc.get("total_score", 0),
                max_score=sub_doc.get("max_score", 0),
                feedback_pdf_bytes=pdf_bytes,
                submission_code=sub_doc.get("submission_code", ""),
            )
            sub_doc["status"] = SubmissionStatus.RELEASED.value
            sub_doc["released_at"] = datetime.utcnow().isoformat()
        except Exception as exc:
            logger.error(
                "approve_submission: failed to send feedback to student %s: %s",
                student_email, exc,
            )

    # Step 5 — Persist
    await upsert_item("submissions", sub_doc)

    # Step 6 — Respond
    return func.HttpResponse(
        json.dumps({
            "submission_id": submission_id,
            "status": sub_doc["status"],
            "message": "Submission approved" + (
                " and feedback released to student." if student_email else "."
            ),
        }),
        status_code=200,
        mimetype="application/json",
    )
