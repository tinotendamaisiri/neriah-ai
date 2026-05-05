"""
Observability layer — fire-and-forget Firestore event logging.

Every endpoint hit, every Vertex AI call, and every error is recorded as a
single document in the Firestore ``events`` collection. An admin dashboard
queries this collection to show what's happening across the platform in
real time.

Design rules:

* Writes are fire-and-forget on a small ThreadPoolExecutor. The request
  thread is never blocked on Firestore latency.
* Every Firestore write is wrapped in try/except. Observability MUST NOT
  break a real request — if logging fails, we log a warning and move on.
* Schema is a single shape that the mobile client and the backend both
  produce — see ``log_event`` / ``functions/events.py`` for the contract.

Public surface:

    new_id(prefix='evt')                       → str
    current_trace_id()                         → str
    extract_user_from_request()                → dict
    fingerprint_error(exc)                     → str
    log_event(event_type, severity, payload, …)
    @instrument_route(event_prefix, surface)

CRITICAL: keep this module self-contained. It must import cleanly even
when Firestore credentials are missing or the network is down — failures
must surface as logged warnings, never raised exceptions.
"""

from __future__ import annotations

import functools
import hashlib
import logging
import os
import secrets
import time
import traceback
from datetime import datetime, timezone
from typing import Any, Callable, Optional

from concurrent.futures import ThreadPoolExecutor

import flask

from shared.config import settings

logger = logging.getLogger(__name__)


# ─── Module state ─────────────────────────────────────────────────────────────

_EXECUTOR = ThreadPoolExecutor(max_workers=4, thread_name_prefix="obs")

# Sample rates for high-volume / low-value events. Keys are event_types,
# values are floats in [0, 1] — 0.1 keeps 10% of those events. Currently
# only used by the mobile-event ingestion path; the decorator below records
# every server-side event regardless of this map.
SAMPLE_RATES: dict[str, float] = {
    "tap.scroll": 0.1,
    "tap.focus": 0.1,
}

_EVENTS_COLLECTION = "events"

# ULID-ish alphabet — 26 chars per id is plenty for our scale, and avoids
# pulling a ULID dep in. Time-prefixed so Firestore native ordering by
# document ID is roughly chronological.
_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"  # Crockford-style: drop I, L, O, U


# ─── Helpers ──────────────────────────────────────────────────────────────────

def new_id(prefix: str = "evt") -> str:
    """Generate a short ULID-ish identifier, prefixed for readability.

    Format: ``<prefix>_<10 chars time><10 chars random>``. Collision
    probability is negligible at our event volume — a few million events
    a day still has < 1 in a million collision odds within any 1-second
    window.
    """
    now_ms = int(time.time() * 1000)
    # Encode the 48-bit timestamp into 10 base-32 chars
    time_part = ""
    for _ in range(10):
        time_part = _ID_ALPHABET[now_ms & 0x1F] + time_part
        now_ms >>= 5
    rand_part = "".join(secrets.choice(_ID_ALPHABET) for _ in range(10))
    return f"{prefix}_{time_part}{rand_part}"


def current_caller_surface() -> Optional[str]:
    """Read the caller surface stamped by `@instrument_route` on flask.g.

    Returns None when no request context is active (e.g. the play-
    generation worker thread). Callers that need a non-None surface
    (typically AI-call event tagging) should pick a sensible default
    like "vertex" themselves.
    """
    try:
        return getattr(flask.g, "caller_surface", None)
    except RuntimeError:
        return None


def current_trace_id() -> str:
    """Return the trace id for the current request.

    Reads from ``flask.g.trace_id`` first, falls back to the inbound
    ``x-trace-id`` header, finally mints a new id. The id is stamped back
    onto ``flask.g`` so subsequent calls within the same request reuse it.
    """
    try:
        existing = getattr(flask.g, "trace_id", None)
        if existing:
            return existing
    except RuntimeError:
        # No request context — out-of-band call (e.g. Pub/Sub trigger).
        return new_id("trace")

    header_id: Optional[str] = None
    try:
        if flask.has_request_context():
            header_id = (flask.request.headers.get("x-trace-id") or "").strip() or None
    except RuntimeError:
        header_id = None

    trace_id = header_id or new_id("trace")
    try:
        flask.g.trace_id = trace_id
    except RuntimeError:
        pass
    return trace_id


def _decode_jwt_silent(token: str) -> Optional[dict]:
    """Decode a JWT without enforcing token_version. Never raises."""
    try:
        from shared.auth import decode_jwt  # local import — avoids cycles
        return decode_jwt(token)
    except Exception:
        return None


