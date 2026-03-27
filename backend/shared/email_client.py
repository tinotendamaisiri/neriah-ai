# shared/email_client.py
# Handles all email operations for the Neriah tertiary module.
# Uses Azure Communication Services EmailClient.
# All send functions are async.

from __future__ import annotations

import base64
import logging

from .config import settings

logger = logging.getLogger(__name__)

# ── Lazy singleton ────────────────────────────────────────────────────────────

_client = None


def _get_client():
    """Return the module-level EmailClient, creating it on first call."""
    from azure.communication.email import EmailClient  # noqa: PLC0415 — lazy import
    global _client
    if _client is None:
        _client = EmailClient.from_connection_string(
            settings.azure_communication_connection_string
        )
    return _client


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_attachment(filename: str, pdf_bytes: bytes) -> dict:
    """Return an attachment dict in the format required by Azure Communication Services."""
    return {
        "name": filename,
        "mimeType": "application/pdf",
        "contentInBase64": base64.b64encode(pdf_bytes).decode(),
    }


def _percentage(score: float, max_score: float) -> int:
    """Return integer percentage, 0–100, zero-division safe."""
    if max_score == 0:
        return 0
    return min(100, max(0, round(score / max_score * 100)))


def _send(subject: str, to_email: str, to_name: str, body: str, attachments: list[dict] | None = None) -> dict:
    """Send an email via Azure Communication Services and return the result dict."""
    client = _get_client()
    message: dict = {
        "senderAddress": settings.neriah_email_from_address,
        "recipients": {
            "to": [{"address": to_email, "displayName": to_name}],
        },
        "content": {
            "subject": subject,
            "plainText": body,
        },
    }
    if attachments:
        message["attachments"] = attachments

    logger.info("email: sending '%s' to %s", subject, to_email)
    poller = client.begin_send(message)
    result = poller.result()
    return {"status": result.status}


# ── Send functions ────────────────────────────────────────────────────────────

async def send_feedback_to_student(
    student_email: str,
    student_name: str,
    assignment_name: str,
    total_score: float,
    max_score: float,
    feedback_pdf_bytes: bytes,
    submission_code: str,
) -> dict:
    """Send approved feedback PDF to the student."""
    pct = _percentage(total_score, max_score)
    subject = f"Your feedback is ready — {assignment_name}"
    body = (
        f"Dear {student_name},\n\n"
        f"Your assignment '{assignment_name}' has been marked and your\n"
        f"feedback is ready.\n\n"
        f"Score: {total_score}/{max_score} ({pct}%)\n\n"
        f"Please find your detailed feedback report attached.\n\n"
        f"Submission reference: {submission_code}\n\n"
        f"Neriah Assessment System\n"
        f"neriah.africa"
    )
    try:
        return _send(
            subject=subject,
            to_email=student_email,
            to_name=student_name,
            body=body,
            attachments=[_make_attachment(f"feedback_{submission_code}.pdf", feedback_pdf_bytes)],
        )
    except Exception as exc:
        logger.error("send_feedback_to_student failed for %s: %s", student_email, exc)
        return {"error": str(exc)}


async def send_draft_to_lecturer(
    lecturer_email: str,
    lecturer_name: str,
    student_name: str,
    assignment_name: str,
    total_score: float,
    max_score: float,
    feedback_pdf_bytes: bytes,
    submission_id: str,
    submission_code: str,
    function_key: str = "",
) -> dict:
    """Send draft feedback to the lecturer for review before release."""
    pct = _percentage(total_score, max_score)
    subject = f"New submission ready for review — {student_name}"
    approve_url = (
        f"{settings.function_app_url}/api/submissions/{submission_id}/approve"
        + (f"?code={function_key}" if function_key else "")
    )
    body = (
        f"Dear {lecturer_name},\n\n"
        f"A new submission has been graded and is awaiting your approval\n"
        f"before being released to the student.\n\n"
        f"Student: {student_name}\n"
        f"Assignment: {assignment_name}\n"
        f"Draft score: {total_score}/{max_score} ({pct}%)\n"
        f"Submission ID: {submission_id}\n\n"
        f"The draft feedback report is attached. To approve and release\n"
        f"to the student, click this link:\n"
        f"{approve_url}\n\n"
        f"Or log in to the Neriah App to review and approve.\n\n"
        f"Neriah Assessment System\n"
        f"neriah.africa"
    )
    try:
        return _send(
            subject=subject,
            to_email=lecturer_email,
            to_name=lecturer_name,
            body=body,
            attachments=[_make_attachment(f"DRAFT_feedback_{submission_code}.pdf", feedback_pdf_bytes)],
        )
    except Exception as exc:
        logger.error("send_draft_to_lecturer failed for %s: %s", lecturer_email, exc)
        return {"error": str(exc)}


async def send_welcome_email(
    recipient_email: str,
    recipient_name: str,
    role: str,
) -> dict:
    """Send a welcome email when a new user registers."""
    subject = "Welcome to Neriah — your AI marking assistant"

    if role in ("teacher", "lecturer"):
        body = (
            f"Dear {recipient_name},\n\n"
            f"Welcome to Neriah!\n\n"
            f"You can start marking immediately by sending a photo of a\n"
            f"student's work to our WhatsApp number or via the Neriah App.\n\n"
            f"Need help? Reply to this email or WhatsApp us.\n\n"
            f"Neriah Assessment System\n"
            f"neriah.africa"
        )
    else:  # admin
        body = (
            f"Dear {recipient_name},\n\n"
            f"Your school has been registered on Neriah.\n\n"
            f"Your teachers can now start marking. You will receive weekly\n"
            f"performance summaries every Monday.\n\n"
            f"Neriah Assessment System\n"
            f"neriah.africa"
        )

    try:
        return _send(
            subject=subject,
            to_email=recipient_email,
            to_name=recipient_name,
            body=body,
        )
    except Exception as exc:
        logger.error("send_welcome_email failed for %s: %s", recipient_email, exc)
        return {"error": str(exc)}


async def send_weekly_report(
    admin_email: str,
    admin_name: str,
    school_name: str,
    report_pdf_bytes: bytes,
    week_ending: str,
) -> dict:
    """Send weekly school performance report to admin."""
    subject = f"Weekly marking report — {school_name} — w/e {week_ending}"
    body = (
        f"Dear {admin_name},\n\n"
        f"Please find attached the weekly marking report for {school_name} "
        f"for the week ending {week_ending}.\n\n"
        f"Open the attached PDF for a full breakdown of marking activity, "
        f"scores, and class performance for the week.\n\n"
        f"Neriah Assessment System\n"
        f"neriah.africa"
    )
    try:
        return _send(
            subject=subject,
            to_email=admin_email,
            to_name=admin_name,
            body=body,
            attachments=[_make_attachment(f"weekly_report_{week_ending}.pdf", report_pdf_bytes)],
        )
    except Exception as exc:
        logger.error("send_weekly_report failed for %s: %s", admin_email, exc)
        return {"error": str(exc)}


async def send_error(
    recipient_email: str,
    recipient_name: str,
    subject: str,
    message: str,
) -> dict:
    """Send a generic error notification email."""
    try:
        return _send(
            subject=subject,
            to_email=recipient_email,
            to_name=recipient_name,
            body=message,
        )
    except Exception as exc:
        logger.error("send_error failed for %s: %s", recipient_email, exc)
        return {"error": str(exc)}
