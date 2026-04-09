"""
Teacher WhatsApp review flow.

After batch grading completes, Neriah messages the teacher on WhatsApp.
The teacher replies "results" to see graded homework, picks one, and reviews
every submission inline — approve, override score, or skip — without opening
the app. All within the free 24-hour customer-service window.

States (stored in Firestore 'sessions' collection):
  TEACHER_REVIEW_SELECTING  — teacher sees numbered homework list, picks one
  TEACHER_REVIEW_ACTIVE     — teacher reviews submissions one by one

Plugged into functions/whatsapp.py via handle_teacher_results(),
handle_teacher_review_selecting(), and handle_teacher_review_active().
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from shared.firestore_client import get_doc, query, upsert
from shared.whatsapp_client import send_image, send_text

logger = logging.getLogger(__name__)

# State name constants — stored in Firestore session.state
TEACHER_REVIEW_SELECTING = "TEACHER_REVIEW_SELECTING"
TEACHER_REVIEW_ACTIVE = "TEACHER_REVIEW_ACTIVE"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _set_state(phone: str, state: str, context: dict) -> None:
    upsert("sessions", phone, {
        "state": state,
        "context": context,
        "updated_at": _now_iso(),
    })


# ── Entry point ────────────────────────────────────────────────────────────────

def handle_teacher_results(phone: str, teacher: dict) -> None:
    """
    Called when a teacher sends "results", "review", or "grades" in IDLE state.
    Lists all homework assignments that have grading_status="complete" and at least
    one unapproved (status="graded") submission.
    """
    teacher_id = teacher["id"]

    # Find completed homework for this teacher
    complete_keys = query(
        "answer_keys",
        [("teacher_id", "==", teacher_id), ("grading_status", "==", "complete")],
        order_by="created_at",
        direction="DESCENDING",
    )

    # For each key, check for unapproved submissions
    reviewable: list[dict] = []
    for key in complete_keys:
        key_id = key.get("id")
        if not key_id:
            continue
        graded = query("student_submissions", [
            ("answer_key_id", "==", key_id),
            ("status", "==", "graded"),
        ])
        if not graded:
            continue
        class_doc = get_doc("classes", key.get("class_id", ""))
        class_name = class_doc.get("name", "") if class_doc else ""
        reviewable.append({
            "answer_key_id": key_id,
            "title": key.get("title") or key.get("subject") or "Untitled",
            "class_name": class_name,
            "unapproved_count": len(graded),
        })

    if not reviewable:
        send_text(
            phone,
            "No graded homework is waiting for review right now.\n"
            "Results will appear here after batch grading completes.",
        )
        return

    # Build numbered list (max 10)
    reviewable = reviewable[:10]
    lines = ["You have graded homework ready for review:\n"]
    for i, item in enumerate(reviewable):
        count = item["unapproved_count"]
        plural = "s" if count != 1 else ""
        lines.append(
            f"{i + 1}. {item['class_name']} — {item['title']} ({count} submission{plural})"
        )
    lines.append("\nReply with the number to start reviewing.")

    _set_state(phone, TEACHER_REVIEW_SELECTING, {"review_options": reviewable})
    send_text(phone, "\n".join(lines))


# ── TEACHER_REVIEW_SELECTING ───────────────────────────────────────────────────

def handle_teacher_review_selecting(phone: str, context: dict, text: str) -> None:
    """Teacher picks which homework to review by number."""
    options: list[dict] = context.get("review_options", [])

    try:
        choice = int(text.strip())
    except ValueError:
        send_text(phone, "Please reply with a number to pick a homework.")
        return

    if not (1 <= choice <= len(options)):
        send_text(phone, f"Please reply with a number between 1 and {len(options)}.")
        return

    selected = options[choice - 1]
    answer_key_id = selected["answer_key_id"]

    # Reload graded submissions in submitted order
    graded_subs = query(
        "student_submissions",
        [("answer_key_id", "==", answer_key_id), ("status", "==", "graded")],
        order_by="submitted_at",
        direction="ASCENDING",
    )

    if not graded_subs:
        send_text(phone, "No graded submissions found — they may have been approved already.")
        _set_state(phone, "IDLE", {})
        return

    sub_ids = [s.get("id") or s.get("submission_id") for s in graded_subs]
    sub_ids = [sid for sid in sub_ids if sid]  # drop any None

    new_context: dict = {
        "review_homework_id": answer_key_id,
        "review_homework_title": selected["title"],
        "review_class_name": selected["class_name"],
        "review_submission_ids": sub_ids,
        "review_current_idx": 0,
        "review_approved_count": 0,
        "review_total": len(sub_ids),
    }
    _set_state(phone, TEACHER_REVIEW_ACTIVE, new_context)

    send_text(
        phone,
        f"*{selected['class_name']} — {selected['title']}*\n"
        f"{len(sub_ids)} submission(s) to review.\n\n"
        "Sending first submission...",
    )
    _send_current_submission(phone, new_context)


# ── TEACHER_REVIEW_ACTIVE ──────────────────────────────────────────────────────

def handle_teacher_review_active(phone: str, context: dict, text: str, teacher: dict) -> None:
    """Teacher is reviewing submissions one by one."""
    text_lower = text.lower().strip()
    teacher_id = teacher["id"]

    # ── Exit ──────────────────────────────────────────────────────────────────
    if text_lower in ("done", "stop", "exit", "quit"):
        _end_review(phone, context)
        return

    # ── Approve all remaining ─────────────────────────────────────────────────
    if text_lower in ("all", "approve all", "approveall"):
        _approve_all_remaining(phone, context, teacher_id)
        return

    # ── Skip / next ───────────────────────────────────────────────────────────
    if text_lower in ("next", "skip", "n", "⏭️"):
        _advance(phone, context, approved=False)
        return

    # ── Approve current ───────────────────────────────────────────────────────
    if text_lower in ("ok", "approve", "yes", "y", "✅"):
        _approve_current(phone, context, teacher_id)
        return

    # ── Override score ────────────────────────────────────────────────────────
    override_score = _parse_override(text_lower)
    if override_score is not None:
        _override_and_approve(phone, context, teacher_id, override_score)
        return

    # ── Unrecognised input — show command hint ─────────────────────────────────
    sub_ids = context.get("review_submission_ids", [])
    idx = context.get("review_current_idx", 0)
    sub_id = sub_ids[idx] if idx < len(sub_ids) else None
    sub = get_doc("student_submissions", sub_id) if sub_id else None
    max_score = sub.get("max_score", 10) if sub else 10

    send_text(
        phone,
        "Reply:\n"
        "✅ *ok* — approve\n"
        f"✏️ *8/{max_score:.0f}* — override score\n"
        "⏭️ *next* — skip to next\n"
        "✅ *all* — approve all remaining\n"
        "🛑 *done* — exit review",
    )


# ── Internal action helpers ────────────────────────────────────────────────────

def _send_current_submission(phone: str, context: dict) -> None:
    """Fetch and send the current submission's annotated image to the teacher."""
    sub_ids: list[str] = context.get("review_submission_ids", [])
    idx: int = context.get("review_current_idx", 0)

    if idx >= len(sub_ids):
        _finish_homework_review(phone, context)
        return

    sub_id = sub_ids[idx]
    sub = get_doc("student_submissions", sub_id)
    if not sub:
        logger.warning("_send_current_submission: submission %s not found, skipping", sub_id)
        context["review_current_idx"] = idx + 1
        _set_state(phone, TEACHER_REVIEW_ACTIVE, context)
        _send_current_submission(phone, context)
        return

    # Resolve student name
    student = get_doc("students", sub.get("student_id", ""))
    if student:
        student_name = (
            f"{student.get('first_name', '')} {student.get('surname', '')}".strip()
        )
    else:
        student_name = sub.get("student_name") or "Unknown"

    score = float(sub.get("score") or 0)
    max_score = float(sub.get("max_score") or 1)
    percentage = float(sub.get("percentage") or 0)
    total = len(sub_ids)
    marked_url = sub.get("marked_image_url") or sub.get("annotated_image_url")

    caption = (
        f"*{student_name}*\n"
        f"Score: {score:.0f}/{max_score:.0f} ({percentage:.0f}%)\n"
        f"({idx + 1} of {total})\n\n"
        f"✅ *ok* — approve\n"
        f"✏️ *{round(score)}/{round(max_score)}* — override score\n"
        f"⏭️ *next* — skip\n"
        f"✅ *all* — approve all remaining\n"
        f"🛑 *done* — exit"
    )

    if marked_url:
        send_image(phone, marked_url, caption)
    else:
        # No annotated image — send text summary
        send_text(
            phone,
            f"*{student_name}*\n"
            f"Score: {score:.0f}/{max_score:.0f} ({percentage:.0f}%)\n"
            f"({idx + 1} of {total})\n\n"
            f"✅ *ok* — approve   ✏️ *{round(score)}/{round(max_score)}* — override\n"
            f"⏭️ *next* — skip   🛑 *done* — exit",
        )