def extract_user_from_request() -> dict:
    """Return ``{user_id, user_role, user_phone}`` from the inbound JWT.

    Non-throwing. Returns the anonymous default when no token is present
    or the token can't be decoded. ``user_phone`` is best-effort: the JWT
    doesn't carry phone, so we look it up cheaply from Firestore only if
    the user document is already cached on flask.g — never blocks.
    """
    default = {"user_id": None, "user_role": "anonymous", "user_phone": None}
    try:
        if not flask.has_request_context():
            return default
        auth_header = flask.request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return default
        token = auth_header[7:]
        payload = _decode_jwt_silent(token)
        if not payload:
            return default
        user_id = payload.get("sub")
        user_role = payload.get("role") or "anonymous"
        # Pick up cached phone if a previous helper attached it; otherwise None.
        user_phone = None
        try:
            cached = getattr(flask.g, "user_doc", None)
            if isinstance(cached, dict):
                user_phone = cached.get("phone")
        except RuntimeError:
            user_phone = None
        return {
            "user_id": user_id,
            "user_role": user_role,
            "user_phone": user_phone,
        }
    except Exception:
        return default


def fingerprint_error(exc: BaseException) -> str:
    """SHA-1 fingerprint of an exception — type + first message line.

    12 chars is enough for grouping in the dashboard without being
    unreadably long, and short enough to stash in indexes without blowing
    document size budgets.
    """
    try:
        first_line = ""
        if exc.args:
            first_line = str(exc.args[0]).splitlines()[0] if exc.args[0] else ""
        material = f"{type(exc).__name__}|{first_line}"
        return hashlib.sha1(material.encode("utf-8", errors="replace")).hexdigest()[:12]
    except Exception:
        return "unknown_fp"


# ─── Firestore writer ─────────────────────────────────────────────────────────

def _build_event_doc(
    event_type: str,
    severity: str,
    payload: Optional[dict],
    *,
    surface: Optional[str],
    error: Optional[BaseException],
    latency_ms: Optional[float],
    ai: Optional[dict],
    http: Optional[dict],
    user: Optional[dict],
    source: str,
    client_ts: Optional[str],
    session_id: Optional[str],
    device: Optional[dict],
    country: Optional[str],
    ip: Optional[str],
) -> dict:
    """Assemble the canonical event document. Pure — no I/O."""
    # Resolve user identity
    if user is None:
        user = extract_user_from_request()

    # Resolve trace id
    try:
        trace_id = current_trace_id()
    except Exception:
        trace_id = new_id("trace")

    # Resolve client IP (only meaningful on inbound HTTP)
    if ip is None and source == "backend":
        try:
            if flask.has_request_context():
                from shared.utils import get_client_ip  # noqa: PLC0415
                ip = get_client_ip(flask.request)
        except Exception:
            ip = None

    error_block: Optional[dict] = None
    if error is not None:
        try:
            error_block = {
                "type": type(error).__name__,
                "message": (str(error).splitlines()[0] if str(error) else type(error).__name__)[:500],
                "fingerprint": fingerprint_error(error),
                "stack": traceback.format_exception(type(error), error, error.__traceback__)[-3000:],
            }
            # Stack is a list; collapse to a tail string so Firestore doc stays small.
            error_block["stack"] = "".join(error_block["stack"])[-3000:]
        except Exception:
            error_block = {"type": "ErrorSerializationFailed", "message": "", "fingerprint": "unknown_fp", "stack": ""}

    # Truncate large payload values defensively. Firestore allows 1MB per doc
    # but we want to keep events lean.
    safe_payload = payload or None
    if isinstance(safe_payload, dict):
        try:
            import json
            blob = json.dumps(safe_payload, default=str)
            if len(blob) > 8192:
                safe_payload = {"_truncated": True, "size": len(blob)}
        except Exception:
            safe_payload = {"_truncated": True}

    return {
        "id": new_id("evt"),
        # timestamp set by writer — SERVER_TIMESTAMP sentinel
        "client_ts": client_ts,
        "source": source,
        "surface": surface,
        "event_type": event_type,
        "severity": severity,
        "user_id": (user or {}).get("user_id"),
        "user_role": (user or {}).get("user_role") or "anonymous",
        "user_phone": (user or {}).get("user_phone"),
        "session_id": session_id,
        "trace_id": trace_id,
        "device": device,
        "country": country,
        "ip": ip,
        "payload": safe_payload,
        "error": error_block,
        "latency_ms": latency_ms,
        "ai": ai,
        "http": http,
        "env": settings.NERIAH_ENV,
    }


def _write_event(doc: dict) -> None:
    """Background worker: write the event to Firestore. Never raises."""
    try:
        from google.cloud import firestore as _fs  # local — heavy dep
        from shared.firestore_client import get_db  # local — avoids import cycles
        # Stamp the server timestamp at write time.
        doc_with_ts = dict(doc)
        doc_with_ts["timestamp"] = _fs.SERVER_TIMESTAMP
        get_db().collection(_EVENTS_COLLECTION).document(doc["id"]).set(doc_with_ts)
    except Exception:  # noqa: BLE001 — we MUST swallow everything here
        logger.warning("[obs] event write failed for type=%s", doc.get("event_type"), exc_info=True)


