"""
Events ingestion + admin query endpoints.

POST   /api/events/batch                — mobile clients post batches of events
GET    /api/admin/events/list           — admin: paginated event list
GET    /api/admin/events/errors         — admin: error groups by fingerprint
GET    /api/admin/events/trace          — admin: events for a trace / user / phone
GET    /api/admin/events/funnel         — admin: conversion funnel (teacher / student)
GET    /api/admin/events/ai_usage       — admin: AI call telemetry (vertex + litert)
GET    /api/admin/events/play_stats     — admin: Neriah Play telemetry (lessons / sessions / errors)

Mobile clients post batches of UI / AI / submission events here. Identity is
ALWAYS taken from the JWT — never from the client body — so a compromised
client can't impersonate another user. The server stamps ``source='mobile'``
and forwards each event through ``observability.log_event``.

Admin endpoints use the static ``ADMIN_API_KEY`` (set in Function App env).
This is the same pattern used by ``functions/curriculum.py``'s admin bypass.
"""

from __future__ import annotations

import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.config import settings
from shared.firestore_client import get_db
from shared.observability import (
    instrument_route,
    log_event,
    new_id,
)

logger = logging.getLogger(__name__)
events_bp = Blueprint("events", __name__)


_EVENT_TYPE_PATTERN = re.compile(r"^[a-z][a-z0-9_.]+$")
_MAX_EVENTS_PER_BATCH = 200
_MAX_PAYLOAD_BYTES = 4096


# ─── Funnel definitions ───────────────────────────────────────────────────────

_FUNNELS: dict[str, dict] = {
    "teacher_signup": {
        "label": "Teacher signup → first grading",
        "steps": [
            {"name": "Phone entered",   "match": ["auth.register.start"]},
            {"name": "OTP verified",    "match": ["auth.verify.success"]},
            {"name": "First class",     "match": ["classes.create.success"]},
            {"name": "First answer key","match": ["answer_keys.create.success", "homework.generate_scheme.success"]},
            {"name": "First grade",     "match": ["mark.submit_scan.success"]},
        ],
    },
    "student_signup": {
        "label": "Student signup → first submission",
        "steps": [
            {"name": "Phone entered",    "match": ["auth.student.register.start"]},
            {"name": "OTP verified",     "match": ["auth.verify.success"]},
            {"name": "Joined class",     "match": ["auth.student.join_class.success", "classes.join.success"]},
            {"name": "First submission", "match": ["submissions.student_create.success", "submissions.create.success"]},
        ],
    },
}

# Cap each per-event-type query at 5000 docs to keep RU/cost bounded.
_FUNNEL_PER_TYPE_CAP = 5000
_AI_USAGE_PER_TYPE_CAP = 5000


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _admin_authorized() -> bool:
    """True if the inbound request carries the configured admin Bearer key."""
    expected = settings.ADMIN_API_KEY
    if not expected:
        return False
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return False
    return auth_header[7:].strip() == expected


def _parse_window(window: str) -> timedelta:
    """Parse a short window string like ``24h``, ``15m``, ``2d`` → timedelta.

    Falls back to 24h on bad input.
    """
    try:
        if not window:
            return timedelta(hours=24)
        unit = window[-1].lower()
        amount = int(window[:-1])
        if unit == "h":
            return timedelta(hours=amount)
        if unit == "m":
            return timedelta(minutes=amount)
        if unit == "d":
            return timedelta(days=amount)
    except Exception:
        pass
    return timedelta(hours=24)


def _payload_within_size_budget(payload: object) -> bool:
    """Reject payloads over 4KB to keep events lean."""
    try:
        if payload is None:
            return True
        encoded = json.dumps(payload, default=str)
        return len(encoded.encode("utf-8")) <= _MAX_PAYLOAD_BYTES
    except Exception:
        return False


# ─── POST /api/events/batch ──────────────────────────────────────────────────

