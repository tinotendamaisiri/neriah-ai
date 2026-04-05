# shared/sms_client.py
# Multi-channel OTP delivery.
#
# Channel priority:
#   1. WhatsApp Cloud API — pre-approved auth template ("neriah_otp").
#      Skipped gracefully when WHATSAPP_ACCESS_TOKEN is not configured.
#   2. Twilio SMS:
#      - US numbers (+1)   → Twilio Verify API (A2P 10DLC compliant)
#      - Non-US numbers    → Twilio Programmable SMS, sender "Neriah"
#
# Dev fallback:
#   Nothing configured → OTP logged at WARNING. Channel returned is "log".

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_SELF_METHOD: dict = {"method": "self", "verify_sid": None}


class _ChannelNotConfiguredError(Exception):
    pass


# ── WhatsApp ──────────────────────────────────────────────────────────────────

def _send_otp_whatsapp(phone: str, otp_code: str) -> None:
    wa_token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    if not wa_token or wa_token.startswith("pending") or not wa_phone_id or wa_phone_id.startswith("pending"):
        raise _ChannelNotConfiguredError("WhatsApp not configured")

    import requests

    wa_number = phone.lstrip("+")
    resp = requests.post(
        f"https://graph.facebook.com/v19.0/{wa_phone_id}/messages",
        headers={"Authorization": f"Bearer {wa_token}", "Content-Type": "application/json"},
        json={
            "messaging_product": "whatsapp",
            "to": wa_number,
            "type": "template",
            "template": {
                "name": "neriah_otp",
                "language": {"code": "en"},
                "components": [
                    {"type": "body", "parameters": [{"type": "text", "text": otp_code}]},
                    {"type": "button", "sub_type": "url", "index": "0",
                     "parameters": [{"type": "text", "text": otp_code}]},
                ],
            },
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise Exception(f"WhatsApp API error {resp.status_code}: {resp.text}")


# ── Twilio SMS ────────────────────────────────────────────────────────────────

def _send_otp_sms(phone: str, otp_code: str) -> dict:
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    if not account_sid or not auth_token:
        raise _ChannelNotConfiguredError("Twilio not configured")

    from twilio.rest import Client
    from twilio.base.exceptions import TwilioRestException

    client = Client(account_sid, auth_token)

    try:
        if phone.startswith("+1"):
            verify_sid = os.environ.get("TWILIO_VERIFY_SID", "")
            if not verify_sid:
                raise _ChannelNotConfiguredError("TWILIO_VERIFY_SID not configured")
            verification = client.verify.v2.services(verify_sid).verifications.create(
                to=phone, channel="sms"
            )
            logger.info("Twilio Verify sent to ...%s — status: %s", phone[-4:], verification.status)
            return {"method": "verify", "verify_sid": verify_sid}
        else:
            from_number = os.environ.get("TWILIO_PHONE_NUMBER", "")
            if not from_number:
                raise _ChannelNotConfiguredError("TWILIO_PHONE_NUMBER not configured")
            message = client.messages.create(
                body=f"Hi, your Neriah verification code is: {otp_code}. Valid for 5 minutes.",
                from_=from_number,
                to=phone,
            )
            logger.info("Twilio SMS sent to ...%s — SID: %s  status: %s", phone[-4:], message.sid, message.status)
            return {"method": "messages", "verify_sid": None}

    except TwilioRestException as exc:
        logger.error("Twilio error for ...%s — code: %s  status: %s  message: %s",
                     phone[-4:], exc.code, exc.status, exc.msg)
        raise


# ── Public API ────────────────────────────────────────────────────────────────

def send_otp(phone: str, otp_code: str, preferred_channel: str = "sms") -> tuple[str, dict]:
    """Send OTP via WhatsApp (if configured) then SMS fallback.

    Returns (channel_used, method_info).
    channel_used: "whatsapp" | "sms" | "log"
    method_info:  {"method": "self"|"verify", "verify_sid": str|None}
    """
    channels = ["whatsapp", "sms"] if preferred_channel == "whatsapp" else ["sms", "whatsapp"]
    any_configured = False

    for channel in channels:
        try:
            if channel == "whatsapp":
                _send_otp_whatsapp(phone, otp_code)
                logger.info("OTP sent via WhatsApp to ...%s", phone[-4:])
                return "whatsapp", _SELF_METHOD
            else:
                sms_info = _send_otp_sms(phone, otp_code)
                method = "verify" if sms_info["method"] == "verify" else "self"
                logger.info("OTP sent via SMS to ...%s (method: %s)", phone[-4:], method)
                return "sms", {"method": method, "verify_sid": sms_info.get("verify_sid")}
        except _ChannelNotConfiguredError:
            continue
        except Exception as exc:
            any_configured = True
            logger.warning("OTP via %s failed for ...%s: %s", channel, phone[-4:], exc)
            continue

    if any_configured:
        logger.error("All configured OTP channels failed for ...%s", phone[-4:])
        raise Exception("Failed to send verification code. Please try again.")

    # Dev fallback
    logger.warning(
        "[DEV] No OTP channels configured. OTP for ...%s: %s",
        phone[-4:], otp_code,
    )
    return "log", _SELF_METHOD