def log_event(
    event_type: str,
    severity: str = "info",
    payload: Optional[dict] = None,
    *,
    surface: Optional[str] = None,
    error: Optional[BaseException] = None,
    latency_ms: Optional[float] = None,
    ai: Optional[dict] = None,
    http: Optional[dict] = None,
    user: Optional[dict] = None,
    source: str = "backend",
    client_ts: Optional[str] = None,
    session_id: Optional[str] = None,
    device: Optional[dict] = None,
    country: Optional[str] = None,
    ip: Optional[str] = None,
) -> None:
    """Fire-and-forget event log.

    NEVER raises. Building the document and submitting it to the
    background pool happen synchronously, but Firestore I/O happens off
    the request thread.
    """
    try:
        doc = _build_event_doc(
            event_type=event_type,
            severity=severity,
            payload=payload,
            surface=surface,
            error=error,
            latency_ms=latency_ms,
            ai=ai,
            http=http,
            user=user,
            source=source,
            client_ts=client_ts,
            session_id=session_id,
            device=device,
            country=country,
            ip=ip,
        )
    except Exception:
        logger.warning("[obs] failed to build event doc for type=%s", event_type, exc_info=True)
        return

    try:
        _EXECUTOR.submit(_write_event, doc)
    except Exception:
        # Pool may be shut down (cold start, function teardown). Fall back to
        # a synchronous best-effort write, still wrapped in a try/except so
        # the request thread never blows up.
        try:
            _write_event(doc)
        except Exception:
            logger.warning("[obs] direct write fallback failed for type=%s", event_type, exc_info=True)


# ─── Decorator ────────────────────────────────────────────────────────────────

def instrument_route(event_prefix: str, surface: Optional[str] = None) -> Callable:
    """Flask view decorator — emit start/success/failed events around a view.

    ``<prefix>.start``   — fired before the view runs
    ``<prefix>.success`` — fired when the view returns a response with status < 400
    ``<prefix>.failed``  — fired on response with status >= 400 OR uncaught exception

    Captures wall-clock latency in ms. Re-raises any uncaught exception
    after logging so the existing error handlers still see them.
    """
    inferred_surface = surface or event_prefix.split(".")[0]

    def _decorator(view: Callable) -> Callable:

        @functools.wraps(view)
        def _wrapper(*args: Any, **kwargs: Any):
            start = time.perf_counter()
            method = None
            path = None
            try:
                if flask.has_request_context():
                    method = flask.request.method
                    path = flask.request.path
            except Exception:
                pass

            # Stamp the caller surface on flask.g so any AI client called
            # downstream (shared.gemma_client._vertex_chat_completions)
            # can read it and tag its events with the right feature
            # name (tutor / ta / mark / play) instead of the generic
            # "vertex". Drives the per-surface failure-rate panel on
            # the AI usage tab.
            try:
                if flask.has_request_context():
                    flask.g.caller_surface = inferred_surface
            except Exception:
                pass

            log_event(
                f"{event_prefix}.start",
                "info",
                surface=inferred_surface,
                http={"method": method, "path": path},
            )

            try:
                resp = view(*args, **kwargs)
            except Exception as exc:
                latency = (time.perf_counter() - start) * 1000.0
                log_event(
                    f"{event_prefix}.failed",
                    "error",
                    surface=inferred_surface,
                    error=exc,
                    latency_ms=latency,
                    http={"method": method, "path": path},
                )
                raise

            latency = (time.perf_counter() - start) * 1000.0
            status_code = _extract_status_code(resp)
            severity = "info" if (status_code is None or status_code < 400) else (
                "warn" if status_code < 500 else "error"
            )
            event_name = f"{event_prefix}.success" if (status_code is None or status_code < 400) else f"{event_prefix}.failed"
            log_event(
                event_name,
                severity,
                surface=inferred_surface,
                latency_ms=latency,
                http={"method": method, "path": path, "status": status_code},
            )
            return resp

        return _wrapper

    return _decorator


def _extract_status_code(resp: Any) -> Optional[int]:
    """Return the HTTP status code of a Flask view return value, if any."""
    if resp is None:
        return None
    # Flask views can return: Response, (body, status), (body, status, headers), or just body.
    if isinstance(resp, tuple):
        if len(resp) >= 2:
            try:
                return int(resp[1])
            except (TypeError, ValueError):
                return None
        return None
    status = getattr(resp, "status_code", None)
    try:
        return int(status) if status is not None else None
    except (TypeError, ValueError):
        return None
