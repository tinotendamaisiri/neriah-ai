"""
shared/guardrails.py — Input/output guardrails, rate limiting, and audit logging
for all Neriah AI endpoints.

Public API:
    validate_input(text, role, max_tokens=2000) -> tuple[bool, str]
    validate_output(text, role, context) -> tuple[bool, str]
    check_rate_limit(user_id, endpoint, role) -> tuple[bool, int]
    log_ai_interaction(user_id, role, endpoint, input_text, output_text,
                       tokens_used, latency_ms, blocked, block_reason=None,
                       ip_address="")
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Firestore thin wrappers (patchable in tests) ───────────────────────────────

def _get_rate_doc(doc_id: str) -> dict | None:
    """Fetch a rate-limit doc from Firestore. Returns None on any failure."""
    try:
        from shared.firestore_client import get_doc  # noqa: PLC0415
        return get_doc("rate_limits", doc_id)
    except Exception:
        return None


def _increment_rate_doc(doc_id: str, user_id: str, endpoint: str, bucket: str) -> None:
    """Upsert the rate-limit counter. Silently swallows Firestore errors."""
    try:
        from shared.firestore_client import get_doc, upsert  # noqa: PLC0415
        doc = get_doc("rate_limits", doc_id)
        if doc:
            upsert("rate_limits", doc_id, {"count": doc.get("count", 0) + 1})
        else:
            upsert("rate_limits", doc_id, {
                "user_id": user_id,
                "endpoint": endpoint,
                "bucket": bucket,
                "count": 1,
            })
    except Exception:
        pass


def _write_audit_doc(doc_id: str, record: dict) -> None:
    try:
        from shared.firestore_client import upsert  # noqa: PLC0415
        upsert("ai_audit_logs", doc_id, record)
    except Exception:
        pass


# ── Injection patterns (checked case-insensitively + l33tspeak-normalised) ────

_INJECTION_PATTERNS: tuple[str, ...] = (
    "ignore previous instructions",
    "ignore all instructions",
    "ignore your instructions",
    "system prompt",
    "reveal your prompt",
    "forget your instructions",
    "you are now",
    "act as",
    "jailbreak",
    " dan ",          # "DAN" jailbreak — space-bounded to reduce false positives
    "pretend you are",
    "override",
    "bypass",
    "disregard previous",
    "new instructions",
    "ignore the above",
)

# ── Student-only blocked topics ────────────────────────────────────────────────

_STUDENT_BLOCKED_TOPICS: tuple[str, ...] = (
    # gambling
    "how to gamble", "casino strategy", "sports betting",
    "how to bet", "poker strategy",
    # adult content
    "pornography", "xxx rated", "adult content", "nude photos",
    # violence instructions
    "how to hurt someone", "how to kill", "how to harm someone",
    "how to assault",
    # drug synthesis
    "how to make drugs", "drug recipe", "drug synthesis",
    "how to make meth", "how to synthesise",
)

# ── PII patterns ───────────────────────────────────────────────────────────────

_PHONE_RE = re.compile(
    r"(?<!\d)"
    r"(\+?(?:263|27|1|44|254|255|256|233|234|260|265|267)\s?\d[\d\s\-]{6,14}\d)"
    r"(?!\d)",
)
_EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
_ZW_ID_RE = re.compile(r"\b\d{2}[\-\s]?\d{6,7}[A-Z]\d{2}\b")  # ZW national ID

# ── Unsafe output patterns ─────────────────────────────────────────────────────

_UNSAFE_OUTPUT: tuple[str, ...] = (
    "child sexual abuse",
    "csam",
    "how to make a bomb",
    "bomb-making instructions",
    "instructions for self-harm",
    "how to commit suicide",
)

# ── Rate limit table ───────────────────────────────────────────────────────────

_LIMITS: dict[str, dict[str, int]] = {
    "teacher":  {"general": 30, "grading": 10, "assistant": 30, "default": 30},
    "student":  {"tutor": 10, "default": 10},
    "admin":    {"default": 60},
    "fallback": {"default": 20},
}

_DAILY_STUDENT_LIMIT = 50


# ─────────────────────────────────────────────────────────────────────────────
# INPUT GUARDRAILS
# ─────────────────────────────────────────────────────────────────────────────

def _estimate_tokens(text: str) -> int:
    """Rough estimate: 1 token ≈ 4 characters."""
    return max(0, len(text) // 4)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text)


def _strip_control(text: str) -> str:
    """Remove null bytes and non-printable control characters, keeping whitespace."""
    text = text.replace("\x00", "")
    return "".join(
        ch for ch in text
        if not unicodedata.category(ch).startswith("C") or ch in ("\n", "\r", "\t")
    )


def _normalize_l33t(text: str) -> str:
    """Map common l33tspeak digits/symbols to letters for pattern matching."""
    return (
        text
        .replace("1", "i").replace("3", "e").replace("0", "o")
        .replace("@", "a").replace("$", "s").replace("4", "a")
        .replace("5", "s").replace("7", "t").replace("|", "i")
    )


def validate_input(
    text: str,
    role: str,
    max_tokens: int = 2000,
) -> tuple[bool, str]:
    """
    Validate and sanitize AI input text before passing to any model.

    Args:
        text:       Raw user input.
        role:       "teacher" | "student" | "admin".
        max_tokens: Estimated token ceiling (default 2000 ≈ 8000 chars).

    Returns:
        (True, cleaned_text)  — safe to pass to the model.
        (False, reason)       — blocked; reason is safe to surface to the user.
    """
    # 1. Sanitize first so length operates on clean text
    cleaned = _strip_html(text or "")
    cleaned = _strip_control(cleaned)
    cleaned = cleaned.strip()

    # 2. Length check
    if _estimate_tokens(cleaned) > max_tokens:
        return False, f"Input exceeds maximum length ({max_tokens} estimated tokens)"

    # 3. Prompt injection detection
    lower = cleaned.lower()
    l33t  = _normalize_l33t(lower)

    for pattern in _INJECTION_PATTERNS:
        if pattern in lower or pattern in l33t:
            logger.warning("guardrails: prompt injection pattern=%r role=%s", pattern, role)
            return False, "Input blocked: possible prompt injection detected"

    # 4. Topic enforcement (students only)
    if role == "student":
        for topic in _STUDENT_BLOCKED_TOPICS:
            if topic in lower:
                logger.info("guardrails: student topic block topic=%r", topic)
                return False, "Input blocked: topic not permitted for student use"

    return True, cleaned


# ─────────────────────────────────────────────────────────────────────────────
# OUTPUT GUARDRAILS
# ─────────────────────────────────────────────────────────────────────────────

def _redact_pii(text: str) -> str:
    text = _PHONE_RE.sub("[REDACTED]", text)
    text = _EMAIL_RE.sub("[REDACTED]", text)
    text = _ZW_ID_RE.sub("[REDACTED]", text)
    return text


def validate_output(
    text: str,
    role: str,
    context: dict,
) -> tuple[bool, str]:
    """
    Validate and sanitize model output before returning to the client.

    Args:
        text:    Raw model response.
        role:    "teacher" | "student" | "grading" | "admin".
        context: Dict that may include:
                   max_marks   — upper bound for grading scores.
                   expect_json — if True, enforce parseable JSON.

    Returns:
        (True, cleaned_text)  — safe to return.
        (False, reason)       — blocked; caller should return an error response.
    """
    if not text:
        return True, text

    # 1. PII redaction (always applied)
    cleaned = _redact_pii(text)

    # 2. Grading hallucination check
    if role == "grading":
        try:
            data      = json.loads(cleaned)
            score     = float(data.get("score", 0))
            max_marks = float(context.get("max_marks", float("inf")))
            if score < 0 or (max_marks != float("inf") and score > max_marks):
                logger.error(
                    "guardrails: grading hallucination score=%.1f max_marks=%.1f",
                    score, max_marks,
                )
                return False, (
                    f"Grading response rejected: score {score} is outside "
                    f"valid range [0, {max_marks}]"
                )
        except (json.JSONDecodeError, ValueError, KeyError):
            pass  # non-JSON grading response — downstream handles format

    # 3. Structured output format enforcement
    if context.get("expect_json"):
        try:
            json.loads(cleaned)
        except json.JSONDecodeError:
            tail = cleaned.rstrip()
            if tail.endswith((",", "[")):
                return False, "Structured output appears truncated"
            return False, "Structured output is not valid JSON"

    # 4. Content safety
    lower = cleaned.lower()
    for pattern in _UNSAFE_OUTPUT:
        if pattern in lower:
            logger.error("guardrails: unsafe output pattern=%r role=%s", pattern, role)
            return False, "Output blocked: content safety violation"

    return True, cleaned


# ─────────────────────────────────────────────────────────────────────────────
# RATE LIMITING
# ─────────────────────────────────────────────────────────────────────────────

def _minute_bucket() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M")


def _day_bucket() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def _limit_for(role: str, endpoint: str) -> int:
    role_limits = _LIMITS.get(role, _LIMITS["fallback"])
    return role_limits.get(endpoint, role_limits.get("default", 20))


def check_rate_limit(
    user_id: str,
    endpoint: str,
    role: str,
) -> tuple[bool, int]:
    """
    Check per-minute (and daily for students) rate limits stored in Firestore.

    Counters are keyed by {user_id}_{endpoint}_{minute_bucket} so they
    automatically expire as new minute windows open.

    Args:
        user_id:  Authenticated user ID (or IP address for anonymous fallback).
        endpoint: Logical endpoint name — "tutor", "grading", "assistant", etc.
        role:     "teacher" | "student" | "admin" | "fallback".

    Returns:
        (True, remaining)         — allowed; remaining = requests left this minute.
        (False, retry_after_secs) — blocked; caller should return HTTP 429.
    """
    limit  = _limit_for(role, endpoint)
    now    = datetime.now(timezone.utc)
    bucket = _minute_bucket()
    doc_id = f"rl_{user_id}_{endpoint}_{bucket}"

    doc   = _get_rate_doc(doc_id)
    count = (doc or {}).get("count", 0)

    if count >= limit:
        retry_after = max(1, 60 - now.second)
        logger.info(
            "guardrails: rate limit hit user=%s endpoint=%s count=%d limit=%d",
            user_id, endpoint, count, limit,
        )
        return False, retry_after

    # Student daily hard cap
    if role == "student":
        day_doc_id = f"rl_{user_id}_daily_{_day_bucket()}"
        day_doc    = _get_rate_doc(day_doc_id)
        day_count  = (day_doc or {}).get("count", 0)
        if day_count >= _DAILY_STUDENT_LIMIT:
            return False, 3600  # encourage retry next day

    # Increment counters
    _increment_rate_doc(doc_id, user_id, endpoint, bucket)
    if role == "student":
        day_doc_id = f"rl_{user_id}_daily_{_day_bucket()}"
        _increment_rate_doc(day_doc_id, user_id, f"{endpoint}_daily", _day_bucket())

    remaining = max(0, limit - count - 1)
    return True, remaining


# ─────────────────────────────────────────────────────────────────────────────
# AUDIT LOGGING
# ─────────────────────────────────────────────────────────────────────────────

_ANOMALY_TOKEN_THRESHOLD   = 3_000
_ANOMALY_LATENCY_THRESHOLD = 30_000  # ms


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()


def log_ai_interaction(
    user_id: str,
    role: str,
    endpoint: str,
    input_text: str,
    output_text: str,
    tokens_used: int,
    latency_ms: int,
    blocked: bool,
    block_reason: str | None = None,
    ip_address: str = "",
) -> None:
    """
    Write an AI interaction audit record to Firestore ai_audit_logs.

    Raw prompts are never stored — only SHA-256 hashes for privacy.
    Anomalies (high token use, high latency, or blocked calls) are
    logged at WARNING level for monitoring.
    """
    is_anomaly = (
        blocked
        or tokens_used > _ANOMALY_TOKEN_THRESHOLD
        or latency_ms > _ANOMALY_LATENCY_THRESHOLD
    )

    record: dict = {
        "user_id":      user_id,
        "role":         role,
        "endpoint":     endpoint,
        "input_hash":   _sha256(input_text),
        "output_hash":  _sha256(output_text),
        "tokens_used":  tokens_used,
        "latency_ms":   latency_ms,
        "blocked":      blocked,
        "block_reason": block_reason,
        "anomaly":      is_anomaly,
        "ip_address":   ip_address,
        "timestamp":    datetime.now(timezone.utc).isoformat(),
    }

    if is_anomaly:
        logger.warning(
            "guardrails/audit anomaly user=%s endpoint=%s blocked=%s "
            "tokens=%d latency=%dms reason=%r",
            user_id, endpoint, blocked, tokens_used, latency_ms, block_reason,
        )

    # Use a time-bucketed ID to avoid collisions; log_id is not exposed externally
    uid_hash = _sha256(user_id + endpoint)[:8]
    log_id   = f"audit_{uid_hash}_{_minute_bucket()}_{abs(hash(input_text)) % 100000:05d}"
    _write_audit_doc(log_id, record)