@events_bp.post("/events/batch")
@instrument_route("events.batch", "events")
def events_batch():
    """Accept a batch of mobile-side events.

    Auth: teacher OR student JWT. We try teacher first; if that fails we
    fall through to student. Either succeeds → identity is the JWT subject.

    Body:
        {
          "events":      [ {event_type, severity?, payload?, latency_ms?, ai?, surface?, client_ts?}, ... ],
          "session_id":  str,
          "device":      dict,
          "app_version": str,
          "locale":      str,
          "country":     str        (optional)
        }
    """
    user_id, err = require_role(request, "teacher")
    user_role = "teacher"
    if err:
        user_id, err2 = require_role(request, "student")
        user_role = "student"
        if err2:
            return jsonify({"error": err2 or "unauthorized"}), 401

    body = request.get_json(silent=True) or {}
    events_in = body.get("events") or []
    if not isinstance(events_in, list):
        return jsonify({"error": "events must be a list"}), 400

    session_id = body.get("session_id") or None
    device = body.get("device") if isinstance(body.get("device"), dict) else None
    country = body.get("country") or None

    # Hard cap to keep ingestion bounded.
    capped = events_in[:_MAX_EVENTS_PER_BATCH]

    user_block = {"user_id": user_id, "user_role": user_role, "user_phone": None}

    accepted = 0
    dropped = 0
    for raw in capped:
        if not isinstance(raw, dict):
            dropped += 1
            continue

        event_type = (raw.get("event_type") or "").strip()
        if not event_type or not _EVENT_TYPE_PATTERN.match(event_type):
            dropped += 1
            continue

        payload = raw.get("payload")
        if not _payload_within_size_budget(payload):
            dropped += 1
            continue

        severity = (raw.get("severity") or "info").strip().lower()
        if severity not in ("debug", "info", "warn", "error", "critical"):
            severity = "info"

        log_event(
            event_type,
            severity,
            payload if isinstance(payload, dict) else None,
            surface=raw.get("surface"),
            latency_ms=raw.get("latency_ms"),
            ai=raw.get("ai") if isinstance(raw.get("ai"), dict) else None,
            user=user_block,
            source="mobile",
            client_ts=raw.get("client_ts"),
            session_id=session_id,
            device=device,
            country=country,
        )
        accepted += 1

    dropped += max(0, len(events_in) - len(capped))

    return jsonify({"accepted": accepted, "dropped": dropped}), 200


# ─── GET /api/admin/events/list ──────────────────────────────────────────────

@events_bp.get("/admin/events/list")
@instrument_route("events.admin.list", "events")
def events_list():
    """Admin — list events ordered by timestamp DESC.

    Query params:
        since      ISO timestamp (lower bound)
        limit      max 500, default 100
        severity   filter by severity
        surface    filter by surface
        user_id    filter by user_id
    """
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    limit = min(int(request.args.get("limit", 100) or 100), 500)
    since_str = request.args.get("since")
    severity = request.args.get("severity")
    surface = request.args.get("surface")
    user_id = request.args.get("user_id")

    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        ref = get_db().collection("events")
        if since_str:
            try:
                since_dt = datetime.fromisoformat(since_str.replace("Z", "+00:00"))
                ref = ref.where(filter=FieldFilter("timestamp", ">=", since_dt))
            except ValueError:
                pass
        if severity:
            ref = ref.where(filter=FieldFilter("severity", "==", severity))
        if surface:
            ref = ref.where(filter=FieldFilter("surface", "==", surface))
        if user_id:
            ref = ref.where(filter=FieldFilter("user_id", "==", user_id))

        ref = ref.order_by("timestamp", direction="DESCENDING").limit(limit)

        events: list[dict] = []
        last_ts = None
        for snap in ref.stream():
            data = snap.to_dict() or {}
            data.setdefault("id", snap.id)
            ts = data.get("timestamp")
            if hasattr(ts, "isoformat"):
                data["timestamp"] = ts.isoformat()
                last_ts = ts.isoformat() if ts else last_ts
            events.append(data)
    except Exception as exc:
        logger.exception("events_list query failed")
        return jsonify({"error": f"query failed: {type(exc).__name__}"}), 500

    return jsonify({"events": events, "next_cursor": last_ts}), 200


