"""Auth endpoints — register, login, verify OTP, me, recover, PIN management."""

from __future__ import annotations

import logging
import re
import traceback
from datetime import datetime, timezone

from flask import Blueprint, jsonify, make_response, request

from shared.auth import (
    create_jwt,
    generate_otp,
    hash_otp,
    hash_pin,
    require_role,
    verify_otp_hash,
    verify_pin,
)
from shared.config import is_demo
from shared.constants import TERMS_URL, TERMS_VERSION
from shared.firestore_client import delete_doc, get_doc, increment_field, query, query_single, upsert
from shared.models import Student, Teacher
from shared.sms_client import (
    BYPASS_OTP_CODE,
    OTPDeliveryError,
    is_bypassed,
    send_otp as _dispatch_otp,
)
from shared.utils import get_client_ip

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)


# ─── Structured error helpers ────────────────────────────────────────────────
#
# Every error response carries both a human-readable `error` and a
# machine-readable `error_code`. Mobile clients display `error` verbatim
# and may branch on `error_code` for special handling.

def _err(message: str, error_code: str, status: int, *, headers: dict | None = None, **extra):
    """Build a structured error response.

    Args:
        message:    User-facing text — shown directly in the mobile app.
        error_code: Machine-readable code (SCREAMING_SNAKE_CASE).
        status:     HTTP status code.
        headers:    Optional response headers (e.g. rate-limit).
        **extra:    Additional fields merged into the JSON body (e.g. retry_after, attempts).
    """
    body: dict = {"error": message, "error_code": error_code}
    body.update(extra)
    resp = make_response(jsonify(body), status)
    if headers:
        for k, v in headers.items():
            resp.headers[k] = v
    return resp


@auth_bp.errorhandler(OTPDeliveryError)
def _handle_otp_delivery_error(exc: OTPDeliveryError):
    """OTP delivery failures always surface the real reason (country block,
    invalid number, auth failure, Twilio message, etc.). Never hidden behind
    'Failed to send verification code'."""
    logger.error(
        "OTP delivery failed — code=%s msg=%s detail=%s",
        exc.error_code, exc.message, exc.technical_detail,
    )
    return _err(exc.message, exc.error_code, 503)


@auth_bp.errorhandler(Exception)
def _handle_unexpected(exc: Exception):
    """Last-resort handler. Log full traceback to Cloud Logging, expose the
    exception type to the caller — never swallow it behind a generic 500."""
    # Flask already maps HTTPExceptions (abort(...)) — let those through.
    from werkzeug.exceptions import HTTPException
    if isinstance(exc, HTTPException):
        return exc  # type: ignore[return-value]

    first_line = str(exc).splitlines()[0] if str(exc) else type(exc).__name__
    logger.error(
        "Unhandled exception in auth blueprint: %s: %s\n%s",
        type(exc).__name__, exc, traceback.format_exc(),
    )
    return _err(
        f"An unexpected error occurred: {type(exc).__name__}: {first_line}",
        "UNEXPECTED",
        500,
    )

# ─── Phone validation ────────────────────────────────────────────────────────

_PHONE_RULES: dict[str, tuple[int, int]] = {
    "+263": (9, 9),   "+27": (9, 9),    "+260": (9, 9),   "+265": (9, 9),
    "+255": (9, 9),   "+254": (9, 9),   "+256": (9, 9),   "+233": (9, 9),
    "+234": (10, 10), "+267": (8, 8),   "+258": (9, 9),   "+251": (9, 9),
    "+1": (10, 10),   "+44": (10, 10),  "+91": (10, 10),
}


def _validate_phone(phone: str) -> tuple[bool, str, str]:
    """Validate E.164 phone number. Returns (ok, error_message, error_code)."""
    if not phone:
        return False, "Phone number is required.", "PHONE_REQUIRED"
    if not phone.startswith("+"):
        return False, "Phone number must start with a + and country code (e.g. +263 for Zimbabwe).", "PHONE_MISSING_COUNTRY_CODE"
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 7:
        return False, "That phone number is too short. Please check and try again.", "PHONE_TOO_SHORT"
    if len(digits) > 15:
        return False, "That phone number is too long. Phone numbers have at most 15 digits.", "PHONE_TOO_LONG"
    # Check country-specific rules
    for code, (mn, mx) in _PHONE_RULES.items():
        prefix = code[1:]
        if digits.startswith(prefix):
            subscriber = digits[len(prefix):]
            if len(subscriber) < mn:
                return (
                    False,
                    f"This number looks too short for {code}. We expect {mn} digits after the country code.",
                    "PHONE_TOO_SHORT_FOR_COUNTRY",
                )
            if len(subscriber) > mx:
                return (
                    False,
                    f"This number looks too long for {code}. We expect at most {mx} digits after the country code.",
                    "PHONE_TOO_LONG_FOR_COUNTRY",
                )
            return True, "", ""
    return True, "", ""

_OTP_SEND_LIMIT = 3
_OTP_VERIFY_LIMIT = 3
_IP_LIMIT = 10
_WINDOW = 600  # 10 minutes in seconds


def _rl_headers(limit: int, remaining: int, reset_ts: float) -> dict:
    return {
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": str(max(0, remaining)),
        "X-RateLimit-Reset": str(int(reset_ts)),
    }


def _retry_after(rl_headers: dict) -> int:
    """Seconds until the rate-limit window resets."""
    reset_ts = float(rl_headers.get("X-RateLimit-Reset", 0))
    return max(0, int(reset_ts - datetime.now(timezone.utc).timestamp()))


def _check_ip_rate_limit(ip: str) -> tuple[bool, dict]:
    """Returns (blocked, headers). Limit: 10 OTP requests per IP per 10 minutes."""
    now = datetime.now(timezone.utc).timestamp()
    doc = get_doc("ip_rate_limits", ip) or {}
    window_start = doc.get("window_start", 0)
    count = doc.get("count", 0)

    if now - window_start > _WINDOW:
        window_start = now
        count = 0

    reset_ts = window_start + _WINDOW
    headers = _rl_headers(_IP_LIMIT, _IP_LIMIT - count - 1, reset_ts)

    if count >= _IP_LIMIT:
        return True, headers

    upsert("ip_rate_limits", ip, {"ip": ip, "count": count + 1, "window_start": window_start})
    return False, headers


