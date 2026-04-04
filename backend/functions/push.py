# functions/push.py
# Push notification token registration endpoint.
#
# POST /api/push/register — store Expo push token on the authenticated user's document

from __future__ import annotations

import json
import logging

import azure.functions as func

from shared.auth import require_auth
from shared.cosmos_client import query_items, upsert_item

logger = logging.getLogger(__name__)


def _ok(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps({"error": message}), status_code=status, mimetype="application/json"
    )


# ── POST /api/push/register ───────────────────────────────────────────────────

async def handle_push_register(req: func.HttpRequest) -> func.HttpResponse:
    """Store an Expo push token on the authenticated user's profile.

    POST /api/push/register

    Request headers: Authorization: Bearer <jwt>

    Request body:
        { "push_token": "ExponentPushToken[...]" }

    Response 200:
        { "success": true }

    Works for both teachers and students. The token is stored on the
    teacher or student document in Cosmos so it can be looked up when
    sending push notifications.
    """
    try:
        user = require_auth(req)
    except ValueError as exc:
        return _err(str(exc), status=401)

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    push_token: str = (body.get("push_token") or "").strip()
    if not push_token:
        return _err("push_token is required")

    role: str = user.get("role", "")
    user_id: str = user.get("id", "")

    if role == "teacher":
        container = "teachers"
        # Teachers are partitioned by phone — cross-partition lookup by id
        results = await query_items(
            container,
            "SELECT * FROM c WHERE c.id = @id",
            [{"name": "@id", "value": user_id}],
        )
        if not results:
            return _err("Teacher not found.", status=404)
        doc = results[0]
        doc["push_token"] = push_token
        await upsert_item(container, doc)

    elif role == "student":
        container = "students"
        # Students are partitioned by class_id — cross-partition lookup by id
        results = await query_items(
            container,
            "SELECT * FROM c WHERE c.id = @id",
            [{"name": "@id", "value": user_id}],
        )
        if not results:
            return _err("Student not found.", status=404)
        doc = results[0]
        doc["push_token"] = push_token
        await upsert_item(container, doc)

    else:
        return _err("Unsupported role.", status=403)

    return _ok({"success": True})
