# shared/sms_client.py
# Multi-channel OTP delivery.
#
# Channel priority (default):
#   1. WhatsApp Cloud API — pre-approved auth template ("neriah_otp").
#      Requires Meta business verification. Skipped gracefully if not configured.
#   2. Twilio SMS:
#      - US numbers (+1)   → Twilio Verify API (handles A2P 10DLC compliance, manages OTP)
#      - Non-US numbers    → Twilio Programmable SMS, alphanumeric sender "Neriah"
#
# Dev fallback:
#   If neither channel is configured, OTP is logged at WARNING level.
#   The auth flow continues. Channel returned is "log".
#
# Return value of send_otp:
#   (channel_used: str, method_info: dict)
#   channel_used: "whatsapp" | "sms" | "log"
#   method_info:  {"method": "self" | "verify", "verify_sid": str | None}
#
#   method == "verify"  → Twilio Verify owns the OTP; verify via verification_checks API
#   method == "self"    → OTP hash stored in Cosmos; verify against stored hash

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_SELF_METHOD: dict = {"method": "self", "verify_sid": None}


class _ChannelNotConfiguredError(Exception):
    """Raised internally when a channel's credentials are missing."""


# ── WhatsApp ──────────────────────────────────────────────────────────────────

def _send_otp_whatsapp(phone: str, otp_code: str) -> None:
    """Send OTP via WhatsApp Cloud API authentication template.

    Template "neriah_otp" must be pre-approved in the Meta Business dashboard.

    Raises:
        _ChannelNotConfiguredError: WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID missing.
        Exception: on non-200 API response.
    """
    wa_token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    if not wa_token or not wa_phone_id:
        raise _ChannelNotConfiguredError("WhatsApp not configured")

    import requests  # noqa: PLC0415

    wa_number = phone.lstrip("+")
    resp = requests.post(
        f"https://graph.facebook.com/v19.0/{wa_phone_id}/messages",
        headers={
            "Authorization": f"Bearer {wa_token}",
            "Content-Type": "application/json",
        },
        json={
            "messaging_product": "whatsapp",
            "to": wa_number,
            "type": "template",
            "template": {
                "name": "neriah_otp",
                "language": {"code": "en"},
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "text", "text": otp_code}],
                    },
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [{"type": "text", "text": otp_code}],
                    },
                ],
            },
        },
        timeout=10,
    )
    if resp.status_code != 200:
        raise Exception(f"WhatsApp API error {resp.status_code}: {resp.text}")


# ── Twilio SMS ────────────────────────────────────────────────────────────────

def _send_otp_sms(phone: str, otp_code: str) -> dict:
    """Send OTP via Twilio.

    US numbers (+1):
        Twilio Verify API — Twilio generates and sends its own OTP code.
        otp_code param is ignored. Returns method="verify".

    Non-US numbers:
        Twilio Programmable SMS with alphanumeric sender "Neriah".
        Sends the caller-supplied otp_code. Returns method="self".

    Returns:
        {"method": "verify", "verify_sid": "VAxxxx"}  — US
        {"method": "messages", "verify_sid": None}    — non-US

    Raises:
        _ChannelNotConfiguredError: required env vars missing.
        TwilioRestException: on Twilio API errors.
    """
    account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "")
    auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "")
    if not account_sid or not auth_token:
        raise _ChannelNotConfiguredError("Twilio not configured")

    from twilio.rest import Client  # noqa: PLC0415
    from twilio.base.exceptions import TwilioRestException  # noqa: PLC0415

    client = Client(account_sid, auth_token)

    try:
        if phone.startswith("+1"):
            # ── US: Twilio Verify ─────────────────────────────────────────────
            verify_sid = os.environ.get("TWILIO_VERIFY_SID", "")
            if not verify_sid:
                raise _ChannelNotConfiguredError("TWILIO_VERIFY_SID not configured")

            verification = client.verify.v2.services(verify_sid).verifications.create(
                to=phone,
                channel="sms",
            )
            logger.info(
                "Twilio Verify sent to ...%s — status: %s",
                phone[-4:],
                verification.status,
            )
            return {"method": "verify", "verify_sid": verify_sid}

        else:
            # ── Non-US: Programmable SMS, alphanumeric sender ─────────────────
            message = client.messages.create(
                body=f"Hi, your Neriah verification code is: {otp_code}. Valid for 5 minutes.",
                from_="Neriah",
                to=phone,
            )
            logger.info(
                "Twilio SMS sent to ...%s — SID: %s  status: %s",
                phone[-4:],
                message.sid,
                message.status,
            )
            return {"method": "messages", "verify_sid": None}

    except TwilioRestException as exc:
        logger.error(
            "Twilio error for ...%s — code: %s  status: %s  message: %s",
            phone[-4:],
            exc.code,
            exc.status,
            exc.msg,
        )
        raise


# ── Public API ────────────────────────────────────────────────────────────────

async def send_otp(
    phone: str,
    otp_code: str,
    preferred_channel: str = "whatsapp",
) -> tuple[str, dict]:
    """Send an OTP using the best available channel.

    Args:
        phone:             Recipient E.164, e.g. "+263771234567".
        otp_code:          Raw 6-digit OTP. Used only when method=="self".
                           Ignored for US numbers (Twilio Verify generates its own).
        preferred_channel: "whatsapp" (default) or "sms".

    Returns:
        (channel_used, method_info)
        channel_used: "whatsapp" | "sms" | "log"
        method_info:  {"method": "self"|"verify", "verify_sid": str|None}

    Raises:
        Exception: if a channel was configured but all attempts failed.
    """
    channels = (
        ["whatsapp", "sms"] if preferred_channel == "whatsapp" else ["sms", "whatsapp"]
    )

    any_configured = False

    for channel in channels:
        try:
            if channel == "whatsapp":
                _send_otp_whatsapp(phone, otp_code)
                logger.info("OTP sent via WhatsApp to ...%s", phone[-4:])
                return "whatsapp", _SELF_METHOD

            else:
                sms_info = _send_otp_sms(phone, otp_code)
                # Normalise "messages" → "self" for the OTP doc field
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

    # Dev fallback — nothing configured
    logger.warning(
        "[DEV] No OTP channels configured. OTP for ...%s: %s  "
        "Set TWILIO_* or WHATSAPP_* env vars to enable live delivery.",
        phone[-4:],
        otp_code,
    )
    return "log", _SELF_METHOD
