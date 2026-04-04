# functions/email_webhook.py
# POST /api/email-webhook
# Receives inbound email events from Azure Communication Services via Event Grid.
# Handles:
#   - Event Grid subscription validation handshake
#   - Lecturer APPROVE replies  → approve_submission
#   - Student document submissions → full grading pipeline

from __future__ import annotations

import base64
import json
import logging
import re

import azure.functions as func

from shared.cosmos_client import query_items, upsert_item
from shared.email_client import send_error

logger = logging.getLogger(__name__)


async def handle_email_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """Entry point for Azure Event Grid email webhook events."""
    try:
        body = req.get_json()
    except ValueError:
        return func.HttpResponse(
            json.dumps({"error": "Invalid JSON body"}),
            status_code=400,
            mimetype="application/json",
        )

    # Azure Event Grid sends events as an array
    if isinstance(body, list):
        events = body
    else:
        events = [body]

    for event in events:
        event_type = event.get("eventType", "")
        event_data = event.get("data", {})

        # ── Event Grid subscription validation handshake ──────────────────────
        if event_type == "Microsoft.EventGrid.SubscriptionValidationEvent":
            validation_code = event_data.get("validationCode")
            logger.info("email_webhook: Event Grid validation handshake received")
            return func.HttpResponse(
                json.dumps({"validationResponse": validation_code}),
                status_code=200,
                mimetype="application/json",
            )

        # ── Inbound email events ──────────────────────────────────────────────
        if event_type in (
            "Microsoft.Communication.EmailReceived",
            "Microsoft.Communication.InboundEmail",
        ):
            await process_inbound_email(event_data)

    return func.HttpResponse(
        json.dumps({"status": "ok"}),
        status_code=200,
        mimetype="application/json",
    )


async def process_inbound_email(event_data: dict) -> None:
    """Process a single inbound email event."""
    sender_info = event_data.get("from", {})
    sender_email = sender_info.get("address", "") if isinstance(sender_info, dict) else str(sender_info)
    subject = event_data.get("subject", "")
    attachments = event_data.get("attachments", [])

    logger.info("process_inbound_email: from=%s subject=%r", sender_email, subject)

    # ── APPROVE reply from lecturer ───────────────────────────────────────────
    if "APPROVE" in subject.upper():
        # Expected format: "APPROVE NER-SUBMISSION-{submission_id}"
        match = re.search(r"APPROVE\s+NER-SUBMISSION-([a-zA-Z0-9\-]+)", subject, re.IGNORECASE)
        if match:
            submission_id = match.group(1)
            logger.info("process_inbound_email: lecturer approval for submission %s", submission_id)
            await _approve_submission_internal(submission_id)
        else:
            logger.warning(
                "process_inbound_email: APPROVE in subject but no submission ID found: %r", subject
            )
        return

    # ── Student document submission ───────────────────────────────────────────

    # Parse submission code from subject: "[{CODE}] {anything}"
    code_match = re.search(r"\[([^\]]+)\]", subject)
    if not code_match:
        logger.warning("process_inbound_email: no submission code in subject %r", subject)
        await send_error(
            recipient_email=sender_email,
            recipient_name="Student",
            subject="Submission could not be processed",
            message=(
                "Your submission could not be processed. Please include "
                "your submission code in the subject line format:\n"
                "[NER-2026-CODE] Assignment Title"
            ),
        )
        return

    submission_code = code_match.group(1).strip()

    # ── Determine route: primary/secondary (join code) vs tertiary ────────────
    # Join codes are 6 uppercase alphanumeric chars (e.g. "A7B3K2").
    # Tertiary submission codes follow the NER-YYYY-... format.
    if re.match(r"^[A-Z0-9]{6}$", submission_code):
        await _run_primary_email_pipeline(
            subject=subject,
            submission_code=submission_code,
            sender_email=sender_email,
            attachments=attachments,
        )
        return

    # ── Tertiary: look up submission code in Cosmos ───────────────────────────
    code_results = await query_items(
        container_name="submission_codes",
        query="SELECT * FROM c WHERE c.code = @code AND c.active = true",
        parameters=[{"name": "@code", "value": submission_code}],
    )
    if not code_results:
        logger.warning("process_inbound_email: unknown or inactive code %r", submission_code)
        await send_error(
            recipient_email=sender_email,
            recipient_name="Student",
            subject="Invalid submission code",
            message=(
                f"The submission code '{submission_code}' was not found or is no longer active. "
                "Please check your submission code and try again, or contact your lecturer."
            ),
        )
        return

    code_doc = code_results[0]

    # Check attachments
    if not attachments:
        await send_error(
            recipient_email=sender_email,
            recipient_name="Student",
            subject="No document attached",
            message=(
                "No document attached to your submission. "
                "Please reply with your assignment document attached."
            ),
        )
        return

    # Take the first attachment
    attachment = attachments[0]
    filename = attachment.get("name", "submission.pdf")
    content_b64 = attachment.get("contentInBase64", "")
    try:
        file_bytes = base64.b64decode(content_b64)
    except Exception as exc:
        logger.error("process_inbound_email: failed to decode attachment: %s", exc)
        await send_error(
            recipient_email=sender_email,
            recipient_name="Student",
            subject="Attachment could not be read",
            message="Your attachment could not be read. Please try resending your submission.",
        )
        return

    logger.info(
        "process_inbound_email: processing submission code=%r file=%r bytes=%d",
        submission_code, filename, len(file_bytes),
    )

    # Build a synthetic create_submission call using the code doc metadata
    await _run_email_submission_pipeline(
        file_bytes=file_bytes,
        filename=filename,
        submission_code=submission_code,
        code_doc=code_doc,
        student_email=sender_email,
    )


