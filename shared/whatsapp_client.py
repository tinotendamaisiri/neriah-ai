"""WhatsApp Cloud API send helpers."""

from __future__ import annotations

import logging

import requests

from shared.config import settings

logger = logging.getLogger(__name__)

_BASE_URL = "https://graph.facebook.com/v19.0"


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}",
        "Content-Type": "application/json",
    }


def _post(payload: dict) -> bool:
    url = f"{_BASE_URL}/{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    try:
        resp = requests.post(url, json=payload, headers=_headers(), timeout=10)
        resp.raise_for_status()
        return True
    except requests.RequestException:
        logger.exception("WhatsApp send failed. Payload: %s", payload)
        return False


def send_text(to: str, body: str) -> bool:
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": body},
    })


def send_image(to: str, image_url: str, caption: str = "") -> bool:
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "image",
        "image": {"link": image_url, "caption": caption},
    })


def send_buttons(to: str, body: str, buttons: list[dict]) -> bool:
    """
    buttons: [{"id": "btn_id", "title": "Button Label"}, ...]
    Maximum 3 buttons per WhatsApp spec.
    """
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "button",
            "body": {"text": body},
            "action": {
                "buttons": [
                    {"type": "reply", "reply": {"id": b["id"], "title": b["title"]}}
                    for b in buttons[:3]
                ]
            },
        },
    })


def send_list(to: str, body: str, button_label: str, sections: list[dict]) -> bool:
    """Send an interactive list message."""
    return _post({
        "messaging_product": "whatsapp",
        "to": to,
        "type": "interactive",
        "interactive": {
            "type": "list",
            "body": {"text": body},
            "action": {"button": button_label, "sections": sections},
        },
    })


def download_media(media_id: str) -> bytes:
    """Download a media file sent by a user (e.g. a photo)."""
    # Step 1: resolve media URL
    url_resp = requests.get(
        f"{_BASE_URL}/{media_id}",
        headers=_headers(),
        timeout=10,
    )
    url_resp.raise_for_status()
    media_url = url_resp.json()["url"]

    # Step 2: download the bytes
    data_resp = requests.get(media_url, headers=_headers(), timeout=30)
    data_resp.raise_for_status()
    return data_resp.content
