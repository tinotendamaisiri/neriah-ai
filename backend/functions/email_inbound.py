# functions/email_inbound.py
# POST /api/email/inbound — receives SendGrid Inbound Parse webhooks.
#
# Students can email their homework photos to submit@neriah.ai.
# The system identifies them by sender email, finds their open assignment,
# stores every image attachment as a pending submission, and notifies the teacher.
#
# Security:
#   SendGrid sends a POST to this endpoint.  We validate a shared secret
#   passed as ?token=<email_inbound_secret> in the webhook URL.
#   We always return HTTP 200 even on auth or processing failure — returning
#   a non-2xx would cause SendGrid to retry the same email.

from __future__ import annotations

import logging
import re
from datetime import datetime
from uuid import uuid4

import azure.functions as func

from shared.blob_client import generate_sas_url, upload_bytes as blob_upload_bytes
from shared.config import settings
from shared.cosmos_client import query_items, upsert_item
from shared.email_client import send_inbound_reply
from shared.models import Mark

logger = logging.getLogger(__name__)

# ── Helpers ───────────────────────────────────────────────────────────────────

# Accepted image MIME types
_IMAGE_TYPES = {
    "image/jpeg", "image/jpg", "image/png",
    "image/webp", "image/heic", "image/heif",
}

_EMAIL_RE = re.compile(r'[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}')


def _extract_email(from_header: str) -> str | None:
    """Extract bare email address from a From header like 'Name <email@example.com>'."""
    m = _EMAIL_RE.search(from_header)
    return m.group(0).lower() if m else None


def _ok() -> func.HttpResponse:
    """Always return 200 to SendGrid to prevent retries."""
    return func.HttpResponse("OK", status_code=200)


# ── Main handler ──────────────────────────────────────────────────────────────