def _build_terms_record(body: dict) -> tuple[dict | None, tuple[str, str] | None]:
    """Validate + build the 6-field terms record from a register body.

    Returns:
        (record, None) when accepted — record is the dict to merge into the
            user doc (after OTP verify) AND into pending_data (so the IP is
            captured at register time, when the user was on their network).
        (None, (message, code)) when terms_accepted is missing or false.
    """
    if not body.get("terms_accepted"):
        return None, ("Terms of Service must be accepted to register.", "TERMS_NOT_ACCEPTED")

    client_terms_version = str(body.get("terms_version") or "unknown")
    record = {
        "terms_accepted": True,
        "terms_accepted_at": datetime.now(timezone.utc).isoformat(),
        "terms_version": client_terms_version,
        "terms_version_server": TERMS_VERSION,
        "terms_url": TERMS_URL,
        "terms_ip": get_client_ip(request),
    }
    return record, None


def _send_otp(phone: str, otp: str) -> str:
    """Send OTP, persist method info, return channel used."""
    if is_demo():
        # Demo mode: skip all SMS/WhatsApp delivery. OTP is always "1234".
        logger.info("[demo] Skipping OTP delivery for %s — accept '1234'", phone)
        upsert("otp_verifications", phone, {"method": "demo", "verify_sid": None})
        return "demo"
    channel, method_info = _dispatch_otp(phone, otp)
    # Update OTP doc with delivery method so verify knows how to check
    upsert("otp_verifications", phone, {
        "method": method_info.get("method", "self"),
        "verify_sid": method_info.get("verify_sid"),
    })
    return channel


def _store_otp(phone: str, pending_data: dict | None = None) -> tuple[str | None, dict]:
    """
    Check phone-level send rate limit then store OTP.
    pending_data: registration fields to persist until verify completes (register flow only).
    Returns (otp, rl_headers). otp is None if rate limited (caller must return 429).
    """
    now = datetime.now(timezone.utc).timestamp()
    existing = get_doc("otp_verifications", phone) or {}

    window_start = existing.get("send_window_start", 0)
    send_count = existing.get("send_count", 0)

    if now - window_start > _WINDOW:
        window_start = now
        send_count = 0

    reset_ts = window_start + _WINDOW
    headers = _rl_headers(_OTP_SEND_LIMIT, _OTP_SEND_LIMIT - send_count - 1, reset_ts)

    if send_count >= _OTP_SEND_LIMIT:
        return None, headers

    otp = generate_otp()
    doc = {
        "id": phone,
        "phone": phone,
        "otp_hash": hash_otp(otp),
        "method": "self",
        "verify_sid": None,
        "attempts": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "send_count": send_count + 1,
        "send_window_start": window_start,
    }
    if pending_data:
        doc["pending_data"] = pending_data
    upsert("otp_verifications", phone, doc)
    return otp, headers


# ─── Register ─────────────────────────────────────────────────────────────────

