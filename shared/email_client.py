"""
shared/email_client.py — Resend outbound wrapper for the email-submission
channel.

Two send paths:

  send_grade_reply(student_email, mark, attachments)
      Fired from functions/submissions.py once a teacher approves a mark
      whose source is MarkSource.EMAIL_SUBMISSION. Includes the annotated
      page(s) inline as attachments and a short HTML body with the score
      and per-question verdicts.

  send_format_error(student_email, reason)
      Fired immediately from the email poller when a submission can't be
      processed (no usable attachment, unparseable subject line, school
      not found). NOT a grade reply, so this is exempt from the
      "teacher-approves-first" rule — it's a system-status reply.

Both calls degrade silently to a logged warning when RESEND_API_KEY is
empty (e.g. local dev without secrets) so the upstream pipeline never
crashes on a missing creds env var.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Iterable

from shared.config import settings

logger = logging.getLogger(__name__)


def _client():
    """Lazy import + configure the Resend SDK. Raises ImportError only when
    actually called, so the rest of the codebase can import this module
    without the dependency being installed locally."""
    if not settings.RESEND_API_KEY:
        return None
    import resend  # type: ignore

    resend.api_key = settings.RESEND_API_KEY
    return resend


def _format_attachments(attachments: Iterable[tuple[str, bytes, str]]) -> list[dict]:
    """Build Resend's attachment payload. Each input tuple is
    (filename, raw_bytes, content_type). Resend expects base64-encoded
    `content` and a `content_type`, both required for binary attachments
    (especially images — without content_type Gmail renders them as
    'noname' downloads)."""
    out: list[dict] = []
    for filename, payload, content_type in attachments:
        out.append({
            "filename": filename,
            "content": base64.b64encode(payload).decode("ascii"),
            "content_type": content_type,
        })
    return out


def send_grade_reply(
    *,
    student_email: str,
    student_name: str,
    score: int | float,
    max_score: int | float,
    percentage: int | float,
    verdicts: list[dict],
    annotated_pages: Iterable[tuple[str, bytes, str]],
    answer_key_title: str | None = None,
) -> bool:
    """Send the graded-and-approved reply to a student.

    Returns True on success, False when Resend is unconfigured or the API
    call fails (always logged). Caller should not retry on False —
    Resend has its own retry semantics on transient failures.
    """
    if not student_email:
        logger.warning("send_grade_reply: no student_email — skipping")
        return False

    client = _client()
    if client is None:
        logger.warning("send_grade_reply: RESEND_API_KEY unset — skipping send to %s", student_email)
        return False

    pct = int(round(percentage))
    pct_colour = "#22C55E" if pct >= 75 else ("#F59E0B" if pct >= 50 else "#EF4444")
    title_line = f"<strong>{answer_key_title}</strong> · " if answer_key_title else ""

    rows = []
    for v in verdicts:
        verdict = v.get("verdict", "")
        symbol = "✓" if verdict == "correct" else ("✗" if verdict == "incorrect" else "~")
        colour = "#22C55E" if verdict == "correct" else ("#EF4444" if verdict == "incorrect" else "#F59E0B")
        feedback = v.get("feedback") or ""
        rows.append(
            f'<tr><td style="padding:6px 10px">Q{v.get("question_number","")}</td>'
            f'<td style="padding:6px 10px;color:{colour};font-weight:700">{symbol}</td>'
            f'<td style="padding:6px 10px">{v.get("awarded_marks",0)}/{v.get("max_marks",0)}</td>'
            f'<td style="padding:6px 10px;color:#555">{feedback}</td></tr>'
        )
    rows_html = "\n".join(rows) if rows else '<tr><td colspan="4" style="padding:6px 10px;color:#555">No per-question breakdown available.</td></tr>'

    html = f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px 0">Your homework has been graded</h2>
      <p style="margin:0 0 16px 0;color:#555">Hi {student_name}, here is your result.</p>
      <p style="margin:0 0 16px 0">
        {title_line}<span style="font-size:24px;font-weight:800">{score}/{max_score}</span>
        <span style="font-size:18px;font-weight:700;color:{pct_colour};margin-left:8px">{pct}%</span>
      </p>
      <table style="border-collapse:collapse;font-size:13px;border:1px solid #eee;width:100%">
        <thead>
          <tr style="background:#f7f7f7">
            <th style="padding:6px 10px;text-align:left">Q</th>
            <th style="padding:6px 10px;text-align:left">Verdict</th>
            <th style="padding:6px 10px;text-align:left">Marks</th>
            <th style="padding:6px 10px;text-align:left">Feedback</th>
          </tr>
        </thead>
        <tbody>{rows_html}</tbody>
      </table>
      <p style="margin:20px 0 0 0;color:#888;font-size:12px">
        Marked page(s) attached. Reply to this email to flag any issue with the grading.
      </p>
    </div>
    """

    try:
        client.Emails.send({
            "from": settings.RESEND_FROM_ADDRESS,
            "to": student_email,
            "subject": f"Your grade: {score}/{max_score} ({pct}%)",
            "html": html,
            "attachments": _format_attachments(annotated_pages),
        })
        return True
    except Exception:
        logger.exception("send_grade_reply: Resend send failed for %s", student_email)
        return False