# ─── GET /api/admin/events/errors ────────────────────────────────────────────

@events_bp.get("/admin/events/errors")
@instrument_route("events.admin.errors", "events")
def events_errors():
    """Admin — group recent errors by ``error.fingerprint``.

    Query params:
        window  short window string (default 24h)
        limit   max groups returned (default 50)
    """
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    window = request.args.get("window", "24h")
    limit = min(int(request.args.get("limit", 50) or 50), 200)
    delta = _parse_window(window)
    cutoff = datetime.now(timezone.utc) - delta

    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        ref = get_db().collection("events")
        ref = ref.where(filter=FieldFilter("severity", "in", ["error", "critical"]))
        ref = ref.where(filter=FieldFilter("timestamp", ">=", cutoff))
        ref = ref.order_by("timestamp", direction="DESCENDING").limit(2000)

        groups: dict[str, dict] = {}
        for snap in ref.stream():
            data = snap.to_dict() or {}
            data.setdefault("id", snap.id)
            err = data.get("error") or {}
            fp = err.get("fingerprint") or "unknown_fp"
            ts = data.get("timestamp")
            ts_iso = ts.isoformat() if hasattr(ts, "isoformat") else None
            grp = groups.get(fp)
            if grp is None:
                groups[fp] = {
                    "fingerprint": fp,
                    "count": 1,
                    "first_seen": ts_iso,
                    "last_seen": ts_iso,
                    "sample_event_id": data.get("id"),
                    "sample_message": err.get("message", ""),
                    "sample_type": err.get("type", ""),
                }
            else:
                grp["count"] += 1
                if ts_iso and (grp["first_seen"] is None or ts_iso < grp["first_seen"]):
                    grp["first_seen"] = ts_iso
                if ts_iso and (grp["last_seen"] is None or ts_iso > grp["last_seen"]):
                    grp["last_seen"] = ts_iso
    except Exception as exc:
        logger.exception("events_errors query failed")
        return jsonify({"error": f"query failed: {type(exc).__name__}"}), 500

    sorted_groups = sorted(groups.values(), key=lambda g: g["count"], reverse=True)[:limit]
    return jsonify({"groups": sorted_groups, "window": window}), 200


# ─── GET /api/admin/events/trace ─────────────────────────────────────────────

@events_bp.get("/admin/events/trace")
@instrument_route("events.admin.trace", "events")
def events_trace():
    """Admin — events for a single trace/user/phone, ordered chronologically.

    Exactly one of ``trace_id``, ``user_id``, ``phone`` must be supplied.
    """
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    trace_id = request.args.get("trace_id")
    user_id = request.args.get("user_id")
    phone = request.args.get("phone")

    if not trace_id and not user_id and not phone:
        return jsonify({"error": "trace_id, user_id, or phone is required"}), 400

    # Phone → user_id lookup. Events are written with user_phone=None
    # because the JWT doesn't carry phone and we don't want to hit
    # Firestore on every log_event call. So when an admin searches by
    # phone, translate to user_id first by reading teachers/students,
    # then query events by user_id (which IS populated).
    if phone and not user_id:
        from shared.firestore_client import query_single  # local import
        for collection in ("teachers", "students"):
            try:
                doc = query_single(collection, [("phone", "==", phone)])
                if doc and doc.get("id"):
                    user_id = doc["id"]
                    break
            except Exception:
                logger.exception(
                    "events_trace: lookup of phone in %s failed", collection,
                )
        if not user_id:
            return jsonify({
                "events": [],
                "count": 0,
                "lookup_note": f"No teacher or student found with phone {phone}",
            }), 200

    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        ref = get_db().collection("events")
        if trace_id:
            ref = ref.where(filter=FieldFilter("trace_id", "==", trace_id))
        elif user_id:
            ref = ref.where(filter=FieldFilter("user_id", "==", user_id))
        elif phone:
            # Fallback only — kept for backwards compat with anything that
            # might query by user_phone directly.
            ref = ref.where(filter=FieldFilter("user_phone", "==", phone))

        ref = ref.order_by("timestamp", direction="ASCENDING").limit(500)
        events: list[dict] = []
        for snap in ref.stream():
            data = snap.to_dict() or {}
            data.setdefault("id", snap.id)
            ts = data.get("timestamp")
            if hasattr(ts, "isoformat"):
                data["timestamp"] = ts.isoformat()
            events.append(data)
    except Exception as exc:
        logger.exception("events_trace query failed")
        return jsonify({"error": f"query failed: {type(exc).__name__}"}), 500

    return jsonify({"events": events, "count": len(events)}), 200


