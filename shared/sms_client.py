# shared/sms_client.py
# Multi-channel OTP delivery with structured error reporting.
#
# Channel priority:
#   0. Dev bypass — two independent rules, checked in order:
#        (a) Phone whitelist: if phone is in DEV_BYPASS_PHONES, always bypass
#            (works even when ALLOW_BYPASS is false — used for emergency
#            access in production, e.g. the founder's number).
#        (b) Global demo mode: if ALLOW_BYPASS is truthy, bypass EVERY number.
#            Used during pre-launch demo so no Twilio SMS fee per tester.
#      When either rule matches, Twilio/WhatsApp are skipped entirely and
#      the verify endpoint accepts exactly "000000". OTP expiry + rate
#      limits still apply, so an accidental ALLOW_BYPASS=true in prod is
#      not an open-code-accepted-forever hole.
#   1. WhatsApp Cloud API — pre-approved auth template ("neriah_otp").
#      Skipped gracefully when WHATSAPP_ACCESS_TOKEN is not configured.
#   2. Twilio SMS:
#      - US numbers (+1)   → Twilio Verify API (A2P 10DLC compliant)
#      - Non-US numbers    → Twilio Programmable SMS, sender "Neriah"
#
# NOTE: DEV_BYPASS_COUNTRY env var is NO LONGER READ by this module — the
# old combined gate (ALLOW_BYPASS=true AND country match) has been replaced
# by the simpler "ALLOW_BYPASS=true bypasses every number" rule. The env var
# may still be set on the Cloud Function; it is ignored here. Clean it up
# via `gcloud functions deploy ... --remove-env-vars=DEV_BYPASS_COUNTRY`
# when convenient.
#
# Dev fallback:
#   Nothing configured → OTP logged at WARNING. Channel returned is "log".
#
# Error contract:
#   send_otp() raises OTPDeliveryError carrying both a human-readable
#   `message` and a machine-readable `error_code`. Callers forward both
#   into the API response body.

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

_SELF_METHOD: dict = {"method": "self", "verify_sid": None}
_BYPASS_METHOD: dict = {"method": "bypass", "verify_sid": None}
BYPASS_OTP_CODE = "000000"


# ── Structured error ──────────────────────────────────────────────────────────

@dataclass
class OTPDeliveryError(Exception):
    """Raised when all OTP channels fail. Carries user-facing + machine codes."""
    message: str
    error_code: str
    technical_detail: str = ""

    def __str__(self) -> str:  # pragma: no cover
        return f"[{self.error_code}] {self.message} ({self.technical_detail})"


class _ChannelNotConfiguredError(Exception):
    """Internal — channel has no credentials, try the next one."""


# ── Dev bypass ────────────────────────────────────────────────────────────────

def _bypass_enabled() -> bool:
    """Global demo-mode flag — when true, every phone bypasses OTP."""
    return os.environ.get("ALLOW_BYPASS", "false").strip().lower() in ("true", "1", "yes")


def _bypass_phones() -> set[str]:
    """Always-bypass list — runs even when ALLOW_BYPASS is false. For
    production emergency access to specific numbers (e.g. the founder)."""
    raw = os.environ.get("DEV_BYPASS_PHONES", "")
    return {p.strip() for p in raw.split(",") if p.strip()}


def _bypass_match(phone: str) -> str | None:
    """Return a human-readable reason when `phone` should bypass OTP, else None.

    Priority:
      1. Phone is in DEV_BYPASS_PHONES — always bypass, even if ALLOW_BYPASS
         is false. This is the fine-grained allow-list for emergency access.
      2. ALLOW_BYPASS is truthy — bypass every number. This is the global
         demo-mode switch used during pre-launch testing.
    Each match is logged once per call by `send_otp()` so demo traffic can
    be audited via Cloud Logging.
    """
    if phone in _bypass_phones():
        return "whitelisted phone (DEV_BYPASS_PHONES)"
    if _bypass_enabled():
        return "demo mode (ALLOW_BYPASS=true)"
    return None


def is_bypassed(phone: str) -> bool:
    """Return True when OTP delivery + verification should be skipped for this number."""
    return _bypass_match(phone) is not None


# ── WhatsApp ──────────────────────────────────────────────────────────────────

