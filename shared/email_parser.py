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

import base64
import binascii
import email
import logging
import re
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


def _collect_html_bodies(msg: EmailMessage) -> list[str]:
    """Return every text/html body part's decoded string. Used by the
    data-URI extractor below — when a student "pastes" an image into
    Gmail's compose field, the image often arrives base64-embedded as
    a `<img src="data:image/jpeg;base64,...">` tag inside the HTML body
    rather than as a separate MIME attachment."""
    out: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/html" and not part.get_filename():
                payload = part.get_payload(decode=True)
                if payload:
                    out.append(
                        payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                    )
    elif msg.get_content_type() == "text/html":
        payload = msg.get_payload(decode=True)
        if payload:
            out.append(msg.get_content_charset() or "utf-8")
    return out


# Matches data: URIs in HTML, e.g.
#   src="data:image/jpeg;base64,/9j/4AAQ…"
#   src='data:image/png;base64,iVBORw0KGgo…'
# We only extract image/* and application/pdf to mirror the MIME
# attachment whitelist; case-insensitive content type. Greedy match on
# the base64 body — the tag's closing quote is the terminator.
_DATA_URI_RE = re.compile(
    r"""data:(?P<ct>(?:image/[a-z0-9.+\-]+|application/pdf))\s*;\s*base64\s*,\s*(?P<data>[A-Za-z0-9+/=\s]+?)(?=["'])""",
    re.IGNORECASE,
)


def _extract_data_uri_attachments(html_bodies: list[str]) -> tuple[list[tuple[str, bytes, str]], list[tuple[str, str, str]]]:
    """Sweep HTML bodies for `data:image/...;base64,...` URIs and decode
    each into a usable attachment. Skips ones that fail to base64-decode
    (malformed paste) and ones that exceed ATTACHMENT_LIMIT_BYTES.
    """
    usable: list[tuple[str, bytes, str]] = []
    skipped: list[tuple[str, str, str]] = []
    seen: set[bytes] = set()

    for body in html_bodies:
        for i, m in enumerate(_DATA_URI_RE.finditer(body)):
            ct = m.group("ct").lower()
            b64 = m.group("data")
            # Strip whitespace introduced by HTML word-wrap before
            # decoding — base64 is whitespace-tolerant in spec but
            # Python's b64decode is stricter without validate=False.
            b64_clean = re.sub(r"\s+", "", b64)
            try:
                payload = base64.b64decode(b64_clean, validate=True)
            except (binascii.Error, ValueError):
                skipped.append(("(pasted image)", ct, "malformed base64 in data: URI"))
                continue
            # Dedup identical bytes — Gmail sometimes wraps the same
            # image in cid: AND data: URIs simultaneously.
            sig = payload[:64] + bytes([len(payload) % 251])
            if sig in seen:
                continue
            seen.add(sig)

            if len(payload) > ATTACHMENT_LIMIT_BYTES:
                skipped.append((
                    "(pasted image)", ct,
                    f"too large ({len(payload) // (1024 * 1024)} MB > {ATTACHMENT_LIMIT_BYTES // (1024 * 1024)} MB)",
                ))
                continue

            usable.append((_default_filename(ct), payload, ct))

    return usable, skipped


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

    # Some clients (notably Gmail iOS when you long-press → paste a
    # photo into the compose field) send the image as a base64 data:
    # URI inside the HTML body rather than as a MIME attachment. The
    # MIME walk above wouldn't see those, so do a second pass over the
    # HTML bodies and pull any data: URIs into the usable list.
    html_bodies = _collect_html_bodies(msg)
    if html_bodies:
        embedded_usable, embedded_skipped = _extract_data_uri_attachments(html_bodies)
        usable.extend(embedded_usable)
        skipped.extend(embedded_skipped)

    # Diagnostic dump — only fires when we found nothing usable, so the
    # log isn't spammed by happy-path emails. Lists each MIME part's
    # content type + filename + Content-Disposition + size, plus the
    # first 200 chars of any HTML body so we can spot data: URIs that
    # didn't match the regex (different encoding, weird whitespace,
    # quote style, etc).
    if not usable:
        try:
            parts_summary = []
            for part in msg.walk() if msg.is_multipart() else [msg]:
                if part.is_multipart():
                    continue
                payload = part.get_payload(decode=True)
                size = len(payload) if payload else 0
                parts_summary.append(
                    f"[ct={part.get_content_type()} "
                    f"name={part.get_filename()!r} "
                    f"disp={part.get('Content-Disposition')!r} "
                    f"size={size}]"
                )
            logger.info("email_parser diag: parts=%s", " ".join(parts_summary))
            for i, body in enumerate(html_bodies[:2]):
                snippet = body[:300].replace("\n", " ")
                logger.info("email_parser diag: html_body[%d][:300]=%r", i, snippet)
        except Exception:
            logger.exception("email_parser diag: dump failed")

    return ParsedEmail(
        sender=sender,
        subject=subject,
        body_text=body_text,
        usable_attachments=usable,
        skipped_attachments=skipped,
    )
