# functions/answer_keys.py
# Teacher answer key management.
#
# GET    /api/answer-keys?class_id=... — list answer keys for a class (teacher JWT)
# POST   /api/answer-keys              — create or auto-generate an answer key (teacher JWT)
# PUT    /api/answer-keys/{id}         — update an answer key (teacher JWT)
# DELETE /api/answer-keys/{id}         — delete an answer key (teacher JWT)

from __future__ import annotations

import json
import logging
from typing import Optional

import azure.functions as func

from shared.auth import require_role
from shared.cosmos_client import delete_item, query_items, upsert_item
from shared.models import AnswerKey, EducationLevel, Question
from shared.openai_client import generate_marking_scheme

logger = logging.getLogger(__name__)


def _ok(body, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}), status_code=status, mimetype="application/json"
    )


# ── Push helpers ─────────────────────────────────────────────────────────────

async def _notify_class_new_homework(ak_id: str, ak_doc: dict) -> None:
    """Notify all students in a class that a new homework is ready for submission."""
    from shared.push_client import send_push_batch
    class_id: str = ak_doc.get("class_id", "")
    if not class_id:
        return
    title = ak_doc.get("title") or ak_doc.get("subject", "New Homework")
    due_date: str | None = ak_doc.get("due_date")
    due_str = due_date[:10] if due_date else "soon"

    students = await query_items(
        "students",
        "SELECT c.push_token FROM c WHERE c.class_id = @cid",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    notifications = [
        {
            "push_token": s["push_token"],
            "title": "New Homework",
            "body": f"{title} — due {due_str}",
            "data": {"screen": "AssignmentDetail", "answer_key_id": ak_id, "class_id": class_id},
        }
        for s in students if s.get("push_token")
    ]
    if notifications:
        await send_push_batch(notifications)
        logger.info("_notify_class_new_homework: sent %d notifications for ak %s", len(notifications), ak_id)


# ── GET / POST /api/answer-keys ───────────────────────────────────────────────

async def handle_answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    """Route GET → list, POST → create."""
    if req.method == "GET":
        return await _list_answer_keys(req)
    return await _create_answer_key(req)


async def _list_answer_keys(req: func.HttpRequest) -> func.HttpResponse:
    try:
        require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    class_id = req.params.get("class_id")
    if not class_id:
        return _err("class_id query param required")

    results = await query_items(
        container_name="answer_keys",
        query="SELECT * FROM c WHERE c.class_id = @class_id",
        parameters=[{"name": "@class_id", "value": class_id}],
        partition_key=class_id,
    )
    return _ok(results)


async def _create_answer_key(req: func.HttpRequest) -> func.HttpResponse:
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
        class_id = body["class_id"]
        subject = body["subject"]
        auto_generate = body.get("auto_generate", False)

        title: Optional[str] = body.get("title")
        open_for_submission: bool = body.get("open_for_submission", False)
        raw_education_level: Optional[str] = body.get("education_level")
        education_level: Optional[EducationLevel] = None
        if raw_education_level:
            try:
                education_level = EducationLevel(raw_education_level)
            except ValueError:
                return _err(f"Invalid education_level: {raw_education_level}")
        else:
            # Inherit education_level from the parent class
            cls_results = await query_items(
                container_name="classes",
                query="SELECT c.education_level FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": class_id}],
                partition_key=user["id"],
            )
            if cls_results:
                raw_cls_level = cls_results[0].get("education_level")
                if raw_cls_level:
                    try:
                        education_level = EducationLevel(raw_cls_level)
                    except ValueError:
                        pass

        if auto_generate:
            question_paper_text = body.get("question_paper_text", "")
            if not question_paper_text:
                return _err("question_paper_text required for auto_generate")
            grade_for_generation = raw_education_level or "grade_7"
            questions = await generate_marking_scheme(question_paper_text, grade_for_generation)
            generated = True
        else:
            raw_questions = body.get("questions", [])
            questions = [Question(**q) for q in raw_questions]
            generated = False

        explicit_total: Optional[float] = body.get("total_marks")
        total_marks: Optional[float] = (
            explicit_total if explicit_total is not None
            else (sum(q.max_marks for q in questions) if questions else None)
        )

        due_date: Optional[str] = body.get("due_date")
        status: Optional[str] = body.get("status")  # "pending_setup" for auto-created unlabeled keys

        answer_key = AnswerKey(
            class_id=class_id,
            subject=subject,
            questions=questions,
            generated=generated,
            title=title,
            teacher_id=user["id"],
            education_level=education_level,
            total_marks=total_marks,
            open_for_submission=open_for_submission,
            due_date=due_date,
            status=status,
        )
        ak_data = answer_key.model_dump(mode="json")
        await upsert_item("answer_keys", ak_data)

        # If created with open_for_submission=True, notify all students immediately
        if open_for_submission and status != "pending_setup":
            try:
                await _notify_class_new_homework(answer_key.id, ak_data)
            except Exception as exc:
                logger.warning("_create_answer_key: push batch failed: %s", exc)

        return _ok(ak_data, status=201)

    except (KeyError, ValueError) as exc:
        return _err(f"Invalid request: {exc}")


# ── PUT /api/answer-keys/{id} ─────────────────────────────────────────────────

