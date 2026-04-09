"""
POST /api/tutor/chat — Socratic-method AI tutor for students.

Students ask questions about their homework; Neriah guides them to the answer
using the Socratic method — never giving direct answers.

Free for all students enrolled at schools with an active Neriah subscription.
Rate limit: 50 messages per student per day.
"""

from __future__ import annotations

import base64
import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import get_doc, increment_field, query_single, upsert
from shared.gemma_client import student_tutor
from shared.user_context import get_user_context

logger = logging.getLogger(__name__)
tutor_bp = Blueprint("tutor", __name__)

_DAILY_LIMIT = 50
_RATE_LIMIT_MSG = (
    "You've been studying hard today! You've used all 50 tutor messages for today. "
    "They reset at midnight. Keep up the great work!"
)


# ─── Rate-limit helpers ───────────────────────────────────────────────────────

def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _usage_doc_id(student_id: str) -> str:
    return f"{student_id}_{_today_utc()}"


def check_rate_limit(student_id: str) -> bool:
    """Returns True if the student is within the daily limit."""
    doc = get_doc("tutor_usage", _usage_doc_id(student_id))
    if not doc:
        return True
    return doc.get("count", 0) < _DAILY_LIMIT


def increment_usage(student_id: str) -> None:
    """Increment today's message count for this student. Creates the doc if missing."""
    doc_id = _usage_doc_id(student_id)
    existing = get_doc("tutor_usage", doc_id)
    if existing:
        increment_field("tutor_usage", doc_id, "count")
    else:
        upsert("tutor_usage", doc_id, {
            "student_id": student_id,
            "date": _today_utc(),
            "count": 1,
        })


# ─── Eligibility check ────────────────────────────────────────────────────────

def _is_eligible(student_id: str) -> bool:
    """
    Returns True if the student is enrolled at a school with an active subscription.
    Traversal: student → class → teacher → school → subscription_active.
    Defaults to True when subscription_active is missing (MVP grace period).
    """
    student = get_doc("students", student_id)
    if not student:
        return False
    class_id = student.get("class_id")
    if not class_id:
        return False
    cls = get_doc("classes", class_id)
    if not cls:
        return False
    teacher_id = cls.get("teacher_id")
    if not teacher_id:
        return False
    teacher = get_doc("teachers", teacher_id)
    if not teacher:
        return False
    school_id = teacher.get("school_id")
    if not school_id:
        # Teacher not linked to a school — deny rather than assume
        return False
    school = get_doc("schools", school_id)
    if not school:
        # School not in Firestore — seed schools count as active for demos
        return True
    # Explicit False → deny. Missing or True → allow.
    return school.get("subscription_active", True) is not False


def _get_education_level(student_id: str) -> str:
    """Resolve the education level from the student's class."""
    student = get_doc("students", student_id)
    if not student:
        return "Form 4"
    cls = get_doc("classes", student.get("class_id", ""))
    if not cls:
        return "Form 4"
    return cls.get("education_level", "Form 4")


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@tutor_bp.post("/tutor/chat")
def tutor_chat():
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    # ── Eligibility ───────────────────────────────────────────────────────────
    if not _is_eligible(student_id):
        return jsonify({
            "error": (
                "AI tutor is available for students at subscribed schools. "
                "Ask your teacher about Neriah."
            )
        }), 403

    # ── Rate limit ────────────────────────────────────────────────────────────
    if not check_rate_limit(student_id):
        return jsonify({"error": _RATE_LIMIT_MSG}), 429

    # ── Request body ──────────────────────────────────────────────────────────
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    conversation_id = body.get("conversation_id") or f"conv_{uuid.uuid4().hex[:12]}"

    image_bytes: bytes | None = None
    raw_image = body.get("image")
    if raw_image:
        try:
            image_bytes = base64.b64decode(raw_image)
        except Exception:
            return jsonify({"error": "image must be valid base64"}), 400

    # ── Load conversation history ─────────────────────────────────────────────
    conv_doc = get_doc("tutor_conversations", conversation_id)
    history: list[dict] = conv_doc.get("messages", []) if conv_doc else []

    # ── Build user context (country, curriculum, subject, education_level) ────
    user_ctx = get_user_context(student_id, "student")
    education_level = user_ctx.get("education_level") or _get_education_level(student_id)

    # ── Attach weakness context for personalised tutor behaviour ─────────────
    student_doc = get_doc("students", student_id)
    if student_doc:
        raw_weaknesses = student_doc.get("weaknesses") or []
        # Pass up to 5 most recent weak topics for the system prompt
        weak_topics = [
            w["topic"] for w in raw_weaknesses[:5]
            if w.get("topic")
        ]
        if weak_topics:
            user_ctx = {**user_ctx, "weakness_topics": weak_topics}

    # ── Call tutor ────────────────────────────────────────────────────────────
    response_text = student_tutor(message, history, education_level, image_bytes,
                                  user_context=user_ctx)

    # ── Persist updated history ───────────────────────────────────────────────
    now = datetime.now(timezone.utc).isoformat()
    updated_history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": response_text},
    ]
    upsert("tutor_conversations", conversation_id, {
        "id": conversation_id,
        "student_id": student_id,
        "messages": updated_history,
        "created_at": conv_doc.get("created_at", now) if conv_doc else now,
        "updated_at": now,
    })

    # ── Increment usage counter ───────────────────────────────────────────────
    increment_usage(student_id)

    return jsonify({"response": response_text, "conversation_id": conversation_id}), 200
