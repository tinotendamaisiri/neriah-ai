# functions/push.py
# Push notification token registration endpoint + high-level notification helpers.
#
# POST /api/push/register — store Expo push token on the authenticated user's document
#
# Helper functions (importable by other modules):
#   send_teacher_notification(teacher_id, title, body, data) -> bool
#   send_student_notification(student_id, title, body, data) -> bool
#   send_batch_notifications(user_ids, title, body, data, user_type) -> int

from __future__ import annotations

import json
import logging

import azure.functions as func

from shared.auth import require_auth
from shared.cosmos_client import query_items, upsert_item
from shared.push_client import send_push_notification, send_push_batch

logger = logging.getLogger(__name__)


# ── Notification helpers ──────────────────────────────────────────────────────

async def send_teacher_notification(
    teacher_id: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    """Look up a teacher's push token by ID and send a notification.

    Returns True if the notification was dispatched, False if the token is
    missing or the send failed. Never raises — push is best-effort.
    """
    try:
        results = await query_items(
            "teachers",
            "SELECT c.push_token FROM c WHERE c.id = @id",
            [{"name": "@id", "value": teacher_id}],
        )
        push_token: str = (results[0].get("push_token") if results else "") or ""
        if not push_token:
            return False
        return await send_push_notification(push_token, title=title, body=body, data=data)
    except Exception as exc:
        logger.warning("send_teacher_notification: failed for teacher %s: %s", teacher_id, exc)
        return False


async def send_student_notification(
    student_id: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    """Look up a student's push token by ID and send a notification.

    Returns True if the notification was dispatched, False if the token is
    missing or the send failed. Never raises — push is best-effort.
    """
    try:
        results = await query_items(
            "students",
            "SELECT c.push_token FROM c WHERE c.id = @id",
            [{"name": "@id", "value": student_id}],
        )
        push_token: str = (results[0].get("push_token") if results else "") or ""
        if not push_token:
            return False
        return await send_push_notification(push_token, title=title, body=body, data=data)
    except Exception as exc:
        logger.warning("send_student_notification: failed for student %s: %s", student_id, exc)
        return False


async def send_batch_notifications(
    user_ids: list[str],
    title: str,
    body: str,
    data: dict | None = None,
    user_type: str = "student",
) -> int:
    """Look up push tokens for a list of user IDs and send batch notifications.

    Args:
        user_ids:   List of teacher or student IDs to notify.
        title:      Notification title.
        body:       Notification body text.
        data:       Optional JSON data payload for deep linking.
        user_type:  "student" (default) or "teacher".

    Returns number of notifications dispatched. Failures are logged, never raised.
    """
    if not user_ids:
        return 0

    try:
        container = "students" if user_type == "student" else "teachers"
        # Fetch tokens in batches of 50 to avoid overly long queries
        CHUNK = 50
        all_tokens: list[str] = []
        for i in range(0, len(user_ids), CHUNK):
            chunk = user_ids[i : i + CHUNK]
            placeholders = ", ".join([f"@id{j}" for j in range(len(chunk))])
            params = [{"name": f"@id{j}", "value": uid} for j, uid in enumerate(chunk)]
            rows = await query_items(
                container,
                f"SELECT c.push_token FROM c WHERE c.id IN ({placeholders})",
                params,
            )
            all_tokens.extend(r["push_token"] for r in rows if r.get("push_token"))

        if not all_tokens:
            return 0

        notifications = [
            {"push_token": t, "title": title, "body": body, **({"data": data} if data else {})}
            for t in all_tokens
        ]
        await send_push_batch(notifications)
        return len(notifications)

    except Exception as exc:
        logger.warning("send_batch_notifications: failed for %d ids: %s", len(user_ids), exc)
        return 0


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