async def handle_answer_key_update(req: func.HttpRequest) -> func.HttpResponse:
    """Update mutable fields on an answer key.

    PUT /api/answer-keys/{answer_key_id}
    Requires: Authorization: Bearer <teacher_jwt>
    Body (all optional): { title, subject, open_for_submission, education_level, total_marks, questions }
    """
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    ak_id: str = req.route_params.get("answer_key_id", "").strip()
    if not ak_id:
        return _err("answer_key_id is required in the URL path")

    # ── Detect multipart vs JSON (CHANGE 4) ──────────────────────────────────
    content_type_hdr = req.headers.get("Content-Type", "")
    is_multipart = "multipart/form-data" in content_type_hdr

    if is_multipart:
        # Parse form fields + optional file upload
        body: dict = {k: v for k, v in req.form.items()}
        # Coerce string booleans from form data
        for bool_field in ("auto_generate", "open_for_submission"):
            if bool_field in body:
                val = body[bool_field]
                if isinstance(val, str):
                    body[bool_field] = val.lower() in ("true", "1", "yes")
        file_obj = req.files.get("file")
        if file_obj:
            file_bytes = file_obj.read()
            filename = file_obj.filename or "upload"
            # Extract text from the file and auto-generate the marking scheme
            try:
                from shared.document_extractor import detect_document_type, extract_text as extract_doc_text
                doc_type = detect_document_type(file_bytes, filename)
                extracted, _ = await extract_doc_text(file_bytes, filename, doc_type)
                body["auto_generate"] = True
                body["question_paper_text"] = extracted
            except Exception as exc:
                logger.warning("handle_answer_key_update: file text extraction failed: %s", exc)
                return _err("Could not extract text from uploaded file. Try pasting the text manually.")
    else:
        try:
            body = req.get_json()
        except Exception:
            return _err("Invalid JSON body")

    # Load — cross-partition since we only have the id
    results = await query_items(
        "answer_keys",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": ak_id}],
    )
    if not results:
        return _err("Answer key not found.", status=404)

    ak_doc = results[0]

    # Guard — only the owning teacher can update
    if ak_doc.get("teacher_id") and ak_doc["teacher_id"] != user["id"]:
        return _err("You do not own this answer key.", status=403)

    for field in ("title", "subject", "open_for_submission", "total_marks", "due_date"):
        if field in body:
            ak_doc[field] = body[field]

    if body.get("auto_generate"):
        question_paper_text: str = body.get("question_paper_text", "")
        if not question_paper_text:
            return _err("question_paper_text required for auto_generate")
        grade = ak_doc.get("education_level") or "grade_7"
        generated_questions = await generate_marking_scheme(question_paper_text, grade)
        ak_doc["questions"] = [q.model_dump(mode="json") for q in generated_questions]
        ak_doc["generated"] = True
        if "total_marks" not in body:
            ak_doc["total_marks"] = sum(q.max_marks for q in generated_questions)
        # Clear pending_setup when a marking scheme is generated
        ak_doc["status"] = None

    if "education_level" in body:
        try:
            ak_doc["education_level"] = EducationLevel(body["education_level"]).value
        except ValueError:
            return _err(f"Invalid education_level: {body['education_level']}")

    if "questions" in body:
        try:
            questions = [Question(**q) for q in body["questions"]]
            ak_doc["questions"] = [q.model_dump(mode="json") for q in questions]
            if "total_marks" not in body:
                ak_doc["total_marks"] = sum(q.max_marks for q in questions)
            # Clear pending_setup when questions are manually set
            ak_doc["status"] = None
        except (KeyError, ValueError) as exc:
            return _err(f"Invalid questions: {exc}")

    await upsert_item("answer_keys", ak_doc)

    # If assignment just opened for submission, notify all students in the class
    if body.get("open_for_submission") is True and not results[0].get("open_for_submission"):
        try:
            await _notify_class_new_homework(ak_id, ak_doc)
        except Exception as exc:
            logger.warning("handle_answer_key_update: push batch failed: %s", exc)

    return _ok(ak_doc)


# ── DELETE /api/answer-keys/{id} ──────────────────────────────────────────────

async def handle_answer_key_delete(req: func.HttpRequest) -> func.HttpResponse:
    """Delete an answer key.

    DELETE /api/answer-keys/{answer_key_id}
    Requires: Authorization: Bearer <teacher_jwt>
    """
    try:
        user = require_role(req, "teacher")
    except ValueError as exc:
        return _err(str(exc), status=401)

    ak_id: str = req.route_params.get("answer_key_id", "").strip()
    if not ak_id:
        return _err("answer_key_id is required in the URL path")

    results = await query_items(
        "answer_keys",
        "SELECT c.id, c.class_id, c.teacher_id FROM c WHERE c.id = @id",
        [{"name": "@id", "value": ak_id}],
    )
    if not results:
        return _err("Answer key not found.", status=404)

    doc = results[0]

    if doc.get("teacher_id") and doc["teacher_id"] != user["id"]:
        return _err("You do not own this answer key.", status=403)

    await delete_item("answer_keys", doc["id"], doc["class_id"])
    return _ok({"success": True, "message": "Answer key deleted."})