# ─── GET /api/admin/events/funnel ────────────────────────────────────────────

def _ts_to_iso(ts) -> Optional[str]:
    """Convert a Firestore timestamp / datetime to ISO string, or None."""
    if ts is None:
        return None
    if hasattr(ts, "isoformat"):
        try:
            return ts.isoformat()
        except Exception:
            return None
    return None


def _ts_to_epoch(ts) -> Optional[float]:
    """Convert a Firestore timestamp / datetime to a unix-epoch float, or None."""
    if ts is None:
        return None
    if hasattr(ts, "timestamp"):
        try:
            return ts.timestamp()
        except Exception:
            return None
    return None


def _compute_funnel(funnel_id: str, funnel: dict, cutoff: datetime) -> dict:
    """Run a single funnel computation and return its result dict.

    For each step we issue one Firestore query per matching event_type,
    capped at ``_FUNNEL_PER_TYPE_CAP`` docs. We then group by user_id and
    keep the earliest timestamp per (user, step). A user counts toward
    step K iff they have a timestamp for steps 1..K (NOT necessarily in
    chronological order — the spec calls for "have a timestamp for each
    step", regardless of ordering, since some events may be logged before
    others due to clock skew or out-of-order uploads).
    """
    from google.cloud.firestore_v1.base_query import FieldFilter

    db = get_db()
    steps = funnel["steps"]
    n_steps = len(steps)

    # earliest_per_user[user_id] = list of earliest epoch per step (None if missing)
    earliest_per_user: dict[str, list[Optional[float]]] = {}

    for step_idx, step in enumerate(steps):
        for event_type in step["match"]:
            try:
                ref = (
                    db.collection("events")
                    .where(filter=FieldFilter("event_type", "==", event_type))
                    .where(filter=FieldFilter("timestamp", ">=", cutoff))
                    .limit(_FUNNEL_PER_TYPE_CAP)
                )
                for snap in ref.stream():
                    data = snap.to_dict() or {}
                    user_id = data.get("user_id")
                    if not user_id:
                        continue
                    epoch = _ts_to_epoch(data.get("timestamp"))
                    if epoch is None:
                        continue
                    bucket = earliest_per_user.get(user_id)
                    if bucket is None:
                        bucket = [None] * n_steps
                        earliest_per_user[user_id] = bucket
                    cur = bucket[step_idx]
                    if cur is None or epoch < cur:
                        bucket[step_idx] = epoch
            except Exception:
                logger.exception(
                    "_compute_funnel: query failed for type=%s step=%s",
                    event_type, step_idx,
                )

    # Compute users_at_step[k] = count of users with timestamps for steps 0..k.
    users_at_step = [0] * n_steps
    for bucket in earliest_per_user.values():
        for k in range(n_steps):
            if all(bucket[i] is not None for i in range(k + 1)):
                users_at_step[k] += 1
            else:
                break

    out_steps = []
    for k, step in enumerate(steps):
        users = users_at_step[k]
        drop_off = None
        if k > 0:
            prev = users_at_step[k - 1]
            if prev > 0:
                drop_off = round((1.0 - users / prev) * 100.0, 2)
            else:
                drop_off = 0.0
        out_steps.append({
            "name": step["name"],
            "users": users,
            "drop_off_pct_from_prev": drop_off,
        })

    return {
        "funnel_id": funnel_id,
        "label": funnel["label"],
        "steps": out_steps,
        "total_users_started": users_at_step[0] if users_at_step else 0,
    }