def send_resubmission_notice(
    *,
    student_email: str,
    student_name: str,
    homework_title: str,
) -> bool:
    """Notify the student that their new email replaced an earlier
    submission for the same homework. Fires immediately from the email
    poller (not gated on teacher approval) — this is a system-status
    notification about *receipt*, not a grade reveal, so it doesn't
    violate the "teacher approves first" rule.

    The grade reply (with annotated pages) still fires only after the
    teacher approves the new submission.
    """
    if not student_email:
        return False
    client = _client()
    if client is None:
        logger.warning(
            "send_resubmission_notice: RESEND_API_KEY unset — skipping send to %s",
            student_email,
        )
        return False

    title = homework_title or "your homework"
    html = f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px 0">We replaced your previous submission</h2>
      <p style="margin:0 0 12px 0">Hi {student_name},</p>
      <p style="margin:0 0 12px 0">
        We received your new submission for <strong>{title}</strong> and used
        it to replace the one you sent earlier. Only the most recent
        submission per homework counts.
      </p>
      <p style="margin:0 0 12px 0;color:#555">
        Your teacher will review the new submission and you'll get the
        grade by email once it's approved.
      </p>
      <p style="margin:12px 0 0 0;color:#888;font-size:12px">
        If you didn't mean to resend, no action needed — the previous
        submission was already replaced.
      </p>
    </div>
    """
    try:
        client.Emails.send({
            "from": settings.RESEND_FROM_ADDRESS,
            "to": student_email,
            "subject": f"Neriah — submission replaced ({title})",
            "html": html,
        })
        return True
    except Exception:
        logger.exception("send_resubmission_notice: Resend send failed for %s", student_email)
        return False


def send_format_error(
    *,
    student_email: str,
    reason: str,
    original_subject: str | None = None,
    received_summary: str | None = None,
    failure_kind: str | None = None,
) -> bool:
    """Reply to an unprocessable inbound email. Not a grade — exempt from
    the teacher-approval gate.

    The reply includes:
      - The specific `reason` string (e.g. "We couldn't find a homework
        with code 'ZZZZZZ'") as the lead message.
      - A "what we received" summary so the student can see what arrived
        on our side (subject line + attachment count) — useful when the
        student is sure they attached something but the parser disagrees.
      - The required subject formats as a reference.

    `failure_kind` is one of: "no_attachment", "bad_subject", "no_code",
    "no_school", "no_class", "no_homework", "internal", or None. When
    provided, the email's *subject line* surfaces it so the student
    knows at a glance which thing to fix; the body still carries the
    full reason. Useful diagnostically too — Resend dashboard groups
    by subject.
    """
    if not student_email:
        return False
    client = _client()
    if client is None:
        logger.warning("send_format_error: RESEND_API_KEY unset — skipping send to %s", student_email)
        return False

    # Subject of the reply — surfaces the failure kind so the student
    # (and we, in the Resend dashboard) can see what went wrong without
    # opening the message. Falls back to a generic line if no kind given.
    subject_by_kind = {
        "no_attachment":  "Neriah — no photo or PDF attached",
        "bad_subject":    "Neriah — subject line format issue",
        "no_code":        "Neriah — homework code not recognised",
        "no_school":      "Neriah — school not found",
        "no_class":       "Neriah — class not found",
        "no_homework":    "Neriah — class has no active homework",
        "internal":       "Neriah — temporary grading error",
    }
    reply_subject = subject_by_kind.get(failure_kind or "", "Neriah — couldn't grade your submission")

    received_block = ""
    if original_subject is not None or received_summary is not None:
        rows = []
        if original_subject is not None:
            esc = (original_subject or "(empty subject)").replace("<", "&lt;").replace(">", "&gt;")
            rows.append(f'<li>Subject we received: <code>{esc}</code></li>')
        if received_summary:
            rows.append(f"<li>{received_summary}</li>")
        received_block = (
            '<p style="margin:14px 0 4px 0;color:#555;font-weight:600">What we received:</p>'
            f'<ul style="margin:0 0 12px 18px;color:#555">{"".join(rows)}</ul>'
        )

    html = f"""
    <div style="font-family:-apple-system,Segoe UI,sans-serif;color:#111;max-width:560px">
      <h2 style="margin:0 0 4px 0">We couldn't grade your submission</h2>
      <p style="margin:0 0 12px 0">{reason}</p>
      {received_block}
      <p style="margin:14px 0 4px 0;color:#555;font-weight:600">Please send a new email with:</p>
      <ul style="margin:0 0 12px 18px;color:#555">
        <li>Subject: <strong>your name + the homework code your teacher gave you</strong>.
          Order doesn't matter — all of these work:
          <br><code>Alice Mukamuri QJXEPE</code>
          <br><code>QJXEPE Alice Mukamuri</code>
          <br><code>Alice - QJXEPE</code></li>
        <li>If you don't have a code, use the longer form:
          <br><code>Name: Your Name | Class: Form 4A | School: Your School</code></li>
      </ul>
      <p style="margin:0 0 12px 0;color:#555">…and attach a photo or PDF of your homework (paperclip icon is most reliable).</p>
      <p style="margin:12px 0 0 0;color:#888;font-size:12px">If you keep seeing this, ask your teacher for help.</p>
    </div>
    """
    try:
        client.Emails.send({
            "from": settings.RESEND_FROM_ADDRESS,
            "to": student_email,
            "subject": reply_subject,
            "html": html,
        })
        return True
    except Exception:
        logger.exception("send_format_error: Resend send failed for %s", student_email)
        return False
