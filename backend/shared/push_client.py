# shared/push_client.py
# Send push notifications to the Neriah mobile app via Expo Push Service.
# https://docs.expo.dev/push-notifications/sending-notifications/
#
# Tokens are stored on Teacher.push_token and Student.push_token.
# All tokens must start with "ExponentPushToken[" — any other value is silently skipped.

from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_push_notification(
    push_token: str,
    title: str,
    body: str,
    data: dict | None = None,
) -> bool:
    """Send a single push notification via Expo.

    Args:
        push_token: Expo push token, e.g. "ExponentPushToken[xxxxxx]".
        title:      Notification title (shown in the OS header).
        body:       Notification body text.
        data:       Optional JSON payload delivered to the app in the background.

    Returns:
        True if Expo accepted the request (HTTP 200), False otherwise.
        Failures are logged but never raise — push notifications are best-effort.
    """
    if not push_token or not push_token.startswith("ExponentPushToken"):
        return False

    message: dict = {
        "to": push_token,
        "title": title,
        "body": body,
        "sound": "default",
    }
    if data:
        message["data"] = data

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                EXPO_PUSH_URL,
                json=message,
                headers={"Content-Type": "application/json"},
            )
            if response.status_code == 200:
                return True
            logger.warning(
                "push: Expo returned %d for token %s: %s",
                response.status_code, push_token[:30], response.text[:200],
            )
            return False
    except Exception as exc:
        logger.error("push: send_push_notification error for token %s: %s", push_token[:30], exc)
        return False


async def send_push_batch(notifications: list[dict]) -> None:
    """Send multiple push notifications in one Expo batch request (up to 100 per call).

    Each dict in ``notifications`` must have keys:
        push_token (str), title (str), body (str), data (dict, optional)

    Invalid tokens are silently skipped. Failures are logged but do not raise.
    """
    messages = []
    for n in notifications:
        token = n.get("push_token", "")
        if not token.startswith("ExponentPushToken"):
            continue
        msg: dict = {
            "to": token,
            "title": n["title"],
            "body": n["body"],
            "sound": "default",
        }
        if n.get("data"):
            msg["data"] = n["data"]
        messages.append(msg)

    if not messages:
        return

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            # Expo accepts batches of up to 100 messages per request
            for i in range(0, len(messages), 100):
                batch = messages[i : i + 100]
                resp = await client.post(
                    EXPO_PUSH_URL,
                    json=batch,
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code != 200:
                    logger.warning(
                        "push batch %d-%d: Expo returned %d", i, i + len(batch), resp.status_code
                    )
    except Exception as exc:
        logger.error("push: send_push_batch error: %s", exc)