@events_bp.get("/admin/events/funnel")
@instrument_route("admin.events.funnel", "events")
def events_funnel():
    """Admin — compute conversion funnel(s).

    Query params:
        id     funnel id (``teacher_signup`` / ``student_signup`` / ``ALL``)
        days   lookback window in days (default 30, max 365)
    """
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    funnel_id = (request.args.get("id") or "").strip()
    if not funnel_id:
        return jsonify({"error": "id is required"}), 400

    try:
        days = int(request.args.get("days", 30) or 30)
    except ValueError:
        days = 30
    days = max(1, min(days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    if funnel_id == "ALL":
        funnels_out = []
        for fid, fdef in _FUNNELS.items():
            try:
                result = _compute_funnel(fid, fdef, cutoff)
                result["days"] = days
                funnels_out.append(result)
            except Exception:
                logger.exception("events_funnel: compute failed for %s", fid)
        return jsonify({"funnels": funnels_out, "days": days}), 200

    fdef = _FUNNELS.get(funnel_id)
    if not fdef:
        return jsonify({"error": f"unknown funnel id: {funnel_id}"}), 404

    try:
        result = _compute_funnel(funnel_id, fdef, cutoff)
        result["days"] = days
    except Exception as exc:
        logger.exception("events_funnel query failed")
        return jsonify({"error": f"query failed: {type(exc).__name__}"}), 500

    return jsonify(result), 200


# ─── GET /api/admin/events/ai_usage ──────────────────────────────────────────

_AI_EVENT_TYPES = (
    "vertex.call.success",
    "vertex.call.failed",
    "litert.inference.success",
    "litert.inference.failed",
)

_AI_SURFACES = ("tutor", "ta", "mark", "play")


def _percentile(sorted_values: list[float], p: float) -> Optional[float]:
    """Return the p-th percentile (0..100) of a sorted list, or None."""
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    # Nearest-rank method.
    k = max(0, min(len(sorted_values) - 1,
                   int(round((p / 100.0) * (len(sorted_values) - 1)))))
    return float(sorted_values[k])


@events_bp.get("/admin/events/ai_usage")
@instrument_route("admin.events.ai_usage", "events")
def events_ai_usage():
    """Admin — AI call telemetry across cloud (Vertex) + on-device (LiteRT).

    Query params:
        days   lookback window in days (default 30, max 365)

    Returns daily call counts, latency percentiles per event_type, daily
    token + cost rollups, top users by cost, failure-rate by surface,
    and the distinct list of models seen.
    """
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    try:
        days = int(request.args.get("days", 30) or 30)
    except ValueError:
        days = 30
    days = max(1, min(days, 365))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # ── Daily buckets, keyed by ISO date string ──
    daily_calls: dict[str, dict] = {}
    daily_tokens: dict[str, dict] = {}

    # ── Latency samples per event_type ──
    latency_samples: dict[str, list[float]] = {t: [] for t in _AI_EVENT_TYPES}

    # ── Per-user cost tally ──
    user_cost: dict[str, dict] = {}

    # ── Per-surface success/fail tally (for failure rate) ──
    surface_tally: dict[str, dict[str, int]] = {
        s: {"success": 0, "failed": 0} for s in _AI_SURFACES
    }

    # ── Distinct models seen ──
    model_counts: dict[str, int] = defaultdict(int)

    # Pre-seed daily buckets so the chart shows a continuous timeline even
    # for empty days.
    today = datetime.now(timezone.utc).date()
    for offset in range(days):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        daily_calls[key] = {
            "date": key,
            "vertex_success": 0, "vertex_failed": 0,
            "litert_success": 0, "litert_failed": 0,
        }
        daily_tokens[key] = {
            "date": key,
            "prompt_tokens": 0, "completion_tokens": 0, "cost_usd": 0.0,
        }

    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        db = get_db()

        for event_type in _AI_EVENT_TYPES:
            try:
                ref = (
                    db.collection("events")
                    .where(filter=FieldFilter("event_type", "==", event_type))
                    .where(filter=FieldFilter("timestamp", ">=", cutoff))
                    .limit(_AI_USAGE_PER_TYPE_CAP)
                )
                for snap in ref.stream():
                    data = snap.to_dict() or {}
                    ts = data.get("timestamp")
                    iso = _ts_to_iso(ts)
                    if not iso:
                        continue
                    date_key = iso[:10]  # YYYY-MM-DD
                    bucket = daily_calls.get(date_key)
                    if bucket is None:
                        bucket = {
                            "date": date_key,
                            "vertex_success": 0, "vertex_failed": 0,
                            "litert_success": 0, "litert_failed": 0,
                        }
                        daily_calls[date_key] = bucket

                    # Increment the right counter.
                    if event_type == "vertex.call.success":
                        bucket["vertex_success"] += 1
                    elif event_type == "vertex.call.failed":
                        bucket["vertex_failed"] += 1
                    elif event_type == "litert.inference.success":
                        bucket["litert_success"] += 1
                    elif event_type == "litert.inference.failed":
                        bucket["litert_failed"] += 1

                    # Latency
                    lat = data.get("latency_ms")
                    if isinstance(lat, (int, float)) and lat is not None:
                        latency_samples[event_type].append(float(lat))

                    # Surface failure-rate
                    surface = data.get("surface")
                    if surface in surface_tally:
                        if event_type.endswith(".success"):
                            surface_tally[surface]["success"] += 1
                        elif event_type.endswith(".failed"):
                            surface_tally[surface]["failed"] += 1

                    # Tokens + cost (only on vertex.call.success)
                    if event_type == "vertex.call.success":
                        ai = data.get("ai") or {}
                        if isinstance(ai, dict):
                            pt = ai.get("prompt_tokens")     or 0
                            ct = ai.get("completion_tokens") or 0
                            cost = ai.get("cost_usd")        or 0
                            try:
                                pt = int(pt)
                            except Exception:
                                pt = 0
                            try:
                                ct = int(ct)
                            except Exception:
                                ct = 0
                            try:
                                cost = float(cost)
                            except Exception:
                                cost = 0.0
                            tok_bucket = daily_tokens.get(date_key)
                            if tok_bucket is None:
                                tok_bucket = {
                                    "date": date_key,
                                    "prompt_tokens": 0,
                                    "completion_tokens": 0,
                                    "cost_usd": 0.0,
                                }
                                daily_tokens[date_key] = tok_bucket
                            tok_bucket["prompt_tokens"]     += pt
                            tok_bucket["completion_tokens"] += ct
                            tok_bucket["cost_usd"]          += cost

                            # Per-user cost tally
                            user_id = data.get("user_id")
                            if user_id:
                                u = user_cost.get(user_id)
                                if u is None:
                                    u = {
                                        "user_id": user_id,
                                        "user_role": data.get("user_role"),
                                        "user_phone": data.get("user_phone"),
                                        "calls": 0,
                                        "total_cost_usd": 0.0,
                                    }
                                    user_cost[user_id] = u
                                u["calls"]          += 1
                                u["total_cost_usd"] += cost

                            model = ai.get("model")
                            if model:
                                model_counts[model] += 1
            except Exception:
                logger.exception(
                    "events_ai_usage: query failed for type=%s", event_type,
                )

    except Exception as exc:
        logger.exception("events_ai_usage failed")
        return jsonify({"error": f"query failed: {type(exc).__name__}"}), 500

    # ── Sort + finalise ──
    daily_calls_list = sorted(daily_calls.values(), key=lambda d: d["date"])
    daily_tokens_list = sorted(daily_tokens.values(), key=lambda d: d["date"])
    # Round costs to 4dp
    for d in daily_tokens_list:
        d["cost_usd"] = round(d["cost_usd"], 4)

    latency_pct = []
    for et in _AI_EVENT_TYPES:
        samples = sorted(latency_samples[et])
        latency_pct.append({
            "event_type": et,
            "samples": len(samples),
            "p50": _percentile(samples, 50),
            "p95": _percentile(samples, 95),
            "p99": _percentile(samples, 99),
        })

    top_users = sorted(
        user_cost.values(),
        key=lambda u: u["total_cost_usd"],
        reverse=True,
    )[:10]
    for u in top_users:
        u["total_cost_usd"] = round(u["total_cost_usd"], 4)

    failure_rate = []
    for s in _AI_SURFACES:
        tally = surface_tally[s]
        total = tally["success"] + tally["failed"]
        rate = (tally["failed"] / total) if total > 0 else 0.0
        failure_rate.append({
            "surface": s,
            "success": tally["success"],
            "failed": tally["failed"],
            "total": total,
            "failure_pct": round(rate * 100.0, 2),
        })

    models_used = sorted(
        ({"model": m, "calls": c} for m, c in model_counts.items()),
        key=lambda x: x["calls"],
        reverse=True,
    )

    return jsonify({
        "days": days,
        "daily_calls":      daily_calls_list,
        "latency_pct":      latency_pct,
        "daily_tokens":     daily_tokens_list,
        "top_users_by_cost": top_users,
        "failure_rate":     failure_rate,
        "models_used":      models_used,
    }), 200


# ─── GET /api/admin/events/play_stats ────────────────────────────────────────

# Event types Neriah Play emits via `@instrument_route("play.X", "play")` and
# the mobile analytics service. Listed here so the dashboard query has a
# stable cap on event-type fanout (and Firestore knows to seek the indexed
# (event_type, timestamp) pair rather than a full collection scan).
_PLAY_EVENT_TYPES = (
    # Backend lifecycle (one set of start/success/failed per route)
    "play.lessons.create.success",
    "play.lessons.create.failed",
    "play.lessons.list.success",
    "play.lessons.detail.success",
    "play.lessons.delete.success",
    "play.sessions.create.success",
    "play.sessions.create.failed",
    "play.lessons.stats.success",
    # Generator internals
    "play.generation.batch.success",
    "play.generation.batch.failed",
    "play.generation.tier_escalate",
    "play.generation.fell_short",
    "play.generation.auto_expand.start",
    # Mobile session lifecycle
    "play.session.start",
    "play.session.end",
    "play.lesson.create.start",
    "play.lesson.create.success",
    "play.lesson.create.failed",
    "play.lesson.create.cancelled",
    "play.lesson.create.tier_escalate",
)

# Cap per event type so a runaway week doesn't stream the whole collection.
_PLAY_STATS_PER_TYPE_CAP = 5000

# Game formats we expect to see in `payload.format`.
_PLAY_FORMATS = ("lane_runner", "stacker", "blaster", "snake")


@events_bp.get("/admin/events/play_stats")
@instrument_route("admin.events.play_stats", "events")
def events_play_stats():
    """Admin — Neriah Play telemetry.

    Returns daily lesson generations + session counts, per-format
    distribution, end-reason distribution, generator escalation +
    fell-short totals, and the top players by session count.

    Query params:
        days   lookback window in days (default 7, max 90)
    """
    if not _admin_authorized():
        return jsonify({"error": "unauthorized"}), 401

    try:
        days = int(request.args.get("days", 7) or 7)
    except ValueError:
        days = 7
    days = max(1, min(days, 90))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # ── Daily buckets ──
    daily: dict[str, dict] = {}
    today = datetime.now(timezone.utc).date()
    for offset in range(days):
        day = today - timedelta(days=offset)
        key = day.isoformat()
        daily[key] = {
            "date": key,
            "lessons_created": 0,
            "lessons_failed": 0,
            "sessions_started": 0,
            "sessions_ended": 0,
        }

    # ── Aggregates ──
    totals = {
        "lessons_created": 0,
        "lessons_failed": 0,
        "sessions_started": 0,
        "sessions_ended": 0,
        "generation_fell_short": 0,
        "generation_tier_escalations": 0,
        "generation_auto_expand_starts": 0,
        "generation_batch_failed": 0,
        "generation_batch_success": 0,
    }
    format_counts: dict[str, int] = {f: 0 for f in _PLAY_FORMATS}
    end_reason_counts: dict[str, int] = defaultdict(int)
    user_sessions: dict[str, dict] = {}  # user_id → {phone, sessions, last_played}

    try:
        from google.cloud.firestore_v1.base_query import FieldFilter
        db = get_db()

        for event_type in _PLAY_EVENT_TYPES:
            try:
                ref = (
                    db.collection("events")
                    .where(filter=FieldFilter("event_type", "==", event_type))
                    .where(filter=FieldFilter("timestamp", ">=", cutoff))
                    .limit(_PLAY_STATS_PER_TYPE_CAP)
                )
                for snap in ref.stream():
                    data = snap.to_dict() or {}
                    iso = _ts_to_iso(data.get("timestamp"))
                    if not iso:
                        continue
                    date_key = iso[:10]
                    bucket = daily.get(date_key)
                    payload = data.get("payload") or {}

                    # Lessons
                    if event_type == "play.lessons.create.success" or event_type == "play.lesson.create.success":
                        totals["lessons_created"] += 1
                        if bucket:
                            bucket["lessons_created"] += 1
                    elif event_type == "play.lessons.create.failed" or event_type == "play.lesson.create.failed":
                        totals["lessons_failed"] += 1
                        if bucket:
                            bucket["lessons_failed"] += 1

                    # Sessions
                    elif event_type == "play.session.start":
                        totals["sessions_started"] += 1
                        if bucket:
                            bucket["sessions_started"] += 1
                        fmt = (payload.get("format") or "").lower()
                        if fmt in format_counts:
                            format_counts[fmt] += 1
                        # Top-players accumulation
                        uid = data.get("user_id") or ""
                        if uid:
                            entry = user_sessions.setdefault(uid, {
                                "user_id": uid,
                                "phone": data.get("user_phone") or "",
                                "sessions": 0,
                                "last_played": iso,
                            })
                            entry["sessions"] += 1
                            if iso > (entry["last_played"] or ""):
                                entry["last_played"] = iso
                    elif event_type == "play.session.end":
                        totals["sessions_ended"] += 1
                        if bucket:
                            bucket["sessions_ended"] += 1
                        reason = (payload.get("end_reason") or "unknown").lower()
                        end_reason_counts[reason] += 1

                    # Generator internals
                    elif event_type == "play.generation.fell_short":
                        totals["generation_fell_short"] += 1
                    elif event_type == "play.generation.tier_escalate":
                        totals["generation_tier_escalations"] += 1
                    elif event_type == "play.generation.auto_expand.start":
                        totals["generation_auto_expand_starts"] += 1
                    elif event_type == "play.generation.batch.failed":
                        totals["generation_batch_failed"] += 1
                    elif event_type == "play.generation.batch.success":
                        totals["generation_batch_success"] += 1
            except Exception:
                logger.exception("[admin.play_stats] query failed for %s", event_type)
                continue
    except Exception:
        logger.exception("[admin.play_stats] firestore query failed")
        return jsonify({"error": "query failed"}), 500

    # Sort daily buckets ascending by date for the chart
    daily_list = sorted(daily.values(), key=lambda r: r["date"])

    # Top players by session count
    top_players = sorted(
        user_sessions.values(),
        key=lambda x: x["sessions"],
        reverse=True,
    )[:10]

    # End-reason list, sorted descending
    end_reasons = sorted(
        ({"reason": r, "count": c} for r, c in end_reason_counts.items()),
        key=lambda x: x["count"],
        reverse=True,
    )

    # Per-format list
    format_list = [
        {"format": f, "sessions": format_counts[f]}
        for f in _PLAY_FORMATS
    ]

    return jsonify({
        "days": days,
        "totals": totals,
        "daily": daily_list,
        "format_distribution": format_list,
        "end_reasons": end_reasons,
        "top_players": top_players,
    }), 200
