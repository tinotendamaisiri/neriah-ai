"""
GET /api/internal/keep-alive — keeps free-tier services from auto-pausing.

Triggered by Cloud Scheduler daily. Issues real authenticated queries
against each service so the inactivity timer resets:

  - Supabase: SELECT id FROM contact_submissions LIMIT 1 (authenticated
    via SUPABASE_ANON_KEY) — Supabase counts only real DB queries as
    activity, not GETs on /rest/v1/.
  - Upstash Redis: SET keepalive 1 (authenticated via UPSTASH_REDIS_REST_TOKEN).

Auth: requires header `x-keep-alive-secret` matching KEEP_ALIVE_SECRET env
var. Cloud Scheduler is configured to send that header. Without it the
endpoint 401s — keeps it from being abused as an open ping endpoint.

This is a backup to .github/workflows/keep-alive.yml — running both means
either can be down/disabled and we still avoid the 7-day pause.
"""

from __future__ import annotations

import logging
import os

import requests
from flask import Blueprint, jsonify, request

from shared.observability import instrument_route

logger = logging.getLogger(__name__)
keep_alive_bp = Blueprint("keep_alive", __name__)


def _ping_supabase() -> dict:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_ANON_KEY", "")
    if not url or not key:
        return {"target": "supabase", "ok": False, "reason": "secrets_missing"}
    try:
        r = requests.get(
            f"{url}/rest/v1/contact_submissions",
            params={"select": "id", "limit": "1"},
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=15,
        )
        return {"target": "supabase", "ok": r.ok, "status": r.status_code}
    except Exception as exc:
        logger.exception("[keep-alive] supabase ping failed")
        return {"target": "supabase", "ok": False, "reason": str(exc)[:200]}


def _ping_upstash() -> dict:
    url = os.getenv("UPSTASH_REDIS_REST_URL", "").rstrip("/")
    token = os.getenv("UPSTASH_REDIS_REST_TOKEN", "")
    if not url or not token:
        return {"target": "upstash", "ok": False, "reason": "secrets_missing"}
    try:
        r = requests.post(
            f"{url}/set/keepalive/1",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        )
        return {"target": "upstash", "ok": r.ok, "status": r.status_code}
    except Exception as exc:
        logger.exception("[keep-alive] upstash ping failed")
        return {"target": "upstash", "ok": False, "reason": str(exc)[:200]}


@keep_alive_bp.get("/internal/keep-alive")
@instrument_route("internal.keep_alive", "system")
def keep_alive():
    secret = os.getenv("KEEP_ALIVE_SECRET", "")
    incoming = request.headers.get("x-keep-alive-secret", "")
    if not secret or incoming != secret:
        return jsonify({"error": "Unauthorized"}), 401

    results = [_ping_supabase(), _ping_upstash()]
    all_ok = all(r["ok"] for r in results)
    return jsonify({"ok": all_ok, "results": results}), (200 if all_ok else 207)
