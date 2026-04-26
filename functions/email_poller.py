"""
functions/email_poller.py — inbound email submission channel.

Cloud Function triggered by a Pub/Sub message every ~60 s (Cloud Scheduler
publishes the trigger). On each invocation:

  1. Acquire a Firestore lock so a slow run can't be doubled up by the
     next tick (set Cloud Function maxInstanceCount=1 as belt+braces).
  2. Connect to Zoho IMAP at mark@neriah.ai.
  3. Fetch every UID > the stored cursor.
  4. For each message:
       - parse MIME (shared.email_parser)
       - resolve student via subject "Name | Class | School"
         (shared.student_matcher) — auto-enrols on no-match
       - render PDF pages → JPEGs (shared.pdf_pages)
       - call the multi-page Gemma grader
       - annotate, upload originals + annotated to GCS
       - persist Mark + companion student_submissions row
       - MOVE the message to a Processed folder
  5. On exception per message: MOVE to Failed folder, log, advance cursor.
     Single-message failures must not block the queue behind them.
  6. Update cursor to the highest UID processed in this run.
  7. Release lock.

The Resend grade-reply does NOT fire from here. It fires from the
approval handler in functions/submissions.py once the teacher has signed
off — same policy as every other channel ("teacher approves first").

Entry points:
  - poll_email_pubsub(event, context)   Pub/Sub event handler (prod)
  - poll_email_once()                   sync helper for tests + local dev
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

from shared.config import settings
from shared.email_client import send_format_error
from shared.email_parser import ParsedEmail, parse_rfc822
from shared.firestore_client import get_doc, query, upsert
from shared.gcs_client import upload_bytes, generate_signed_url
from shared.gemma_client import (
    check_image_quality_strict,
    grade_submission_strict_multi,
)
from shared.annotator import annotate_pages
from shared.models import GradingVerdict, Mark
from shared.pdf_pages import attachments_to_pages
from shared.student_matcher import (
    MatchResult,
    MatchStatus,
    parse_subject,
    match_student,
)

logger = logging.getLogger(__name__)


# ─── Constants ────────────────────────────────────────────────────────────────

# Tuned to cover one full run on a slow IMAP + grading pipeline. If a run
# exceeds this, the next tick will see the lock as expired and proceed.
LOCK_TTL_SECONDS = 240

# Folder names Zoho creates on demand the first time we MOVE a message
# into them. They're standard IMAP folder names — no Zoho-specific
# prefix required.
PROCESSED_FOLDER = "Processed"
FAILED_FOLDER = "Failed"

# Cursor doc lives in its own Firestore collection so it never collides
# with anything else and is easy to inspect/reset manually.
CURSOR_COLLECTION = "email_poller_state"
CURSOR_DOC_ID = "mark_inbox"


# ─── Lock + cursor helpers ────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_epoch() -> int:
    return int(time.time())


def _acquire_lock() -> Optional[str]:
    """Set a lock holder + expiry on the cursor doc. Returns the holder
    token on success, None when another run is already in flight."""
    state = get_doc(CURSOR_COLLECTION, CURSOR_DOC_ID) or {}
    expires = state.get("lock_expires_at", 0)
    if expires and expires > _now_epoch():
        logger.info(
            "email_poller: another run holds lock until %s — skipping",
            expires,
        )
        return None
    holder = uuid.uuid4().hex
    upsert(CURSOR_COLLECTION, CURSOR_DOC_ID, {
        **state,
        "lock_holder": holder,
        "lock_expires_at": _now_epoch() + LOCK_TTL_SECONDS,
    })
    return holder


def _release_lock(holder: str, last_uid: Optional[int]) -> None:
    state = get_doc(CURSOR_COLLECTION, CURSOR_DOC_ID) or {}
    if state.get("lock_holder") != holder:
        # Lost the lock to a takeover — don't trample whoever holds it
        # now, and don't write the cursor either (ours might be stale).
        logger.warning("email_poller: lock no longer ours, skipping release")
        return
    update: dict = {
        "lock_holder": None,
        "lock_expires_at": 0,
        "last_run_at": _now_iso(),
    }
    if last_uid is not None:
        update["last_uid"] = last_uid
    upsert(CURSOR_COLLECTION, CURSOR_DOC_ID, {**state, **update})


def _read_cursor() -> int:
    state = get_doc(CURSOR_COLLECTION, CURSOR_DOC_ID) or {}
    return int(state.get("last_uid") or 0)


# ─── IMAP plumbing ────────────────────────────────────────────────────────────

def _open_mailbox():
    """Connect + login to Zoho via imap_tools. Caller MUST close. Returns
    None when ZOHO_IMAP_PASSWORD is unset (local dev, no creds)."""
    if not settings.ZOHO_IMAP_PASSWORD:
        logger.warning("email_poller: ZOHO_IMAP_PASSWORD unset, skipping run")
        return None
    from imap_tools import MailBox  # local import — heavy dep
    box = MailBox(settings.ZOHO_IMAP_HOST, port=settings.ZOHO_IMAP_PORT).login(
        settings.ZOHO_IMAP_USER,
        settings.ZOHO_IMAP_PASSWORD,
        initial_folder="INBOX",
    )
    return box


def _ensure_folders(box) -> None:
    """Create Processed and Failed folders on first use. imap_tools'
    folder.create is idempotent against ALREADYEXISTS responses on Zoho."""
    for folder in (PROCESSED_FOLDER, FAILED_FOLDER):
        try:
            box.folder.create(folder)
        except Exception:
            # Already exists or server rejected — fine, the MOVE later
            # will surface a real error if the folder genuinely isn't
            # there.
            pass


# ─── Per-message processing ───────────────────────────────────────────────────

def _process_message(parsed: ParsedEmail) -> str:
    """Run the full grading pipeline on a single inbound message.

    Returns the destination folder name (PROCESSED_FOLDER or FAILED_FOLDER)
    so the caller knows where to MOVE the message after.
    """
    sender = parsed.sender
    # Diagnostic line — fires for every inbound message regardless of
    # outcome so we can compare what the parser saw against what the
    # student actually sent. Fields kept short so a few lines fit in
    # one log entry. Body length only (not contents) to avoid leaking
    # PII into Cloud Logging.
    logger.info(
        "email_poller: received from=%s subject=%r body_len=%d usable=%d skipped=%d",
        sender,
        parsed.subject[:120],
        len(parsed.body_text or ""),
        len(parsed.usable_attachments),
        len(parsed.skipped_attachments),
    )
    if parsed.skipped_attachments:
        for fname, ct, why in parsed.skipped_attachments[:5]:
            logger.info(
                "email_poller: skipped attachment name=%r ct=%s reason=%s",
                fname, ct, why,
            )

    if not parsed.has_usable_attachment:
        # No image / PDF attached — auto-reply with the format guide.
        # This is a system-status reply, not a grade, so the
        # teacher-approves-first rule doesn't apply.
        reasons = []
        if parsed.skipped_attachments:
            for fname, ct, why in parsed.skipped_attachments[:3]:
                reasons.append(f"{fname or '(unnamed)'} ({ct}): {why}")
            reason = "Your attachments couldn't be processed: " + "; ".join(reasons)
        else:
            reason = "We couldn't find any photo or PDF attached to your email."
        send_format_error(student_email=sender, reason=reason)
        return FAILED_FOLDER

    # Resolve the student. parse_subject accepts either:
    #   - "Name: Alice | Code: HW7K2P"           (preferred — exact)
    #   - "Name: Alice | Class: Form 4A | School: St Marys" (fuzzy fallback)
    # See shared/student_matcher.py for the full grammar.
    fields = parse_subject(parsed.subject, parsed.body_text)
    if fields is None:
        send_format_error(
            student_email=sender,
            reason=(
                "We couldn't read your details from the subject line. "
                "Use either: 'Name: Your Name | Code: ABC123' (the code is "
                "on your homework slip) or 'Name: Your Name | Class: Form 4A | "
                "School: Your School'."
            ),
        )
        return FAILED_FOLDER

    match: MatchResult = match_student(fields, sender_email=sender)
    if match.status in (
        MatchStatus.NOT_FOUND_SCHOOL,
        MatchStatus.NOT_FOUND_CLASS,
        MatchStatus.AMBIGUOUS_SCHOOL,
        MatchStatus.AMBIGUOUS_CLASS,
        MatchStatus.NOT_FOUND_CODE,
    ):
        send_format_error(student_email=sender, reason=match.reason)
        return FAILED_FOLDER

    # MATCHED or AUTO_ENROLLED — both proceed identically from here.
    student = match.student or {}
    class_doc = match.class_doc or {}

    # Pick the answer key. The code path resolves it directly via
    # match.answer_key; the fuzzy path falls back to "most recent
    # answer_key in this class" since there's no other disambiguator.
    if match.answer_key is not None:
        answer_key = match.answer_key
    else:
        answer_keys = query("answer_keys", [("class_id", "==", class_doc["id"])]) or []
        if not answer_keys:
            send_format_error(
                student_email=sender,
                reason=(
                    f"Your class ({class_doc.get('name','')}) at "
                    f"{(match.school or {}).get('name','')} doesn't have an active "
                    "homework to grade. Please ask your teacher for the homework code "
                    "and resend with 'Code: ABC123' in the subject."
                ),
            )
            return FAILED_FOLDER
        answer_key = sorted(
            answer_keys,
            key=lambda a: a.get("created_at", ""),
            reverse=True,
        )[0]

    # Render attachments → per-page JPEG bytes (PDFs explode into pages,
    # images pass through). Grader expects the same shape mark.py uses.
    pages_bytes = attachments_to_pages(parsed.usable_attachments)
    if not pages_bytes:
        send_format_error(
            student_email=sender,
            reason="We couldn't extract any pages from your attachment. Please send a clear photo or PDF.",
        )
        return FAILED_FOLDER

    # First-page quality gate. Cheap reject; saves a Gemma call when the
    # photo is a thumbnail or a hand covering the page.
    try:
        quality = check_image_quality_strict(pages_bytes[0])
    except Exception:
        quality = None
    if quality is not None and not quality.get("pass_check", True):
        send_format_error(
            student_email=sender,
            reason=quality.get("reason") or "The first page of your submission was unreadable.",
        )
        return FAILED_FOLDER

    # Grade.
    try:
        education_level = class_doc.get("education_level", "")
        raw_verdicts = grade_submission_strict_multi(
            pages_bytes, answer_key, education_level,
        )
    except Exception:
        logger.exception(
            "email_poller: grading failed for %s (class %s)",
            sender, class_doc.get("id"),
        )
        send_format_error(
            student_email=sender,
            reason="Grading temporarily failed on our side. Please try sending again in a few minutes.",
        )
        return FAILED_FOLDER

    # Cap per-question awarded marks against the answer key, drop
    # hallucinated extra questions. Lighter version of the same dedup
    # mark.py does — kept inline because pulling that out into a shared
    # helper is a separate refactor.
    questions = answer_key.get("questions", []) or []
    max_per_q: dict[int, float] = {}
    for q in questions:
        try:
            qn = int(q.get("question_number"))
            max_per_q[qn] = float(q.get("marks", 0) or 0)
        except (TypeError, ValueError):
            continue
    total_max = float(answer_key.get("total_marks") or sum(max_per_q.values()) or 1)

    cleaned: list[dict] = []
    for v in raw_verdicts:
        if not isinstance(v, dict):
            continue
        try:
            qn = int(v.get("question_number"))
        except (TypeError, ValueError):
            continue
        if qn not in max_per_q:
            continue
        cap = max_per_q[qn]
        try:
            awarded = max(0.0, min(float(v.get("awarded_marks", 0) or 0), cap))
        except (TypeError, ValueError):
            awarded = 0.0
        v["awarded_marks"] = awarded
        v["max_marks"] = cap
        v["page_index"] = int(v.get("page_index", 0) or 0)
        cleaned.append(v)
    cleaned.sort(key=lambda v: int(v["question_number"]))

    score = min(sum(v["awarded_marks"] for v in cleaned), total_max)
    percentage = round(score / total_max * 100, 1) if total_max else 0.0
    verdicts_pydantic = [GradingVerdict(**v) for v in cleaned]

    # Annotate each page with only its own verdicts (annotate_pages
    # filters by page_index internally).
    annotated_pages = annotate_pages(pages_bytes, cleaned)

    # Upload originals + annotated to GCS under the deterministic mark
    # blob path expected by submissions.py' email reply dispatcher.
    mark_id = str(uuid.uuid4())
    page_urls: list[str] = []
    annotated_urls: list[str] = []
    for i, page_bytes in enumerate(pages_bytes):
        orig_blob = f"submissions/{student['id']}/{mark_id}/page_{i}.jpg"
        upload_bytes(settings.GCS_BUCKET_SUBMISSIONS, orig_blob, page_bytes, public=False)
        page_urls.append(generate_signed_url(
            settings.GCS_BUCKET_SUBMISSIONS, orig_blob,
            expiry_minutes=60 * 24 * 7,
        ))
    for i, ann_bytes in enumerate(annotated_pages):
        ann_blob = f"{mark_id}/annotated_{i}.jpg"
        upload_bytes(settings.GCS_BUCKET_MARKED, ann_blob, ann_bytes, public=False)
        annotated_urls.append(generate_signed_url(
            settings.GCS_BUCKET_MARKED, ann_blob,
            expiry_minutes=60 * 24 * 7,
        ))

    # Persist Mark. approved=False — teacher must approve before the
    # student-facing reply (Resend email) fires from submissions.py.
    mark = Mark(
        id=mark_id,
        student_id=student["id"],
        class_id=class_doc["id"],
        answer_key_id=answer_key["id"],
        teacher_id=answer_key.get("teacher_id", ""),
        score=score,
        max_score=total_max,
        percentage=percentage,
        verdicts=verdicts_pydantic,
        marked_image_url=annotated_urls[0] if annotated_urls else None,
        source="email_submission",
        approved=False,
        page_count=len(pages_bytes),
        page_urls=page_urls,
        annotated_urls=annotated_urls,
    )
    upsert("marks", mark.id, mark.model_dump())

    # Companion student_submissions row so the teacher's review queue
    # shows it the same way app/whatsapp submissions appear.
    sub_id = f"sub_{uuid.uuid4().hex[:12]}"
    now = _now_iso()
    upsert("student_submissions", sub_id, {
        "id": sub_id,
        "student_id": student["id"],
        "class_id": class_doc["id"],
        "answer_key_id": answer_key["id"],
        "mark_id": mark.id,
        "status": "graded",
        "source": "email_submission",
        "submitted_at": now,
        "graded_at": now,
        "score": score,
        "max_score": total_max,
        "percentage": percentage,
    })

    logger.info(
        "email_poller: graded %s for student %s (auto_enrolled=%s) score=%s/%s",
        sender, student.get("id"),
        match.status == MatchStatus.AUTO_ENROLLED,
        score, total_max,
    )
    return PROCESSED_FOLDER


# ─── Top-level run ────────────────────────────────────────────────────────────

def poll_email_once() -> dict:
    """Sync entry point used by tests and the Pub/Sub trigger.

    Returns a small summary dict so callers / scheduled invocations have
    something to log even when there's no mail to process.
    """
    holder = _acquire_lock()
    if holder is None:
        return {"status": "skipped_locked"}

    box = None
    last_uid_seen: Optional[int] = None
    processed = 0
    failed = 0

    try:
        box = _open_mailbox()
        if box is None:
            return {"status": "skipped_no_creds"}
        _ensure_folders(box)

        cursor = _read_cursor()
        # imap_tools' fetch with `mark_seen=False` leaves the message
        # state alone so a re-poll after a crash sees the same UIDs.
        # AND-condition: UID greater than cursor.
        from imap_tools import AND  # local import
        criteria = AND(uid=f"{cursor + 1}:*") if cursor else AND(all=True)

        for msg in box.fetch(criteria, mark_seen=False, bulk=False):
            try:
                uid = int(msg.uid)
            except (TypeError, ValueError):
                # Bad UID: unsafe to advance cursor past it. Skip without
                # moving so a manual fix can intervene.
                logger.warning("email_poller: non-int uid %r — leaving in inbox", msg.uid)
                continue

            try:
                parsed = parse_rfc822(msg.obj.as_bytes())
            except Exception:
                logger.exception("email_poller: parse failed for uid=%s", uid)
                box.move(msg.uid, FAILED_FOLDER)
                failed += 1
                last_uid_seen = uid
                continue

            try:
                dest = _process_message(parsed)
            except Exception:
                logger.exception("email_poller: processing failed for uid=%s", uid)
                dest = FAILED_FOLDER

            try:
                box.move(msg.uid, dest)
            except Exception:
                logger.exception("email_poller: MOVE to %s failed for uid=%s", dest, uid)

            if dest == PROCESSED_FOLDER:
                processed += 1
            else:
                failed += 1
            last_uid_seen = uid

    finally:
        try:
            if box is not None:
                box.logout()
        except Exception:
            logger.warning("email_poller: IMAP logout failed", exc_info=True)
        _release_lock(holder, last_uid_seen)

    return {
        "status": "ok",
        "processed": processed,
        "failed": failed,
        "last_uid": last_uid_seen,
    }


def poll_email_pubsub(event, context):  # noqa: ARG001  (Pub/Sub signature)
    """Pub/Sub trigger entry point. Cloud Scheduler publishes a message
    to the topic every ~60 s; the message body itself is ignored — its
    arrival is the cron tick."""
    summary = poll_email_once()
    logger.info("email_poller pubsub run: %s", summary)