async def handle_email_inbound(req: func.HttpRequest) -> func.HttpResponse:
    """Handle a SendGrid Inbound Parse POST.

    Flow:
      1. Verify shared secret (token query param).
      2. Parse sender email from the `from` form field.
      3. Look up student by email address in Cosmos.
      4. Find the student's open assignment (answer key with open_for_submission=True).
      5. Extract image attachments from req.files.
      6. Upload each image to Azure Blob Storage (scans container).
      7. Create a pending Mark document for each image.
      8. Send a confirmation reply to the sender.
      9. Notify the teacher via push notification.

    We always return 200 — see module docstring.
    """
    # ── 1. Verify shared secret ───────────────────────────────────────────────
    if settings.email_inbound_secret:
        token = req.params.get("token", "")
        if token != settings.email_inbound_secret:
            logger.warning("email/inbound: bad secret token — dropping silently")
            return _ok()  # return 200 to avoid SendGrid retries

    # ── 2. Parse sender email ─────────────────────────────────────────────────
    try:
        form = req.form
    except Exception:
        logger.warning("email/inbound: could not parse form data")
        return _ok()

    from_header = form.get("from", "")
    sender_email = _extract_email(from_header)

    if not sender_email:
        logger.info("email/inbound: no parseable sender email in '%s'", from_header)
        return _ok()

    subject = form.get("subject", "(no subject)")
    logger.info("email/inbound: from=%s subject=%s", sender_email, subject)

    # ── 3. Look up student by email ───────────────────────────────────────────
    student_results = await query_items(
        container_name="students",
        query="SELECT * FROM c WHERE c.email = @email",
        parameters=[{"name": "@email", "value": sender_email}],
    )

    if not student_results:
        logger.info("email/inbound: no student found for email %s", sender_email)
        await send_inbound_reply(
            to_email=sender_email,
            subject=f"Re: {subject}",
            body=(
                "Hi,\n\n"
                "We received your email but could not find a Neriah account linked to this address.\n\n"
                "To submit homework by email, please add your email address to your Neriah account "
                "in the app under Settings, then try again.\n\n"
                "Neriah\nneriah.ai"
            ),
        )
        return _ok()

    student_doc = student_results[0]
    student_id: str = student_doc["id"]
    class_id: str = student_doc.get("class_id", "")
    student_name = f"{student_doc.get('first_name', '')} {student_doc.get('surname', '')}".strip()

    # ── 4. Find open assignment ───────────────────────────────────────────────
    ak_results = await query_items(
        container_name="answer_keys",
        query=(
            "SELECT * FROM c "
            "WHERE c.class_id = @class_id "
            "AND c.open_for_submission = true "
            "ORDER BY c.created_at DESC"
        ),
        parameters=[{"name": "@class_id", "value": class_id}],
        partition_key=class_id,
    )

    if not ak_results:
        logger.info("email/inbound: no open assignment for class_id=%s", class_id)
        await send_inbound_reply(
            to_email=sender_email,
            subject=f"Re: {subject}",
            body=(
                f"Hi {student_doc.get('first_name', '')},\n\n"
                "We received your email but your teacher has not opened any assignments for submission yet.\n\n"
                "Please check with your teacher and try again when an assignment is open.\n\n"
                "Neriah\nneriah.ai"
            ),
        )
        return _ok()

    # Use the most recently created open assignment
    ak_doc = ak_results[0]
    answer_key_id: str = ak_doc["id"]
    teacher_id: str = ak_doc.get("teacher_id", "")
    assignment_title: str = ak_doc.get("title") or ak_doc.get("subject", "Homework")

    # ── 5. Extract image attachments ──────────────────────────────────────────
    try:
        attachment_count = int(form.get("attachments", "0"))
    except (ValueError, TypeError):
        attachment_count = 0

    image_files: list[tuple[str, bytes]] = []

    for i in range(1, attachment_count + 1):
        key = f"attachment{i}"
        file = req.files.get(key)
        if file is None:
            continue
        content_type = (file.content_type or "").lower()
        if content_type not in _IMAGE_TYPES:
            logger.debug("email/inbound: skipping non-image attachment '%s' (%s)", key, content_type)
            continue
        data = file.read()
        if len(data) < 10_000:  # skip thumbnails < 10 KB
            continue
        image_files.append((content_type, data))

    if not image_files:
        logger.info("email/inbound: no valid image attachments from %s", sender_email)
        await send_inbound_reply(
            to_email=sender_email,
            subject=f"Re: {subject}",
            body=(
                f"Hi {student_doc.get('first_name', '')},\n\n"
                "We received your email but could not find any image attachments.\n\n"
                "Please reply with a clear photo of each page of your work and try again.\n\n"
                "Tips:\n"
                "  • Use JPEG or PNG format\n"
                "  • Make sure the page is well-lit and fully in frame\n"
                "  • Attach each page as a separate image\n\n"
                "Neriah\nneriah.ai"
            ),
        )
        return _ok()

    # ── 6 & 7. Upload images and create pending Mark documents ────────────────
    created_mark_ids: list[str] = []

    for idx, (content_type, image_bytes) in enumerate(image_files):
        ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else "png"
        blob_name = f"{teacher_id}/{class_id}/{student_id}/email_{uuid4().hex[:8]}_{idx}.{ext}"

        try:
            await blob_upload_bytes(
                file_bytes=image_bytes,
                blob_name=blob_name,
                container_name=settings.azure_storage_container_scans,
                content_type=content_type,
            )
        except Exception as exc:
            logger.error("email/inbound: blob upload failed for %s: %s", blob_name, exc)
            continue

        sas_url = generate_sas_url(
            container_name=settings.azure_storage_container_scans,
            blob_name=blob_name,
            expiry_hours=24 * 7,  # 1 week — gives teacher time to review
        )

        mark = Mark(
            student_id=student_id,
            answer_key_id=answer_key_id,
            teacher_id=teacher_id,
            score=0.0,
            max_score=float(ak_doc.get("total_marks") or len(ak_doc.get("questions", [])) or 1),
            marked_image_url=sas_url,
            raw_ocr_text="",           # filled in if/when teacher triggers re-grading
            class_id=class_id,
            source="email",
            approved=False,
            file_type="image",
            timestamp=datetime.utcnow(),
        )
        await upsert_item("marks", mark.model_dump(mode="json"))
        created_mark_ids.append(mark.id)
        logger.info(
            "email/inbound: created mark %s for student=%s answer_key=%s",
            mark.id, student_id, answer_key_id,
        )

    if not created_mark_ids:
        logger.error("email/inbound: all uploads failed for %s — no marks created", sender_email)
        await send_inbound_reply(
            to_email=sender_email,
            subject=f"Re: {subject}",
            body=(
                f"Hi {student_doc.get('first_name', '')},\n\n"
                "Sorry, we had a problem receiving your submission. Please try again "
                "or submit via the Neriah app.\n\n"
                "Neriah\nneriah.ai"
            ),
        )
        return _ok()

    # ── 8. Send confirmation reply ────────────────────────────────────────────
    page_word = "page" if len(created_mark_ids) == 1 else "pages"
    await send_inbound_reply(
        to_email=sender_email,
        subject=f"Re: {subject}",
        body=(
            f"Hi {student_doc.get('first_name', '')},\n\n"
            f"We received your submission for '{assignment_title}' "
            f"({len(created_mark_ids)} {page_word}).\n\n"
            "Your teacher will review and mark your work. "
            "You'll receive your results in the Neriah app.\n\n"
            "Neriah\nneriah.ai"
        ),
    )

    # ── 9. Notify teacher via push ────────────────────────────────────────────
    if teacher_id:
        try:
            from functions.push import send_teacher_notification  # lazy import to avoid circular
            page_word_teacher = "page" if len(created_mark_ids) == 1 else "pages"
            await send_teacher_notification(
                teacher_id=teacher_id,
                title=f"Email submission — {student_name}",
                body=f"{student_name} submitted {len(created_mark_ids)} {page_word_teacher} for {assignment_title} via email.",
                data={
                    "screen": "HomeworkDetail",
                    "answer_key_id": answer_key_id,
                    "class_id": class_id,
                    "class_name": "",
                },
            )
        except Exception as exc:
            logger.warning("email/inbound: push notify failed: %s", exc)

    return _ok()
