"""
POST /api/assistant/chat — AI assistant for teachers.

Helps teachers with curriculum questions, lesson planning, assessment strategies,
and general pedagogical guidance. Requires an active teacher JWT.

Rate limits: 30 messages per minute (guardrails), 500 per day.
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.config import settings
from shared.firestore_client import get_doc, upsert
from shared.guardrails import (
    check_rate_limit as guardrails_rate_limit,
    log_ai_interaction,
    validate_input,
    validate_output,
)
from shared.user_context import get_user_context

logger = logging.getLogger(__name__)
teacher_assistant_bp = Blueprint("teacher_assistant", __name__)

_SYSTEM_PROMPT = (
    "You are Neriah, an expert AI assistant for African teachers. "
    "You help with curriculum planning, lesson design, assessment strategies, "
    "marking guidance, and professional development. "
    "You are knowledgeable about ZIMSEC, Cambridge, IB, and national curricula "
    "across the SADC region. "
    "Be concise, practical, and culturally relevant. "
    "Never produce harmful content. "
    "If asked about student personal data, remind the teacher to keep data private."
)


def _chat(system: str, history: list[dict], message: str) -> str:
    """Route to Vertex AI or Ollama for teacher assistant chat. Never raises."""
    try:
        if settings.INFERENCE_BACKEND == "vertex":
            from shared.gemma_client import _vertex_chat  # noqa: PLC0415
            return _vertex_chat(system, history, message, None)
        from shared.gemma_client import _ollama_chat  # noqa: PLC0415
        return _ollama_chat(system, history, message, None, complexity="teacher")
    except Exception:
        logger.exception("teacher_assistant chat failed")
        return "I'm having trouble right now. Please try again in a moment."


@teacher_assistant_bp.post("/assistant/chat")
def assistant_chat():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    # ── Rate limit ────────────────────────────────────────────────────────────
    allowed, retry_after = guardrails_rate_limit(teacher_id, "assistant", "teacher")
    if not allowed:
        return jsonify({"error": f"Too many requests. Retry after {retry_after}s"}), 429

    # ── Request body ──────────────────────────────────────────────────────────
    body = request.get_json(silent=True) or {}
    message = (body.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    # ── Input guardrails ──────────────────────────────────────────────────────
    valid_in, cleaned_msg = validate_input(message, role="teacher")
    if not valid_in:
        log_ai_interaction(
            teacher_id, "teacher", "assistant", message, "",
            tokens_used=0, latency_ms=0, blocked=True, block_reason=cleaned_msg,
        )
        return jsonify({"error": cleaned_msg}), 403
    message = cleaned_msg

    conversation_id = body.get("conversation_id") or f"ta_{uuid.uuid4().hex[:12]}"
    curriculum = (body.get("curriculum") or "").strip() or None
    education_level = (body.get("education_level") or "").strip() or None

    # ── Load conversation history ─────────────────────────────────────────────
    client_history: list[dict] = body.get("history") or []
    if client_history:
        history: list[dict] = client_history
        conv_doc = None
    else:
        conv_doc = get_doc("assistant_conversations", conversation_id)
        history = conv_doc.get("messages", []) if conv_doc else []

    # ── Build personalised system prompt ─────────────────────────────────────
    user_ctx = get_user_context(teacher_id, "teacher")
    system = _SYSTEM_PROMPT
    ctx_notes: list[str] = []
    if curriculum or user_ctx.get("curriculum"):
        ctx_notes.append(f"Curriculum: {curriculum or user_ctx['curriculum']}")
    if education_level or user_ctx.get("education_level"):
        ctx_notes.append(f"Education level: {education_level or user_ctx['education_level']}")
    if user_ctx.get("country"):
        ctx_notes.append(f"Country: {user_ctx['country']}")
    if ctx_notes:
        system += "\n\nTEACHER CONTEXT: " + "; ".join(ctx_notes) + "."

    # ── Call model ────────────────────────────────────────────────────────────
    _t0 = time.time()
    response_text = _chat(system, history, message)
    _latency_ms = int((time.time() - _t0) * 1000)

    # ── Output guardrails ─────────────────────────────────────────────────────
    valid_out, response_text = validate_output(response_text, role="teacher", context={})
    if not valid_out:
        log_ai_interaction(
            teacher_id, "teacher", "assistant", message, "",
            tokens_used=0, latency_ms=_latency_ms, blocked=True, block_reason=response_text,
        )
        return jsonify({"error": "Response failed safety check. Please try again."}), 422

    # ── Persist conversation ──────────────────────────────────────────────────
    now = datetime.now(timezone.utc).isoformat()
    updated_history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": response_text},
    ]
    upsert("assistant_conversations", conversation_id, {
        "id": conversation_id,
        "teacher_id": teacher_id,
        "messages": updated_history,
        "created_at": conv_doc.get("created_at", now) if conv_doc else now,
        "updated_at": now,
    })

    # ── Audit log ─────────────────────────────────────────────────────────────
    _tokens = len(response_text) // 4
    log_ai_interaction(
        teacher_id, "teacher", "assistant", message, response_text,
        tokens_used=_tokens, latency_ms=_latency_ms, blocked=False,
    )

    return jsonify({"response": response_text, "conversation_id": conversation_id}), 200