@auth_bp.post("/auth/register")
def auth_register():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    # Accept either combined "name" or split "first_name"+"surname" from the app
    if body.get("first_name") or body.get("surname"):
        name = f"{body.get('first_name', '').strip()} {body.get('surname', '').strip()}".strip()
    else:
        name = (body.get("name") or "").strip()
    school_id = (body.get("school_id") or "").strip() or None
    school_name = (body.get("school_name") or "").strip() or None
    # Resolve school_id to human-readable name using the seed list
    if school_id and not school_name:
        from functions.schools import _SEED_SCHOOLS
        match = next((s for s in _SEED_SCHOOLS if s["id"] == school_id), None)
        school_name = match["name"] if match else school_id
    title = (body.get("title") or "").strip() or None

    if not phone:
        return _err("Please enter your phone number.", "PHONE_REQUIRED", 400)
    if not name:
        return _err("Please enter your name.", "NAME_REQUIRED", 400)
    phone_valid, phone_err, phone_code = _validate_phone(phone)
    if not phone_valid:
        return _err(phone_err, phone_code, 400)

    terms_record, terms_err = _build_terms_record(body)
    if terms_err is not None:
        msg, code = terms_err
        return _err(msg, code, 400)

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        return _err(
            "You've made too many attempts from this device. Please wait a few minutes and try again.",
            "RATE_LIMIT_IP",
            429,
            headers=ip_headers,
            retry_after=_retry_after(ip_headers),
        )

    if query_single("teachers", [("phone", "==", phone)]):
        return _err(
            "This phone number is already registered. Please sign in instead.",
            "PHONE_ALREADY_REGISTERED_TEACHER",
            409,
        )
    if query_single("students", [("phone", "==", phone)]):
        return _err(
            "This number is already registered as a student account. Please sign in as a student.",
            "PHONE_ALREADY_REGISTERED_STUDENT",
            409,
        )

    # Don't create the teacher doc yet — store registration data in the OTP doc.
    # Teacher is only created in Firestore after OTP is successfully verified.
    # Terms record is stashed here so the client IP is captured at register
    # time (when the user actually ticked the checkbox), not at verify time.
    otp, rl_headers = _store_otp(phone, pending_data={
        "name": name,
        "title": title,
        "school_name": school_name,
        "school_id": school_id,
        "phone": phone,
        "terms": terms_record,
    })
    if otp is None:
        wait = _retry_after(rl_headers)
        mins = max(1, (wait + 59) // 60)
        return _err(
            f"You've requested too many codes. Please wait {mins} minute{'s' if mins != 1 else ''} before trying again.",
            "RATE_LIMIT_OTP_SEND",
            429,
            headers=rl_headers,
            retry_after=wait,
        )

    channel = _send_otp(phone, otp)
    resp = make_response(jsonify({"message": "OTP sent", "channel": channel, "verification_id": phone}), 201)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


# ─── Login ────────────────────────────────────────────────────────────────────

@auth_bp.post("/auth/login")
def auth_login():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    intended_role = (body.get("role") or "").strip().lower()  # "teacher" or "student"

    if not phone:
        return _err("Please enter your phone number.", "PHONE_REQUIRED", 400)
    phone_valid, phone_err, phone_code = _validate_phone(phone)
    if not phone_valid:
        return _err(phone_err, phone_code, 400)

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        return _err(
            "You've made too many sign-in attempts from this device. Please wait a few minutes and try again.",
            "RATE_LIMIT_IP",
            429,
            headers=ip_headers,
            retry_after=_retry_after(ip_headers),
        )

    teacher = query_single("teachers", [("phone", "==", phone)])
    student = None if teacher else query_single("students", [("phone", "==", phone)])
    if not teacher and not student:
        return _err(
            "No account found with this phone number. Tap 'Create account' to register.",
            "PHONE_NOT_FOUND",
            404,
        )

    # ── Role gate: reject cross-role login ────────────────────────────────────
    if intended_role == "student" and teacher and not student:
        return _err(
            "This number is registered as a teacher account. Please sign in on the teacher screen.",
            "ROLE_MISMATCH_IS_TEACHER",
            403,
        )
    if intended_role == "teacher" and student and not teacher:
        return _err(
            "This number is registered as a student account. Please sign in on the student screen.",
            "ROLE_MISMATCH_IS_STUDENT",
            403,
        )

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        wait = _retry_after(rl_headers)
        mins = max(1, (wait + 59) // 60)
        return _err(
            f"You've requested too many codes. Please wait {mins} minute{'s' if mins != 1 else ''} before trying again.",
            "RATE_LIMIT_OTP_SEND",
            429,
            headers=rl_headers,
            retry_after=wait,
        )

    # OTPDeliveryError is handled by the blueprint-level errorhandler, which
    # returns the real Twilio/WhatsApp reason instead of a generic message.
    channel = _send_otp(phone, otp)

    resp = make_response(jsonify({"message": "OTP sent", "channel": channel, "verification_id": phone}), 200)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


# ─── Verify OTP ───────────────────────────────────────────────────────────────

@auth_bp.post("/auth/verify")
def auth_verify():
    body = request.get_json(silent=True) or {}
    # Accept both app contract (verification_id + otp_code) and direct (phone + otp)
    phone = (body.get("verification_id") or body.get("phone") or "").strip()
    otp = (body.get("otp_code") or body.get("otp") or "").strip()

    if not phone:
        return _err("Missing phone number. Please request a new code and try again.", "VERIFICATION_ID_REQUIRED", 400)
    if not otp:
        return _err("Please enter the 6-digit code we sent to your phone.", "OTP_REQUIRED", 400)

    # ── Demo bypass ───────────────────────────────────────────────────────────
    if is_demo() and otp == "1234":
        # In demo mode any phone + OTP "1234" is accepted automatically.
        # Skip all rate-limit and hash checks.
        otp_doc = get_doc("otp_verifications", phone) or {}
        pending_data = otp_doc.get("pending_data")
        delete_doc("otp_verifications", phone)

        if pending_data and pending_data.get("role") == "student":
            class_id = pending_data.get("class_id") or "pending"
            student = Student(
                first_name=pending_data["first_name"],
                surname=pending_data["surname"],
                phone=pending_data["phone"],
                class_id=class_id,
            )
            upsert("students", student.id, student.model_dump())
            # Atomic increment student_count on the class
            if class_id and class_id != "pending":
                try:
                    increment_field("classes", class_id, "student_count", 1)
                except Exception:
                    pass
            token = create_jwt(student.id, "student", 0)
            logger.info("[demo] Auto-verified OTP (student) for %s", phone)
            return jsonify({"token": token, "user": _safe(student.model_dump())}), 200
        elif pending_data:
            teacher = Teacher(
                phone=pending_data["phone"],
                name=pending_data["name"],
                title=pending_data.get("title"),
                school_name=pending_data.get("school_name"),
                school_id=pending_data.get("school_id"),
            )
            upsert("teachers", teacher.id, teacher.model_dump())
            teacher_doc = teacher.model_dump()
        else:
            teacher_doc = query_single("teachers", [("phone", "==", phone)])
            if teacher_doc:
                token = create_jwt(teacher_doc["id"], "teacher", teacher_doc.get("token_version", 0))
                logger.info("[demo] Auto-verified OTP (teacher) for %s", phone)
                return jsonify({"token": token, "user": _safe(teacher_doc)}), 200

            student_doc = query_single("students", [("phone", "==", phone)])
            if student_doc:
                token = create_jwt(student_doc["id"], "student", student_doc.get("token_version", 0))
                logger.info("[demo] Auto-verified OTP (student login) for %s", phone)
                return jsonify({"token": token, "user": _safe(student_doc)}), 200

            return _err(
                "No account found with this phone number. Tap 'Create account' to register.",
                "PHONE_NOT_FOUND",
                404,
            )

    # ── End demo bypass ───────────────────────────────────────────────────────

    otp_doc = get_doc("otp_verifications", phone)
    if not otp_doc:
        return _err(
            "This code has expired. Please request a new one.",
            "OTP_EXPIRED",
            410,
        )

    attempts = otp_doc.get("attempts", 0)
    reset_ts = datetime.now(timezone.utc).timestamp() + _WINDOW
    rl_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts - 1, reset_ts)

    if attempts >= _OTP_VERIFY_LIMIT:
        delete_doc("otp_verifications", phone)
        return _err(
            "Too many incorrect attempts. Please request a new code.",
            "OTP_TOO_MANY_ATTEMPTS",
            429,
            headers=rl_headers,
            retry_after=0,
        )

    method = otp_doc.get("method", "self")

    def _reject_bad_otp(code_msg: str, code_key: str):
        new_attempts = attempts + 1
        if new_attempts >= _OTP_VERIFY_LIMIT:
            delete_doc("otp_verifications", phone)
        else:
            upsert("otp_verifications", phone, {"attempts": new_attempts})
        bad_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - new_attempts, reset_ts)
        remaining = max(0, _OTP_VERIFY_LIMIT - new_attempts)
        return _err(code_msg, code_key, 400, headers=bad_headers, attempts_remaining=remaining)

    if method == "bypass" or is_bypassed(phone):
        if otp != BYPASS_OTP_CODE:
            return _reject_bad_otp(
                "The code you entered is incorrect. Please try again.",
                "OTP_INVALID",
            )
        logger.warning("[BYPASS] OTP verify accepted for whitelisted number ...%s", phone[-4:])
    elif method == "verify":
        # US numbers: Twilio Verify generated and sent its own code — check via their API
        verify_sid = otp_doc.get("verify_sid")
        if not verify_sid:
            logger.error("Twilio Verify check requested but no verify_sid stored for ...%s", phone[-4:])
            return _err(
                "We couldn't verify this code — our SMS provider lost track of your session. Please request a new code.",
                "VERIFY_CONFIG_MISSING",
                500,
            )
        import os
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException
        try:
            twilio = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
            check = twilio.verify.v2.services(verify_sid).verification_checks.create(
                to=phone, code=otp
            )
            if check.status != "approved":
                return _reject_bad_otp(
                    "The code you entered is incorrect. Please try again.",
                    "OTP_INVALID",
                )
        except TwilioRestException as e:
            if e.code == 20404:
                return _err(
                    "This code has expired. Please request a new one.",
                    "OTP_EXPIRED",
                    400,
                )
            logger.error("Twilio Verify check failed for ...%s — code=%s msg=%s", phone[-4:], e.code, e.msg)
            return _err(
                f"Could not verify your code: {e.msg or 'verification service error'}. Please try again.",
                f"TWILIO_{e.code}" if e.code else "TWILIO_UNKNOWN",
                500,
            )
    else:
        # Non-US / self-managed: check hash stored in Firestore
        if not verify_otp_hash(otp, otp_doc["otp_hash"]):
            return _reject_bad_otp(
                "The code you entered is incorrect. Please try again.",
                "OTP_INVALID",
            )

    # Capture pending_data before deleting the OTP doc
    pending_data = otp_doc.get("pending_data")
    delete_doc("otp_verifications", phone)

    if pending_data and pending_data.get("role") == "student":
        # Student registration flow
        class_id = pending_data.get("class_id") or "pending"
        student = Student(
            first_name=pending_data["first_name"],
            surname=pending_data["surname"],
            phone=pending_data["phone"],
            class_id=class_id,
        )
        student_doc = student.model_dump()
        # Merge the terms record captured at register time (including client
        # IP). Teacher/Student Pydantic models don't declare these fields, so
        # we merge on the dict before the single write.
        terms_record = pending_data.get("terms") or {}
        if terms_record:
            student_doc.update(terms_record)
        upsert("students", student.id, student_doc)
        # Increment student_count on the class
        if class_id and class_id != "pending":
            cls = get_doc("classes", class_id)
            if cls:
                upsert("classes", class_id, {"student_count": cls.get("student_count", 0) + 1})
        token = create_jwt(student.id, "student", 0)
        resp = make_response(jsonify({"token": token, "user": _safe(student.model_dump())}), 200)
        for k, v in _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts, reset_ts).items():
            resp.headers[k] = v
        return resp
    elif pending_data:
        # Teacher registration flow: create teacher now that OTP is confirmed
        teacher = Teacher(
            phone=pending_data["phone"],
            name=pending_data["name"],
            title=pending_data.get("title"),
            school_name=pending_data.get("school_name"),
            school_id=pending_data.get("school_id"),
        )
        teacher_doc = teacher.model_dump()
        # Merge the terms record captured at register time (including client
        # IP). Teacher/Student Pydantic models don't declare these fields, so
        # we merge on the dict before the single write.
        terms_record = pending_data.get("terms") or {}
        if terms_record:
            teacher_doc.update(terms_record)
        upsert("teachers", teacher.id, teacher_doc)
    else:
        # Login flow: check teachers first, then students
        teacher_doc = query_single("teachers", [("phone", "==", phone)])
        if teacher_doc:
            token = create_jwt(teacher_doc["id"], "teacher", teacher_doc.get("token_version", 0))
            resp = make_response(jsonify({"token": token, "user": _safe(teacher_doc)}), 200)
            for k, v in _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts, reset_ts).items():
                resp.headers[k] = v
            return resp

        student_doc = query_single("students", [("phone", "==", phone)])
        if student_doc:
            token = create_jwt(student_doc["id"], "student", student_doc.get("token_version", 0))
            resp = make_response(jsonify({"token": token, "user": _safe(student_doc)}), 200)
            for k, v in _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts, reset_ts).items():
                resp.headers[k] = v
            return resp

        return _err(
            "No account found with this phone number. Tap 'Create account' to register.",
            "PHONE_NOT_FOUND",
            404,
        )

    token = create_jwt(teacher_doc["id"], "teacher", teacher_doc.get("token_version", 0))
    resp = make_response(jsonify({"token": token, "user": _safe(teacher_doc)}), 200)
    for k, v in _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts, reset_ts).items():
        resp.headers[k] = v
    return resp


