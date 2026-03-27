# shared/whatsapp_client.py
# Single outbound interface to the WhatsApp Cloud API.
# Sends messages FROM Neriah TO teachers: text, images, and convenience wrappers.
# All inbound message routing and state machine live in functions/whatsapp_webhook.py.
# Uses httpx.AsyncClient. All public functions are async.

from __future__ import annotations

import logging

import httpx

from .config import settings

logger = logging.getLogger(__name__)

# ── Lazy singleton client ─────────────────────────────────────────────────────
# One AsyncClient is reused across calls — shares the underlying connection pool.
# Initialised on first call so the module is importable without credentials.

_http_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    """Return the module-level AsyncClient, creating it on first call."""
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(timeout=15.0)
    return _http_client


def _messages_url() -> str:
    """Build the Graph API messages endpoint URL from config."""
    return (
        f"https://graph.facebook.com/v19.0"
        f"/{settings.whatsapp_phone_number_id}/messages"
    )


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.whatsapp_access_token}",
        "Content-Type": "application/json",
    }


# ── Public functions ──────────────────────────────────────────────────────────

async def send_text(to: str, message: str) -> dict:
    """Send a plain text message to a WhatsApp number.

    Args:
        to:      Recipient phone number in E.164 format, e.g. "+263771234567".
        message: Message body (max 4096 chars per WhatsApp limit).

    Returns:
        Parsed JSON response from the Graph API.

    Raises:
        httpx.HTTPStatusError: on any non-2xx response from the API.
    """
    logger.info("send_text to=%s message=%.60r", to, message)
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": message},
    }
    return await _post(payload)


async def send_image(to: str, image_url: str, caption: str = "") -> dict:
    """Send an image message with an optional caption.

    image_url must be publicly accessible (Azure Blob SAS URLs work).
    WhatsApp fetches the image server-side; the teacher's device never contacts Blob Storage.

    Args:
        to:        Recipient phone number in E.164 format.
        image_url: Publicly accessible HTTPS image URL.
        caption:   Optional caption text shown below the image.

    Returns:
        Parsed JSON response from the Graph API.

    Raises:
        httpx.HTTPStatusError: on any non-2xx response.
    """
    logger.info("send_image to=%s url=%s", to, image_url)
    payload = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "image",
        "image": {"link": image_url, "caption": caption},
    }
    return await _post(payload)


async def send_marking_result(
    to: str,
    marked_image_url: str,
    score: float,
    max_score: float,
    student_name: str,
) -> dict:
    """Convenience wrapper — sends the annotated marking image with a score caption.

    Caption format: "{student_name}: {score}/{max_score}"

    Args:
        to:               Teacher's phone number in E.164 format.
        marked_image_url: SAS URL of the annotated JPEG in Azure Blob Storage.
        score:            Total marks awarded.
        max_score:        Total marks available.
        student_name:     Student's name shown in the caption.

    Returns:
        Parsed JSON response from the Graph API.
    """
    caption = f"{student_name}: {score:g}/{max_score:g}"
    return await send_image(to, marked_image_url, caption=caption)


async def send_error(to: str, suggestion: str) -> dict:
    """Convenience wrapper — sends a quality gate rejection or error message.

    Prepends a warning emoji so the message is visually distinct in the teacher's chat.

    Args:
        to:         Teacher's phone number in E.164 format.
        suggestion: Human-readable instruction from ImageQualityResult.suggestion
                    or any other error description.

    Returns:
        Parsed JSON response from the Graph API.
    """
    return await send_text(to, f"⚠️ {suggestion}")


# ── Private ───────────────────────────────────────────────────────────────────

async def _post(payload: dict) -> dict:
    """POST a message payload to the Graph API and return the parsed response.

    Raises:
        httpx.HTTPStatusError: on any non-2xx HTTP response.
    """
    client = _get_client()
    response = await client.post(
        _messages_url(),
        json=payload,
        headers=_auth_headers(),
    )
    response.raise_for_status()
    data = response.json()
    logger.debug("whatsapp_client response: %s", data)
    return data