async def _run_email_submission_pipeline(
    file_bytes: bytes,
    filename: str,
    submission_code: str,
    code_doc: dict,
    student_email: str,
) -> None:
    """Run the full grading pipeline for an email-submitted document."""
    from uuid import uuid4
    from datetime import datetime

    from shared.blob_client import generate_sas_url, upload_bytes, upload_marked
    from shared.document_extractor import detect_document_type, extract_text
    from shared.feedback_generator import generate_feedback_pdf
    from shared.models import Rubric, Submission, SubmissionStatus
    from shared.openai_client import grade_document
    from shared.cosmos_client import get_item, upsert_item
    from shared.email_client import send_draft_to_lecturer

    class_id    = code_doc["class_id"]
    teacher_id  = code_doc["teacher_id"]
    rubric_id   = code_doc["rubric_id"]
    assignment_name = code_doc["assignment_name"]

    try:
        # Extract text
        doc_type = detect_document_type(file_bytes, filename)
        extracted_text, doc_type = await extract_text(file_bytes, filename, doc_type)

        # Upload original document
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
        blob_uuid = str(uuid4())
        doc_blob = f"{teacher_id}/{class_id}/email/{blob_uuid}.{ext}"
        await upload_bytes(file_bytes, doc_blob, container_name="submissions",
                           content_type="application/octet-stream")
        document_url = generate_sas_url("submissions", doc_blob, expiry_hours=24 * 365)

        # Load rubric
        rubric_doc = await get_item("rubrics", rubric_id, class_id)
        rubric = Rubric(**rubric_doc)

        # Load class for education level
        try:
            class_doc = await get_item("classes", class_id, teacher_id)
        except Exception:
            class_doc = {}
        education_level = class_doc.get("education_level", "tertiary")

        # Grade
        verdicts, plagiarism_flag = await grade_document(extracted_text, rubric, education_level)
        total_score = sum(v.awarded_marks for v in verdicts)
        max_score   = sum(v.max_marks for v in verdicts)

        # Load teacher
        try:
            teacher_doc = await get_item("teachers", teacher_id, teacher_id)
        except Exception:
            teacher_doc = {}
        lecturer_name = teacher_doc.get("name", "Lecturer")

        # Generate PDF
        feedback_pdf_bytes = generate_feedback_pdf(
            student_name=sender_email_to_name(student_email),
            assignment_name=assignment_name,
            submission_code=submission_code,
            verdicts=verdicts,
            total_score=total_score,
            max_score=max_score,
            plagiarism_flag=plagiarism_flag,
            lecturer_name=lecturer_name,
        )

        # Upload feedback PDF
        pdf_blob = f"{teacher_id}/{class_id}/email/feedback_{blob_uuid}.pdf"
        await upload_marked(feedback_pdf_bytes, pdf_blob)
        feedback_pdf_url = generate_sas_url("marked", pdf_blob, expiry_hours=24 * 365)

        # Persist submission (student_id unknown for email submissions — use email as proxy)
        submission_id = str(uuid4())
        submission = Submission(
            id=submission_id,
            student_id=student_email,
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

        # Send draft to lecturer
        lecturer_email = teacher_doc.get("email")
        if lecturer_email:
            await send_draft_to_lecturer(
                lecturer_email=lecturer_email,
                lecturer_name=lecturer_name,
                student_name=student_email,
                assignment_name=assignment_name,
                total_score=total_score,
                max_score=max_score,
                feedback_pdf_bytes=feedback_pdf_bytes,
                submission_id=submission_id,
                submission_code=submission_code,
            )
        else:
            logger.warning(
                "_run_email_submission_pipeline: no email on teacher %s — skipping draft", teacher_id
            )

        logger.info(
            "_run_email_submission_pipeline: done submission_id=%s score=%.1f/%.1f",
            submission_id, total_score, max_score,
        )

    except Exception as exc:
        logger.exception(
            "_run_email_submission_pipeline: pipeline error for code=%s: %s", submission_code, exc
        )
        await send_error(
            recipient_email=student_email,
            recipient_name=sender_email_to_name(student_email),
            subject="Submission processing error",
            message=(
                "There was an error processing your submission. "
                "Please try resubmitting or contact your lecturer."
            ),
        )


async def _approve_submission_internal(submission_id: str) -> None:
    """Approve a submission directly (called from email APPROVE reply)."""
    from functions.submissions import approve_submission
    import azure.functions as func

    # Build a minimal synthetic request
    mock_req = func.HttpRequest(
        method="POST",
        url=f"https://neriah-func-dev.azurewebsites.net/api/submissions/{submission_id}/approve",
        headers={},
        body=b"",
    )
    response = await approve_submission(mock_req, submission_id)
    logger.info(
        "_approve_submission_internal: submission=%s response_status=%d",
        submission_id, response.status_code,
    )


def sender_email_to_name(email: str) -> str:
    """Derive a display name from an email address (local part before @)."""
    return email.split("@")[0].replace(".", " ").replace("_", " ").title()


async def _run_primary_email_pipeline(
    subject: str,
    submission_code: str,
    sender_email: str,
    attachments: list,
) -> None:
    """
    Handle primary/secondary student submissions submitted via email.
    Subject format: [JOIN_CODE] FirstName Surname - Assignment Title
    e.g. "[A7B3K2] Tendai Moyo - Term 1 Math Test"
    """
    from uuid import uuid4

    from shared.blob_client import generate_sas_url, upload_bytes
    from shared.cosmos_client import get_item, upsert_item
    from shared.email_client import send_error
    from shared.models import Mark
    from shared.annotator import annotate_image
    from shared.blob_client import upload_marked
    from shared.ocr_client import run_ocr
    from shared.openai_client import check_image_quality, grade_submission
    from shared.push_client import send_push_notification
    from shared.config import settings

    # Parse "Name - Assignment Title" from subject after the [CODE] bracket
    rest = re.sub(r"\[[^\]]+\]\s*", "", subject).strip()
    dash_match = re.match(r"^(.+?)\s+-\s+(.+)$", rest)
    if not dash_match:
        logger.warning(
            "_run_primary_email_pipeline: can't parse name/assignment from subject %r", subject
        )
        await send_error(
            recipient_email=sender_email,
            recipient_name="Student",
            subject="Submission could not be processed",
            message=(
                "Your submission subject line could not be parsed.\n"
                "Please use the format:\n"
                "[CLASS-CODE] First Surname - Assignment Title"
            ),
        )
        return

    full_name = dash_match.group(1).strip()
    assignment_title = dash_match.group(2).strip()
    name_parts = full_name.split()

    if len(name_parts) < 2:
        await send_error(
            recipient_email=sender_email,
            recipient_name="Student",
            subject="Submission could not be processed",
            message="Please include your full name (first name and surname) in the subject line.",
        )
        return

    # Resolve class by join code
    class_docs = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.join_code = @code",
        [{"name": "@code", "value": submission_code}],
    )
    if not class_docs:
        await send_error(
            recipient_email=sender_email,
            recipient_name=full_name,
            subject="Invalid class code",
            message=f"The class code '{submission_code}' was not found. Check the code and try again.",
        )
        return
    cls = class_docs[0]
    class_id = cls["id"]
    teacher_id = cls["teacher_id"]
    education_level = cls.get("education_level", "form_1")

    # Match student by email or name
    first = name_parts[0].lower()
    surname = " ".join(name_parts[1:]).lower()
    all_students = await query_items(
        "students",
        "SELECT * FROM c WHERE c.class_id = @cid",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    student = next(
        (
            s for s in all_students
            if s.get("first_name", "").lower() == first
            and s.get("surname", "").lower() == surname
        ),
        None,
    )
    if not student:
        logger.warning(
            "_run_primary_email_pipeline: student '%s' not found in class %s", full_name, class_id
        )
        await send_error(
            recipient_email=sender_email,
            recipient_name=full_name,
            subject="Student not found",
            message=(
                f"We couldn't find a student named '{full_name}' in this class. "
                "Please check your name matches your school records."
            ),
        )
        return

    student_id = student["id"]

    # Resolve answer key
    open_keys = await query_items(
        "answer_keys",
        "SELECT * FROM c WHERE c.class_id = @cid AND c.open_for_submission = true",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    title_lower = assignment_title.lower()
    matched_ak = next(
        (
            ak for ak in open_keys
            if title_lower in (ak.get("title") or ak.get("subject") or "").lower()
            or (ak.get("title") or ak.get("subject") or "").lower() in title_lower
        ),
        None,
    )
    if not matched_ak:
        await send_error(
            recipient_email=sender_email,
            recipient_name=full_name,
            subject="Assignment not found",
            message=(
                f"Assignment '{assignment_title}' was not found or is not accepting submissions. "
                "Please check the assignment title and try again."
            ),
        )
        return

    # Must have an image attachment
    image_attachment = next(
        (a for a in attachments if (a.get("contentType") or "").startswith("image/")),
        attachments[0] if attachments else None,
    )
    if not image_attachment:
        await send_error(
            recipient_email=sender_email,
            recipient_name=full_name,
            subject="No image attached",
            message="Please attach a photo of your work and resubmit.",
        )
        return

    import base64
    try:
        image_bytes = base64.b64decode(image_attachment.get("contentInBase64", ""))
    except Exception:
        await send_error(
            recipient_email=sender_email,
            recipient_name=full_name,
            subject="Attachment could not be read",
            message="Your attached image could not be read. Please try resubmitting.",
        )
        return

    try:
        # Quality gate
        quality = await check_image_quality(image_bytes)
        if not quality.pass_check:
            await send_error(
                recipient_email=sender_email,
                recipient_name=full_name,
                subject="Image quality too low",
                message=quality.suggestion or "The image quality is too low. Please retake and resubmit.",
            )
            return

        # Upload raw scan
        filename = image_attachment.get("name", "submission.jpg")
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "jpg"
        scan_blob = f"{teacher_id}/{class_id}/{student_id}/email_{uuid4()}.{ext}"
        await upload_bytes(
            image_bytes, scan_blob,
            container_name=settings.azure_storage_container_scans,
            content_type=image_attachment.get("contentType", "image/jpeg"),
        )

        # OCR + grade + annotate
        ocr_result = await run_ocr(image_bytes)
        ocr_text = ocr_result.full_text if hasattr(ocr_result, "full_text") else str(ocr_result)
        bounding_boxes = ocr_result.bounding_boxes if hasattr(ocr_result, "bounding_boxes") else None

        from shared.models import AnswerKey
        answer_key = AnswerKey(**matched_ak)
        verdicts = await grade_submission(ocr_text, answer_key, education_level)

        annotated_bytes = None
        if bounding_boxes:
            try:
                annotated_bytes = await annotate_image(image_bytes, bounding_boxes, verdicts)
            except Exception as exc:
                logger.warning("_run_primary_email_pipeline: annotation failed: %s", exc)

        marked_image_url = None
        if annotated_bytes:
            marked_blob = f"{teacher_id}/{class_id}/{student_id}/email_marked_{uuid4()}.jpg"
            await upload_marked(annotated_bytes, marked_blob)
            marked_image_url = generate_sas_url(
                settings.azure_storage_container_marked, marked_blob, expiry_hours=24 * 365
            )

        score = sum(v.awarded_marks for v in verdicts)
        max_score = sum(q.max_marks for q in answer_key.questions)

        mark = Mark(
            teacher_id=teacher_id,
            student_id=student_id,
            answer_key_id=matched_ak["id"],
            class_id=class_id,
            score=score,
            max_score=max_score,
            percentage=round(score / max_score * 100, 2) if max_score else None,
            marked_image_url=marked_image_url,
            raw_ocr_text=ocr_text,
            source="email",
            approved=False,
        )
        await upsert_item("marks", mark.model_dump(mode="json"))

        logger.info(
            "_run_primary_email_pipeline: done mark_id=%s score=%.1f/%.1f",
            mark.id, score, max_score,
        )

        # Notify teacher
        teacher_docs = await query_items(
            "teachers",
            "SELECT c.push_token FROM c WHERE c.id = @id",
            [{"name": "@id", "value": teacher_id}],
        )
        if teacher_docs and teacher_docs[0].get("push_token"):
            ak_title = matched_ak.get("title") or matched_ak.get("subject", "assignment")
            await send_push_notification(
                teacher_docs[0]["push_token"],
                title="New submission",
                body=f"{full_name} submitted {ak_title}",
                data={"mark_id": mark.id, "class_id": class_id},
            )

    except Exception as exc:
        logger.exception(
            "_run_primary_email_pipeline: pipeline error for %s: %s", full_name, exc
        )
        await send_error(
            recipient_email=sender_email,
            recipient_name=full_name,
            subject="Submission processing error",
            message="There was an error processing your submission. Please try resubmitting.",
        )