def _approve_current(phone: str, context: dict, teacher_id: str) -> None:
    """Approve the current submission and advance to next."""
    sub_ids: list[str] = context.get("review_submission_ids", [])
    idx: int = context.get("review_current_idx", 0)

    if idx >= len(sub_ids):
        _finish_homework_review(phone, context)
        return

    sub_id = sub_ids[idx]
    now = _now_iso()
    upsert("student_submissions", sub_id, {
        "status": "approved",
        "approved_at": now,
        "approved_by": teacher_id,
    })
    sub = get_doc("student_submissions", sub_id)
    mark_id = sub.get("mark_id") if sub else None
    if mark_id:
        upsert("marks", mark_id, {"approved": True, "approved_at": now})

    context["review_approved_count"] = context.get("review_approved_count", 0) + 1
    _advance(phone, context, approved=True)


def _override_and_approve(
    phone: str, context: dict, teacher_id: str, new_score: float
) -> None:
    """Override the score on the current submission, approve it, and advance."""
    sub_ids: list[str] = context.get("review_submission_ids", [])
    idx: int = context.get("review_current_idx", 0)

    if idx >= len(sub_ids):
        _finish_homework_review(phone, context)
        return

    sub_id = sub_ids[idx]
    sub = get_doc("student_submissions", sub_id)
    if not sub:
        _advance(phone, context, approved=False)
        return

    max_score = float(sub.get("max_score") or 1)
    if new_score > max_score:
        send_text(phone, f"Score cannot exceed {max_score:.0f}. Please try again.")
        return

    percentage = round(new_score / max_score * 100, 1) if max_score else 0.0
    now = _now_iso()

    upsert("student_submissions", sub_id, {
        "status": "approved",
        "score": new_score,
        "percentage": percentage,
        "ai_score": sub.get("score"),  # preserve original AI score
        "teacher_override": True,
        "teacher_override_at": now,
        "approved_at": now,
        "approved_by": teacher_id,
    })
    mark_id = sub.get("mark_id")
    if mark_id:
        upsert("marks", mark_id, {
            "approved": True,
            "approved_at": now,
            "score": new_score,
            "percentage": percentage,
            "manually_edited": True,
        })

    context["review_approved_count"] = context.get("review_approved_count", 0) + 1
    send_text(phone, f"✅ Overridden to {new_score:.0f}/{max_score:.0f} and approved.")
    _advance(phone, context, approved=True)


