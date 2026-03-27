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

from shared.cosmos_client import query_items
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

    # Look up submission code in Cosmos
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
