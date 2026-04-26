"""
shared/email_parser.py — RFC822 MIME parsing for the email-submission channel.

The Zoho IMAP poller (functions/email_poller.py) pulls full RFC822 bytes
from the inbox; this module converts those bytes into a structured
ParsedEmail with fields the rest of the pipeline expects:

  - sender              the From: address
  - subject             raw Subject: header (passed to student_matcher
                        for the "Name | Class | School" parse)
  - body_text           plain-text body (fallback search for matcher
                        fields when the subject line is missing or
                        unparseable)
  - usable_attachments  filtered list of (filename, bytes, content_type)
                        for image/* and application/pdf, ≤ MAX_BYTES each.
                        Other types (zip, doc, html, signatures, inline
                        Outlook image1.png decoration) are dropped.

ATTACHMENT_LIMIT_BYTES is intentionally small (10 MB per part) — students
photographing a single page rarely need more, and it caps the cost of a
single grading job. Larger files trigger the format-error reply.
"""

from __future__ import annotations

import email
import logging
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import parseaddr

logger = logging.getLogger(__name__)

ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024  # 10 MB per attachment

# Whitelist of content types we feed downstream. Anything else is logged
# and dropped. Vision/Gemma can read image/* directly; PDFs are rendered
# to JPEGs upstream by shared.pdf_pages.pdf_to_jpegs before grading.
_USABLE_CT_PREFIXES = ("image/",)
_USABLE_CT_EXACT = {"application/pdf"}


@dataclass
class ParsedEmail:
    sender: str = ""
    subject: str = ""
    body_text: str = ""
    usable_attachments: list[tuple[str, bytes, str]] = field(default_factory=list)
    # Raw counts so callers can produce specific format-error reasons
    # without re-parsing — e.g. "you attached a .docx, please send a
    # photo or PDF instead".
    skipped_attachments: list[tuple[str, str, str]] = field(default_factory=list)
    """List of (filename, content_type, reason) for attachments that
    didn't make it into usable_attachments."""

    @property
    def has_usable_attachment(self) -> bool:
        return len(self.usable_attachments) > 0


def _is_usable_content_type(ct: str) -> bool:
    if not ct:
        return False
    ct = ct.lower()
    if ct in _USABLE_CT_EXACT:
        return True
    return any(ct.startswith(p) for p in _USABLE_CT_PREFIXES)


def _extract_text_body(msg: EmailMessage) -> str:
    """Pull the plain-text body. Falls back to stripped HTML if no
    text/plain part exists (some mail clients send HTML-only). Doesn't
    bother with full HTML→text conversion — the matcher only needs to
    spot Name/Class/School tokens, and a regex over raw HTML works well
    enough for that fallback."""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get_filename():
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        # No text/plain part — try text/html
        for part in msg.walk():
            if part.get_content_type() == "text/html" and not part.get_filename():
                payload = part.get_payload(decode=True)
                if payload:
                    return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        return ""
    payload = msg.get_payload(decode=True)
    if not payload:
        return ""
    return payload.decode(msg.get_content_charset() or "utf-8", errors="replace")


def _walk_attachments(msg: EmailMessage) -> tuple[list[tuple[str, bytes, str]], list[tuple[str, str, str]]]:
    """Walk all parts and split into (usable, skipped)."""
    usable: list[tuple[str, bytes, str]] = []
    skipped: list[tuple[str, str, str]] = []

    if not msg.is_multipart():
        # Single-part messages can't carry attachments.
        return usable, skipped

    for part in msg.walk():
        if part.is_multipart():
            continue
        # An attachment requires either explicit Content-Disposition:
        # attachment OR a filename. Inline images sometimes lack the
        # former — that's fine, we still want them as usable photos.
        filename = part.get_filename() or ""
        ct = (part.get_content_type() or "").lower()
        if not filename and ct.startswith("text/"):
            # Body part, already captured by _extract_text_body.
            continue

        payload = part.get_payload(decode=True)
        if payload is None:
            continue

        if not _is_usable_content_type(ct):
            skipped.append((filename or "(unnamed)", ct, "unsupported content type"))
            continue
        if len(payload) > ATTACHMENT_LIMIT_BYTES:
            skipped.append((
                filename or "(unnamed)",
                ct,
                f"too large ({len(payload) // (1024 * 1024)} MB > {ATTACHMENT_LIMIT_BYTES // (1024 * 1024)} MB)",
            ))
            continue

        usable.append((filename or _default_filename(ct), payload, ct))

    return usable, skipped


def _default_filename(content_type: str) -> str:
    """Generate a reasonable filename for an inline attachment that didn't
    declare one. Used only for the Resend reply attachment list and the
    Failed/Processed folder logs — never for storage keying."""
    if content_type == "application/pdf":
        return "submission.pdf"
    if content_type.startswith("image/"):
        ext = content_type.split("/", 1)[1] or "jpg"
        # normalise the common variants
        if ext in ("jpeg", "pjpeg"):
            ext = "jpg"
        return f"submission.{ext}"
    return "submission.bin"


def parse_rfc822(raw: bytes) -> ParsedEmail:
    """Parse a raw RFC822 message into a ParsedEmail.

    Always returns a ParsedEmail (never raises) — failures populate
    skipped_attachments and leave usable_attachments empty so the caller
    can drive the format-error reply path off has_usable_attachment.
    """
    try:
        msg: EmailMessage = email.message_from_bytes(raw, _class=EmailMessage)  # type: ignore[arg-type]
    except Exception:
        logger.exception("parse_rfc822: failed to parse %d bytes", len(raw))
        return ParsedEmail()

    _, sender = parseaddr(msg.get("From", ""))
    subject = (msg.get("Subject") or "").strip()
    body_text = _extract_text_body(msg)
    usable, skipped = _walk_attachments(msg)

    return ParsedEmail(
        sender=sender,
        subject=subject,
        body_text=body_text,
        usable_attachments=usable,
        skipped_attachments=skipped,
    )