def _approve_all_remaining(phone: str, context: dict, teacher_id: str) -> None:
    """Approve every remaining graded submission in the queue and end the review."""
    sub_ids: list[str] = context.get("review_submission_ids", [])
    idx: int = context.get("review_current_idx", 0)
    remaining = sub_ids[idx:]

    now = _now_iso()
    newly_approved = 0
    for sub_id in remaining:
        sub = get_doc("student_submissions", sub_id)
        if sub and sub.get("status") == "graded":
            upsert("student_submissions", sub_id, {
                "status": "approved",
                "approved_at": now,
                "approved_by": teacher_id,
            })
            mark_id = sub.get("mark_id")
            if mark_id:
                upsert("marks", mark_id, {"approved": True, "approved_at": now})
            newly_approved += 1

    total_approved = context.get("review_approved_count", 0) + newly_approved
    total = context.get("review_total", len(sub_ids))
    hw_title = context.get("review_homework_title", "Homework")
    class_name = context.get("review_class_name", "")

    _set_state(phone, "IDLE", {})
    send_text(
        phone,
        f"✅ All {newly_approved} remaining submission(s) approved for "
        f"*{class_name} — {hw_title}*.\n"
        f"{total_approved}/{total} approved total.\n\n"
        "Reply *results* to review another homework.",
    )


def _advance(phone: str, context: dict, *, approved: bool) -> None:
    """Increment the index and send the next submission, or finish."""
    context["review_current_idx"] = context.get("review_current_idx", 0) + 1
    sub_ids: list[str] = context.get("review_submission_ids", [])
    idx: int = context["review_current_idx"]

    if idx >= len(sub_ids):
        _finish_homework_review(phone, context)
        return

    _set_state(phone, TEACHER_REVIEW_ACTIVE, context)
    _send_current_submission(phone, context)


def _finish_homework_review(phone: str, context: dict) -> None:
    """Called when the teacher reaches the end of the review queue."""
    approved = context.get("review_approved_count", 0)
    total = context.get("review_total", 0)
    hw_title = context.get("review_homework_title", "Homework")
    class_name = context.get("review_class_name", "")

    _set_state(phone, "IDLE", {})
    send_text(
        phone,
        f"That's all submissions for *{class_name} — {hw_title}*.\n"
        f"{approved}/{total} approved.\n\n"
        "Reply *results* to review another homework.",
    )


def _end_review(phone: str, context: dict) -> None:
    """Teacher typed 'done' to exit early."""
    approved = context.get("review_approved_count", 0)
    total = context.get("review_total", 0)
    _set_state(phone, "IDLE", {})
    send_text(
        phone,
        f"Review ended. {approved}/{total} approved.\n\n"
        "Reply *results* to continue reviewing later.",
    )


# ── Score parsing ──────────────────────────────────────────────────────────────

def _parse_override(text: str) -> float | None:
    """
    Parse an override score from teacher input. Returns float or None.

    Accepted patterns:
      "8"         → 8.0
      "7.5"       → 7.5
      "8/10"      → 8.0
      "7.5/10"    → 7.5
      "override 8"→ 8.0  (prefix stripped before call)
    """
    # Strip "override" prefix
    cleaned = re.sub(r"^\s*override\s+", "", text).strip()

    # Fraction: 8/10, 7.5/10
    m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*/\s*\d+(?:\.\d+)?", cleaned)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None

    # Plain number: 8, 7.5
    m = re.fullmatch(r"\d+(?:\.\d+)?", cleaned)
    if m:
        try:
            return float(m.group(0))
        except ValueError:
            return None

    return None
