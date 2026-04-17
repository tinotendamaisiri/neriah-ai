"""Push notification endpoints and utility.

POST /api/push/register  — store Expo push token for the authenticated user.
send_teacher_notification() — internal utility used by batch_grading.py.
"""

from __future__ import annotations

import logging

import requests as http
from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import get_doc, upsert

logger = logging.getLogger(__name__)
push_bp = Blueprint("push", __name__)

_EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


@push_bp.post("/push/register")
def register_push_token():
    """Store the Expo push token for the authenticated teacher or student."""
    user_id, err = require_role(request, "teacher", "student")
    if err:
        return jsonify({"error": err}), 401
    body = request.get_json(silent=True) or {}
    token = (body.get("token") or "").strip()
    if not token:
        return jsonify({"error": "token is required"}), 400
    upsert("push_tokens", user_id, {"user_id": user_id, "token": token})
    return jsonify({"message": "registered"}), 200


def _send_to_user(user_id: str, title: str, body: str, data: dict | None = None) -> bool:
    """
    Send an Expo push notification to any user (teacher or student) by Firestore ID.
    Looks up the token in the 'push_tokens' collection.
    Returns True if dispatched, False otherwise. Never raises.
    """
    token_doc = get_doc("push_tokens", user_id)
    if not token_doc:
        logger.info("No push token for user %s — skipping notification", user_id)
        return False

    token = token_doc.get("token", "")
    if not token.startswith("ExponentPushToken"):
        logger.warning("Bad push token for user %s: %r", user_id, token[:30])
        return False

    payload: dict = {"to": token, "title": title, "body": body, "sound": "default"}
    if data:
        payload["data"] = data

    try:
        resp = http.post(_EXPO_PUSH_URL, json=payload, timeout=10)
        resp.raise_for_status()
        logger.info("Push sent to %s: %s", user_id, title)
        return True
    except Exception:
        logger.exception("Push failed for %s", user_id)
        return False


# ── Public API ───────────────────────────────────────────────────────────────

def send_teacher_notification(teacher_id: str, title: str, body: str, data: dict | None = None) -> bool:
    """Send push notification to a teacher."""
    return _send_to_user(teacher_id, title, body, data)


def send_student_notification(student_id: str, title: str, body: str, data: dict | None = None) -> bool:
    """Send push notification to a student."""
    return _send_to_user(student_id, title, body, data)


def notify_class_students(class_id: str, title: str, body: str, data: dict | None = None) -> int:
    """Send push notification to ALL students in a class. Returns count sent."""
    from shared.firestore_client import query
    students = query("students", [("class_id", "==", class_id)])
    sent = 0
    for s in students:
        sid = s.get("id", "")
        if sid and _send_to_user(sid, title, body, data):
            sent += 1
    logger.info("Notified %d/%d students in class %s: %s", sent, len(students), class_id, title)
    return sent