def _send_otp_whatsapp(phone: str, otp_code: str) -> None:
    wa_token = os.environ.get("WHATSAPP_ACCESS_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
    if not wa_token or wa_token.startswith("pending") or not wa_phone_id or wa_phone_id.startswith("pending"):
        raise _ChannelNotConfiguredError("WhatsApp not configured")

    import requests

    wa_number = phone.lstrip("+")
    try:
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
    except requests.Timeout as exc:
        logger.error("WhatsApp send timed out for ...%s: %s", phone[-4:], exc)
        raise OTPDeliveryError(
            message="WhatsApp took too long to respond. Please try SMS instead.",
            error_code="WHATSAPP_TIMEOUT",
            technical_detail=str(exc),
        ) from exc
    except requests.ConnectionError as exc:
        logger.error("WhatsApp connection error for ...%s: %s", phone[-4:], exc)
        raise OTPDeliveryError(
            message="Could not reach WhatsApp. Please check your connection and try again.",
            error_code="WHATSAPP_UNREACHABLE",
            technical_detail=str(exc),
        ) from exc

    if resp.status_code != 200:
        logger.error("WhatsApp API %s for ...%s: %s", resp.status_code, phone[-4:], resp.text)
        raise OTPDeliveryError(
            message=f"WhatsApp rejected the request (HTTP {resp.status_code}). Please try SMS.",
            error_code="WHATSAPP_REJECTED",
            technical_detail=f"HTTP {resp.status_code}: {resp.text[:300]}",
        )


# ── Twilio SMS ────────────────────────────────────────────────────────────────

# Twilio error code → (user message, machine code).
_TWILIO_ERROR_MAP: dict[int, tuple[str, str]] = {
    21408: ("SMS is not supported in your country. Please contact support.", "TWILIO_COUNTRY_BLOCKED"),
    21211: ("The phone number you entered is invalid. Please check and try again.", "TWILIO_INVALID_NUMBER"),
    20003: ("SMS service authentication failed. Please contact support.",           "TWILIO_AUTH_FAILED"),
    21614: ("This number cannot receive SMS. Please use a mobile number.",          "TWILIO_NOT_MOBILE"),
    21610: ("This number has opted out of SMS. Please reply START to +15186083556 or use WhatsApp.", "TWILIO_OPTED_OUT"),
    21612: ("SMS cannot be delivered to this number. Please try WhatsApp instead.", "TWILIO_UNDELIVERABLE"),
}


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
        logger.error(
            "Twilio error for ...%s — code: %s  http_status: %s  msg: %s",
            phone[-4:], exc.code, exc.status, exc.msg,
        )
        mapped = _TWILIO_ERROR_MAP.get(exc.code or 0)
        if mapped:
            user_msg, err_code = mapped
        else:
            user_msg = f"SMS failed: {exc.msg}" if exc.msg else "SMS failed. Please try WhatsApp or try again later."
            err_code = f"TWILIO_{exc.code}" if exc.code else "TWILIO_UNKNOWN"
        raise OTPDeliveryError(
            message=user_msg,
            error_code=err_code,
            technical_detail=f"Twilio code={exc.code} http={exc.status} msg={exc.msg}",
        ) from exc

    except (ConnectionError, TimeoutError) as exc:
        logger.error("Twilio connection error for ...%s: %s", phone[-4:], exc)
        raise OTPDeliveryError(
            message="Could not reach SMS service. Please check your connection and try again.",
            error_code="SMS_UNREACHABLE",
            technical_detail=str(exc),
        ) from exc

    except Exception as exc:
        # Catch-all: twilio SDK raising something outside the above types,
        # or a socket-level error during the HTTP call. Surface the type.
        logger.exception("Unexpected Twilio failure for ...%s", phone[-4:])
        raise OTPDeliveryError(
            message=f"SMS service error: {type(exc).__name__}. Please try again in a moment.",
            error_code="SMS_UNKNOWN",
            technical_detail=f"{type(exc).__name__}: {exc}",
        ) from exc


# ── Public API ────────────────────────────────────────────────────────────────

def send_otp(phone: str, otp_code: str, preferred_channel: str = "sms") -> tuple[str, dict]:
    """Send OTP via WhatsApp (if configured) then SMS fallback.

    Returns (channel_used, method_info).
    channel_used: "whatsapp" | "sms" | "log" | "bypass"
    method_info:  {"method": "self"|"verify"|"bypass", "verify_sid": str|None}

    Raises:
        OTPDeliveryError — when every configured channel failed. The exception
        carries a user-facing `message` and a machine-readable `error_code`.
    """
    bypass_reason = _bypass_match(phone)
    if bypass_reason is not None:
        logger.warning(
            "[BYPASS] OTP bypassed for %s — number ...%s",
            bypass_reason, phone[-4:],
        )
        return "bypass", _BYPASS_METHOD

    channels = ["whatsapp", "sms"] if preferred_channel == "whatsapp" else ["sms", "whatsapp"]
    last_error: OTPDeliveryError | None = None

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
        except OTPDeliveryError as exc:
            last_error = exc
            logger.warning(
                "OTP via %s failed for ...%s — code=%s msg=%s",
                channel, phone[-4:], exc.error_code, exc.message,
            )
            continue

    if last_error is not None:
        raise last_error

    # No channel was configured at all — dev fallback.
    logger.warning(
        "[DEV] No OTP channels configured. OTP for ...%s: %s",
        phone[-4:], otp_code,
    )
    return "log", _SELF_METHOD