# ─── Resend OTP ───────────────────────────────────────────────────────────────

@auth_bp.post("/auth/resend-otp")
def auth_resend_otp():
    body = request.get_json(silent=True) or {}
    phone = (body.get("verification_id") or body.get("phone") or "").strip()
    channel_preference = body.get("channel_preference")

    if not phone:
        return _err(
            "Missing phone number. Please go back and start again.",
            "VERIFICATION_ID_REQUIRED",
            400,
        )

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        return _err(
            "You've made too many attempts from this device. Please wait a few minutes and try again.",
            "RATE_LIMIT_IP",
            429,
            headers=ip_headers,
            retry_after=_retry_after(ip_headers),
        )

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        wait = _retry_after(rl_headers)
        mins = max(1, (wait + 59) // 60)
        return _err(
            f"You've requested too many codes. Please wait {mins} minute{'s' if mins != 1 else ''} before trying again.",
            "RATE_LIMIT_OTP_SEND",
            429,
            headers=rl_headers,
            retry_after=wait,
        )

    channel = _send_otp(phone, otp)  # OTPDeliveryError → blueprint errorhandler
    resp = make_response(jsonify({"message": "OTP resent", "channel": channel, "verification_id": phone}), 200)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


# ─── Me ───────────────────────────────────────────────────────────────────────

@auth_bp.get("/auth/me")
def auth_me():
    # Try teacher first, then student — require_role validates token_version.
    user_id, err = require_role(request, "teacher", "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    # Check teachers first, then students
    doc = get_doc("teachers", user_id)
    if doc:
        return jsonify(_safe(doc)), 200

    doc = get_doc("students", user_id)
    if doc:
        return jsonify(_safe_student(doc)), 200

    return _err(
        "We couldn't find your account. Please sign in again.",
        "ACCOUNT_NOT_FOUND",
        404,
    )


# ─── Profile update ───────────────────────────────────────────────────────────

# Allowlist of fields a teacher can update via PATCH /api/auth/profile.
_PROFILE_UPDATABLE = frozenset({"training_data_consent"})


@auth_bp.patch("/auth/profile")
def auth_update_profile():
    """
    Update mutable profile preferences on the authenticated teacher document.

    Currently accepted fields:
      training_data_consent  (bool) — opt in/out of training data collection
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    updates = {k: v for k, v in body.items() if k in _PROFILE_UPDATABLE}

    if not updates:
        return _err(
            "Nothing to update. Please change a field before saving.",
            "NO_FIELDS_PROVIDED",
            400,
        )

    upsert("teachers", teacher_id, updates)
    return jsonify({"message": "profile updated", **updates}), 200


# ─── Recover ──────────────────────────────────────────────────────────────────

@auth_bp.post("/auth/recover")
def auth_recover():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()

    if not phone:
        return _err("Please enter your phone number.", "PHONE_REQUIRED", 400)

    teacher = query_single("teachers", [("phone", "==", phone)])
    if not teacher:
        return _err(
            "No account found with this phone number. Double-check the number and try again.",
            "PHONE_NOT_FOUND",
            404,
        )

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        return _err(
            "You've made too many recovery attempts from this device. Please wait a few minutes and try again.",
            "RATE_LIMIT_IP",
            429,
            headers=ip_headers,
            retry_after=_retry_after(ip_headers),
        )

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        wait = _retry_after(rl_headers)
        mins = max(1, (wait + 59) // 60)
        return _err(
            f"You've requested too many recovery codes. Please wait {mins} minute{'s' if mins != 1 else ''} before trying again.",
            "RATE_LIMIT_OTP_SEND",
            429,
            headers=rl_headers,
            retry_after=wait,
        )

    _send_otp(phone, otp)  # OTPDeliveryError → blueprint errorhandler
    resp = make_response(jsonify({"message": "Recovery OTP sent"}), 200)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


# ─── PIN management ───────────────────────────────────────────────────────────

@auth_bp.post("/auth/pin/set")
def auth_pin_set():
    user_id, err = require_role(request, "teacher")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()
    if len(pin) != 4 or not pin.isdigit():
        return _err(
            "Your PIN must be exactly 4 digits (numbers only).",
            "PIN_FORMAT_INVALID",
            400,
        )

    upsert("teachers", user_id, {"pin_hash": hash_pin(pin), "pin_attempts": 0, "pin_locked": False})
    return jsonify({"message": "PIN set"}), 200


@auth_bp.post("/auth/pin/verify")
def auth_pin_verify():
    user_id, err = require_role(request, "teacher")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()

    teacher = get_doc("teachers", user_id)
    if not teacher or not teacher.get("pin_hash"):
        return _err(
            "You haven't set a PIN yet. Set one in Settings first.",
            "PIN_NOT_SET",
            400,
        )

    if teacher.get("pin_locked"):
        return _err(
            "Your PIN is locked after 5 wrong attempts. Please reset it using OTP recovery.",
            "PIN_LOCKED",
            403,
        )

    if not verify_pin(pin, teacher["pin_hash"]):
        attempts = teacher.get("pin_attempts", 0) + 1
        locked = attempts >= 5
        upsert("teachers", user_id, {"pin_attempts": attempts, "pin_locked": locked})
        remaining = max(0, 5 - attempts)
        if locked:
            msg = "That PIN is wrong. You've been locked out — reset your PIN using OTP recovery."
            code = "PIN_LOCKED"
        else:
            msg = f"That PIN is wrong. You have {remaining} attempt{'s' if remaining != 1 else ''} left."
            code = "PIN_WRONG"
        return _err(msg, code, 400, attempts=attempts)

    upsert("teachers", user_id, {"pin_attempts": 0})
    return jsonify({"message": "PIN verified"}), 200


@auth_bp.delete("/auth/pin")
def auth_pin_delete():
    user_id, err = require_role(request, "teacher")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    upsert("teachers", user_id, {"pin_hash": None, "pin_attempts": 0, "pin_locked": False})
    return jsonify({"message": "PIN removed"}), 200


# ─── Profile update ───────────────────────────────────────────────────────────

@auth_bp.post("/auth/profile/request-otp")
def auth_profile_request_otp():
    """Send OTP to a phone number for profile update verification. Requires valid JWT (teacher or student)."""
    user_id, err = require_role(request, "teacher", "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        return _err("Please enter the phone number to verify.", "PHONE_REQUIRED", 400)

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        return _err(
            "You've made too many attempts from this device. Please wait a few minutes and try again.",
            "RATE_LIMIT_IP",
            429,
            headers=ip_headers,
            retry_after=_retry_after(ip_headers),
        )

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        wait = _retry_after(rl_headers)
        mins = max(1, (wait + 59) // 60)
        return _err(
            f"You've requested too many codes. Please wait {mins} minute{'s' if mins != 1 else ''} before trying again.",
            "RATE_LIMIT_OTP_SEND",
            429,
            headers=rl_headers,
            retry_after=wait,
        )

    channel = _send_otp(phone, otp)  # OTPDeliveryError → blueprint errorhandler
    resp = make_response(jsonify({"message": "OTP sent", "channel": channel, "verification_id": phone}), 200)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


@auth_bp.post("/auth/terms-accept")
def auth_terms_accept():
    """Record that the teacher has accepted the current terms version. JWT required, no OTP."""
    user_id, err = require_role(request, "teacher")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    terms_version = (body.get("terms_version") or "").strip() or "1.0"

    upsert("teachers", user_id, {
        "terms_accepted": True,
        "terms_version": terms_version,
        "terms_accepted_at": datetime.now(timezone.utc).isoformat(),
    })
    logger.info("Terms accepted: teacher_id=%s version=%s", user_id, terms_version)
    return jsonify({"message": "Terms accepted"}), 200


@auth_bp.patch("/auth/me")
def auth_update_me():
    """Update teacher profile. Requires valid JWT + OTP verification."""
    user_id, err = require_role(request, "teacher")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    verification_id = (body.get("verification_id") or "").strip()
    otp_code = (body.get("otp_code") or "").strip()

    if not verification_id or not otp_code:
        return _err(
            "Please enter the code we sent to your phone to save your changes.",
            "OTP_REQUIRED",
            400,
        )

    # Verify OTP
    otp_doc = get_doc("otp_verifications", verification_id)
    if not otp_doc:
        return _err(
            "This code has expired. Please request a new one.",
            "OTP_EXPIRED",
            400,
        )

    attempts = otp_doc.get("attempts", 0)
    reset_ts = datetime.now(timezone.utc).timestamp() + _WINDOW
    rl_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts - 1, reset_ts)

    if attempts >= _OTP_VERIFY_LIMIT:
        delete_doc("otp_verifications", verification_id)
        return _err(
            "Too many incorrect attempts. Please request a new code.",
            "OTP_TOO_MANY_ATTEMPTS",
            429,
            headers=rl_headers,
            retry_after=0,
        )

    method = otp_doc.get("method", "self")

    def _reject_bad_otp_pm(code_msg: str, code_key: str):
        new_attempts = attempts + 1
        if new_attempts >= _OTP_VERIFY_LIMIT:
            delete_doc("otp_verifications", verification_id)
        else:
            upsert("otp_verifications", verification_id, {"attempts": new_attempts})
        bad_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - new_attempts, reset_ts)
        remaining = max(0, _OTP_VERIFY_LIMIT - new_attempts)
        return _err(code_msg, code_key, 400, headers=bad_headers, attempts_remaining=remaining)

    if method == "verify":
        verify_sid = otp_doc.get("verify_sid")
        if not verify_sid:
            logger.error("Twilio Verify check requested but no verify_sid stored for ...%s", verification_id[-4:])
            return _err(
                "We couldn't verify this code — our SMS provider lost track of your session. Please request a new code.",
                "VERIFY_CONFIG_MISSING",
                500,
            )
        import os
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException
        try:
            twilio = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
            check = twilio.verify.v2.services(verify_sid).verification_checks.create(
                to=verification_id, code=otp_code
            )
            if check.status != "approved":
                return _reject_bad_otp_pm(
                    "The code you entered is incorrect. Please try again.",
                    "OTP_INVALID",
                )
        except TwilioRestException as e:
            if e.code == 20404:
                return _err(
                    "This code has expired. Please request a new one.",
                    "OTP_EXPIRED",
                    400,
                )
            logger.error("Twilio Verify check failed for ...%s — code=%s msg=%s", verification_id[-4:], e.code, e.msg)
            return _err(
                f"Could not verify your code: {e.msg or 'verification service error'}. Please try again.",
                f"TWILIO_{e.code}" if e.code else "TWILIO_UNKNOWN",
                500,
            )
    else:
        if not verify_otp_hash(otp_code, otp_doc["otp_hash"]):
            return _reject_bad_otp_pm(
                "The code you entered is incorrect. Please try again.",
                "OTP_INVALID",
            )

    delete_doc("otp_verifications", verification_id)

    teacher = get_doc("teachers", user_id)
    if not teacher:
        return _err(
            "We couldn't find your teacher profile. Please sign in again.",
            "TEACHER_NOT_FOUND",
            404,
        )

    updates: dict = {}
    title = (body.get("title") or "").strip() or None
    first_name = (body.get("first_name") or "").strip()
    surname = (body.get("surname") or "").strip()
    new_phone = (body.get("phone") or "").strip()

    if title is not None:
        updates["title"] = title
    if first_name:
        updates["first_name"] = first_name
    if surname:
        updates["surname"] = surname
    if first_name or surname:
        fn = first_name or teacher.get("first_name") or ""
        sn = surname or teacher.get("surname") or ""
        updates["name"] = f"{fn} {sn}".strip()

    terms_accepted = body.get("terms_accepted")
    terms_version = (body.get("terms_version") or "").strip()
    if terms_accepted is True:
        updates["terms_accepted"] = True
        updates["terms_version"] = terms_version or "1.0"
        updates["terms_accepted_at"] = datetime.now(timezone.utc).isoformat()

    if new_phone and new_phone != teacher.get("phone"):
        existing = query_single("teachers", [("phone", "==", new_phone)])
        if existing and existing["id"] != user_id:
            return _err(
                "That phone number is already registered to another account.",
                "PHONE_TAKEN_BY_OTHER",
                409,
            )
        updates["phone"] = new_phone
        updates["token_version"] = (teacher.get("token_version") or 0) + 1

    if updates:
        upsert("teachers", user_id, updates)

    updated_teacher = get_doc("teachers", user_id)

    resp_body: dict = {"user": _safe(updated_teacher)}
    if "token_version" in updates:
        resp_body["token"] = create_jwt(user_id, "teacher", updates["token_version"])

    return jsonify(resp_body), 200


# ─── Student lookup (by join code) ───────────────────────────────────────────

@auth_bp.post("/auth/student/lookup")
def auth_student_lookup():
    """
    Public — find a class by join code so the student registration wizard
    can confirm the code is valid before proceeding.

    Body: { join_code: str }
    Returns: { id, name, education_level, teacher_name, school_name }
    """
    body = request.get_json(silent=True) or {}
    raw_code = (body.get("join_code") or "").strip()
    logger.debug("[auth] student/lookup join_code=%r (raw)", raw_code)

    if not raw_code:
        return _err(
            "Please enter the join code from your teacher.",
            "JOIN_CODE_REQUIRED",
            400,
        )

    # Normalize: uppercase, strip whitespace — join codes are always stored uppercase
    code = raw_code.upper()
    logger.info("[auth] student/lookup normalised join_code=%s", code)

    cls = query_single("classes", [("join_code", "==", code)])
    if not cls:
        logger.info("[auth] student/lookup no class found for join_code=%s", code)
        return _err(
            f"No class found for code '{code}'. Double-check the code with your teacher.",
            "CLASS_NOT_FOUND",
            404,
        )

    teacher_id = cls.get("teacher_id", "")
    teacher = get_doc("teachers", teacher_id) if teacher_id else None
    teacher_name = ""
    if teacher:
        teacher_name = teacher.get("name") or (
            f"{teacher.get('first_name', '')} {teacher.get('surname', '')}".strip()
        )

    school_id = cls.get("school_id", "")
    school = get_doc("schools", school_id) if school_id else None
    school_name = (school or {}).get("name") or cls.get("school_name", "")

    logger.info(
        "[auth] student/lookup found class id=%s name=%r school=%r for join_code=%s",
        cls["id"], cls.get("name"), school_name, code,
    )
    return jsonify({
        "id": cls["id"],
        "name": cls.get("name", ""),
        "education_level": cls.get("education_level", ""),
        "subject": cls.get("subject"),
        "teacher_name": teacher_name,
        "school_name": school_name,
        "join_code": code,
    }), 200


# ─── Student registration ─────────────────────────────────────────────────────

@auth_bp.post("/auth/student/register")
def auth_student_register():
    """
    Public — register a new student account.

    Body: { first_name, surname, phone, class_id?, class_join_code?, manual_class_name? }
    Returns: { verification_id, channel, message }

    After OTP verification via POST /auth/verify, a Student document is created
    in Firestore and a JWT is issued.
    """
    body = request.get_json(silent=True) or {}
    first_name = (body.get("first_name") or "").strip()
    surname = (body.get("surname") or "").strip()
    phone = (body.get("phone") or "").strip()
    class_id = (body.get("class_id") or "").strip() or None
    class_join_code = ((body.get("class_join_code") or "").strip().upper()) or None
    manual_class_name = (body.get("manual_class_name") or "").strip() or None

    logger.debug(
        "[auth] student/register first_name=%r surname=%r phone=%r class_id=%r join_code=%r",
        first_name, surname, phone, class_id, class_join_code,
    )

    missing = []
    if not first_name:
        missing.append("first name")
    if not surname:
        missing.append("surname")
    if not phone:
        missing.append("phone number")
    if missing:
        return _err(
            f"Please enter your {', '.join(missing)} to continue.",
            "STUDENT_REGISTER_FIELDS_MISSING",
            400,
        )
    phone_valid, phone_err, phone_code = _validate_phone(phone)
    if not phone_valid:
        return _err(phone_err, phone_code, 400)
    if not class_id and not class_join_code and not manual_class_name:
        return _err(
            "Please pick a class or enter your class join code before continuing.",
            "CLASS_REFERENCE_REQUIRED",
            400,
        )

    terms_record, terms_err = _build_terms_record(body)
    if terms_err is not None:
        msg, code = terms_err
        return _err(msg, code, 400)

    # Resolve join code → class_id if not already provided
    if class_join_code and not class_id:
        cls = query_single("classes", [("join_code", "==", class_join_code)])
        if cls:
            class_id = cls["id"]
            logger.info("[auth] student/register resolved join_code=%s to class_id=%s", class_join_code, class_id)

    # Reject duplicate phone
    if query_single("students", [("phone", "==", phone)]):
        return _err(
            "You already have a student account with this phone number. Please sign in instead.",
            "PHONE_ALREADY_REGISTERED_STUDENT",
            409,
        )
    if query_single("teachers", [("phone", "==", phone)]):
        return _err(
            "This number is already registered as a teacher account. Please use the teacher sign-in.",
            "PHONE_ALREADY_REGISTERED_TEACHER",
            409,
        )

    # IP rate limit
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        return _err(
            "You've made too many attempts from this device. Please wait a few minutes and try again.",
            "RATE_LIMIT_IP",
            429,
            headers=ip_headers,
            retry_after=_retry_after(ip_headers),
        )

    otp, rl_headers = _store_otp(phone, pending_data={
        "role": "student",
        "first_name": first_name,
        "surname": surname,
        "phone": phone,
        "class_id": class_id,
        "manual_class_name": manual_class_name,
        "terms": terms_record,
    })
    if otp is None:
        wait = _retry_after(rl_headers)
        mins = max(1, (wait + 59) // 60)
        return _err(
            f"You've requested too many codes. Please wait {mins} minute{'s' if mins != 1 else ''} before trying again.",
            "RATE_LIMIT_OTP_SEND",
            429,
            headers=rl_headers,
            retry_after=wait,
        )

    channel = _send_otp(phone, otp)  # OTPDeliveryError → blueprint errorhandler
    logger.info("[auth] student/register OTP sent via %s for phone=%s", channel, phone)
    resp = make_response(
        jsonify({"message": "OTP sent", "channel": channel, "verification_id": phone}),
        201,
    )
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


# ─── Student profile update ──────────────────────────────────────────────────

@auth_bp.put("/auth/student/update")
def auth_student_update():
    """
    Authenticated — update student profile fields.

    Body: { first_name?, surname? }
    Phone changes require OTP verification (not handled here).
    """
    student_id, err = require_role(request, "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    updates: dict = {}

    first_name = (body.get("first_name") or "").strip()
    surname = (body.get("surname") or "").strip()
    if first_name:
        updates["first_name"] = first_name
    if surname:
        updates["surname"] = surname

    if not updates:
        return _err(
            "Nothing to update. Please change your first name or surname before saving.",
            "NO_FIELDS_PROVIDED",
            400,
        )

    upsert("students", student_id, updates)
    updated = get_doc("students", student_id)
    logger.info("[auth] student/update id=%s fields=%s", student_id, list(updates.keys()))
    return jsonify({"student": updated}), 200


@auth_bp.delete("/auth/student/<student_id>")
def auth_student_delete(student_id: str):
    """
    Authenticated — delete own student account.
    The JWT's user_id must match the student_id in the path.
    """
    caller_id, err = require_role(request, "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )
    if caller_id != student_id:
        return _err(
            "You can only delete your own account.",
            "FORBIDDEN_NOT_OWNER",
            403,
        )

    student = get_doc("students", student_id)
    if not student:
        return _err(
            "We couldn't find your account. It may have already been deleted.",
            "STUDENT_NOT_FOUND",
            404,
        )

    delete_doc("students", student_id)
    logger.info("[auth] student/%s deleted own account", student_id)
    return jsonify({"deleted": True}), 200


@auth_bp.post("/auth/student/join-class")
def auth_student_join_class():
    """
    Authenticated — join a class by join code.

    Body: { join_code: str }
    Adds the class to the student's class_ids list. Sets it as the primary class_id.
    """
    student_id, err = require_role(request, "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    join_code = (body.get("join_code") or "").strip().upper()
    class_id = (body.get("class_id") or "").strip()

    if not join_code and not class_id:
        return _err(
            "Please enter the join code from your teacher.",
            "JOIN_CODE_REQUIRED",
            400,
        )

    cls = None
    if class_id:
        cls = get_doc("classes", class_id)
    if not cls and join_code:
        cls = query_single("classes", [("join_code", "==", join_code)])
    if not cls:
        return _err(
            "We couldn't find that class. Double-check the code with your teacher.",
            "CLASS_NOT_FOUND",
            404,
        )

    student = get_doc("students", student_id)
    if not student:
        return _err(
            "We couldn't find your student account. Please sign in again.",
            "STUDENT_NOT_FOUND",
            404,
        )

    existing_ids: list[str] = student.get("class_ids", [])
    # Backfill: if student has a single class_id but no class_ids list yet
    if not existing_ids and student.get("class_id"):
        existing_ids = [student["class_id"]]

    if cls["id"] in existing_ids:
        return _err(
            f"You're already enrolled in {cls.get('name', 'this class')}.",
            "ALREADY_ENROLLED",
            409,
        )

    new_ids = list(set(existing_ids + [cls["id"]]))
    upsert("students", student_id, {"class_ids": new_ids, "class_id": cls["id"]})

    # Atomic increment — avoids read-then-write race condition
    increment_field("classes", cls["id"], "student_count", 1)

    # Notify the teacher that a new student joined
    teacher_id_cls = cls.get("teacher_id", "")
    if teacher_id_cls:
        try:
            from functions.push import send_teacher_notification
            student_doc = get_doc("students", student_id)
            sname = f"{(student_doc or {}).get('first_name', '')} {(student_doc or {}).get('surname', '')}".strip() or "A student"
            send_teacher_notification(
                teacher_id_cls,
                "New Student",
                f"{sname} joined {cls.get('name', 'your class')}",
                {"screen": "ClassDetail", "class_id": cls["id"]},
            )
        except Exception:
            pass  # non-fatal

    logger.info("[auth] student/%s joined class %s (%s)", student_id, cls["id"], cls.get("name"))
    return jsonify({
        "success": True,
        "class_id": cls["id"],
        "class_name": cls.get("name", ""),
        "subject": cls.get("subject", ""),
        "message": f"Joined {cls.get('name', 'class')} successfully!",
    }), 200


# ─── Student class management ──────────────────────────────────────────────────

@auth_bp.get("/auth/student/classes")
def auth_student_classes():
    """Return all classes the student is enrolled in, enriched with teacher/school."""
    student_id, err = require_role(request, "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    student = get_doc("students", student_id)
    if not student:
        return _err(
            "We couldn't find your student account. Please sign in again.",
            "STUDENT_NOT_FOUND",
            404,
        )

    class_ids: list[str] = student.get("class_ids", [])
    if not class_ids and student.get("class_id"):
        class_ids = [student["class_id"]]

    classes = []
    for cid in class_ids:
        cls = get_doc("classes", cid)
        if not cls:
            continue
        teacher = get_doc("teachers", cls.get("teacher_id", "")) if cls.get("teacher_id") else None
        classes.append({
            "class_id": cid,
            "name": cls.get("name", ""),
            "subject": cls.get("subject", ""),
            "education_level": cls.get("education_level", ""),
            "teacher_name": f"{(teacher or {}).get('first_name', '')} {(teacher or {}).get('surname', '')}".strip() if teacher else "",
            "school_name": (teacher or {}).get("school_name", ""),
        })

    return jsonify({
        "classes": classes,
        "active_class_id": student.get("class_id", ""),
        "total": len(classes),
    }), 200


@auth_bp.delete("/auth/student/leave-class")
def auth_student_leave_class():
    """Remove a class from the student's enrollment."""
    student_id, err = require_role(request, "student")
    if err:
        return _err(
            err or "Your session has expired. Please sign in again.",
            "UNAUTHORIZED",
            401,
        )

    body = request.get_json(silent=True) or {}
    class_id = (body.get("class_id") or "").strip()
    if not class_id:
        return _err(
            "Please pick the class you want to leave.",
            "CLASS_ID_REQUIRED",
            400,
        )

    student = get_doc("students", student_id)
    if not student:
        return _err(
            "We couldn't find your student account. Please sign in again.",
            "STUDENT_NOT_FOUND",
            404,
        )

    class_ids: list[str] = student.get("class_ids", [])
    if not class_ids and student.get("class_id"):
        class_ids = [student["class_id"]]

    if class_id not in class_ids:
        return _err(
            "You're not enrolled in that class.",
            "NOT_ENROLLED",
            404,
        )

    new_ids = [c for c in class_ids if c != class_id]
    new_active = new_ids[0] if new_ids else None
    upsert("students", student_id, {"class_ids": new_ids, "class_id": new_active})

    # Atomic decrement — avoids read-then-write race condition
    try:
        increment_field("classes", class_id, "student_count", -1)
    except Exception:
        pass  # class may have been deleted

    logger.info("[auth] student/%s left class %s, remaining=%d", student_id, class_id, len(new_ids))
    return jsonify({"success": True, "remaining_classes": len(new_ids), "active_class_id": new_active}), 200


# ─── Helpers ──────────────────────────────────────────────────────────────────

_SCHOOL_ID_MAP = {
    "zw-001": "Prince Edward School", "zw-002": "St George's College",
    "zw-003": "Harare High School", "zw-004": "Girls High School",
    "zw-005": "Highlands Junior School", "zw-006": "Borrowdale Primary School",
    "zw-007": "Marlborough High School", "zw-008": "Kuwadzana Primary School",
    "zw-009": "Christian Brothers College", "zw-010": "Eveline High School",
    "zw-011": "Mzilikazi Primary School", "zw-012": "Plumtree High School",
    "zw-013": "Townsend Primary School", "zw-014": "Goromonzi High School",
    "zw-015": "Mutare Boys High School", "zw-016": "Marist Brothers Nyanga",
    "zw-017": "Chiredzi High School", "zw-018": "Chinhoyi Primary School",
    "zw-019": "Gweru Technical College", "zw-020": "Harare Polytechnic",
}


def _safe(teacher: dict) -> dict:
    """Strip sensitive fields and normalise name fields for the app."""
    out = {k: v for k, v in teacher.items() if k not in ("pin_hash",)}
    out.setdefault("role", "teacher")  # backfill for accounts created before role field was added
    # Resolve school ID if school_name looks like a code (safety net)
    sn = out.get("school_name") or ""
    if sn in _SCHOOL_ID_MAP:
        out["school_name"] = _SCHOOL_ID_MAP[sn]
    # Derive first_name / surname from combined name
    if "name" in out and not out.get("first_name"):
        parts = (out["name"] or "").split(" ", 1)
        out["first_name"] = parts[0]
        out["surname"] = parts[1] if len(parts) > 1 else ""
    # Build display_name: "Mr Tinotenda Maisiri" or just "Tinotenda Maisiri"
    title = out.get("title") or ""
    out["display_name"] = f"{title} {out.get('name', '')}".strip()
    return out


def _safe_student(student: dict) -> dict:
    """Enrich student profile with full class details for /auth/me."""
    out = {k: v for k, v in student.items() if k not in ("pin_hash",)}
    out.setdefault("role", "student")

    # Build classes array with teacher + school info
    class_ids: list[str] = out.get("class_ids", [])
    if not class_ids and out.get("class_id"):
        class_ids = [out["class_id"]]

    classes = []
    for cid in class_ids:
        cls = get_doc("classes", cid)
        if not cls:
            continue
        teacher = get_doc("teachers", cls.get("teacher_id", "")) if cls.get("teacher_id") else None
        school_name = ""
        if teacher:
            sn = teacher.get("school_name") or ""
            school_name = _SCHOOL_ID_MAP.get(sn, sn)
        classes.append({
            "class_id": cid,
            "name": cls.get("name", ""),
            "subject": cls.get("subject", ""),
            "education_level": cls.get("education_level", ""),
            "teacher_name": f"{(teacher or {}).get('first_name', '')} {(teacher or {}).get('surname', '')}".strip() if teacher else "",
            "school_name": school_name,
        })

    out["classes"] = classes
    out["class_ids"] = class_ids

    # Set school/class_name from the primary class for backwards compat
    primary = next((c for c in classes if c["class_id"] == out.get("class_id")), None)
    if primary:
        out.setdefault("school", primary["school_name"])
        out["class_name"] = f"{primary['name']}{' — ' + primary['subject'] if primary['subject'] else ''}"

    return out
