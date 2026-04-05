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


def send_teacher_notification(teacher_id: str, title: str, body: str) -> bool:
    """
    Send an Expo push notification to a teacher by their Firestore user ID.
    Looks up the token in the 'push_tokens' collection.
    Returns True if the notification was dispatched, False otherwise.
    """
    token_doc = get_doc("push_tokens", teacher_id)
    if not token_doc:
        logger.info("No push token registered for teacher %s — skipping notification", teacher_id)
        return False

    token = token_doc.get("token", "")
    if not token.startswith("ExponentPushToken"):
        logger.warning("Unrecognised push token format for teacher %s: %r", teacher_id, token[:30])
        return False

    try:
        resp = http.post(
            _EXPO_PUSH_URL,
            json={"to": token, "title": title, "body": body, "sound": "default"},
            timeout=10,
        )
        resp.raise_for_status()
        logger.info("Push notification sent to teacher %s", teacher_id)
        return True
    except Exception:
        logger.exception("Failed to send push notification to teacher %s", teacher_id)
        return False
