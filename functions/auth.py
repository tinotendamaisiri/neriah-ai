"""Auth endpoints — register, login, verify OTP, me, recover, PIN management."""

from __future__ import annotations

import logging
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
from shared.firestore_client import delete_doc, get_doc, query, query_single, upsert
from shared.models import Student, Teacher
from shared.sms_client import send_otp as _dispatch_otp

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)

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

    if not phone or not name:
        return jsonify({"error": "phone and name are required"}), 400

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(jsonify({"error": "Too many requests. Try again later.", "retry_after": _retry_after(ip_headers)}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    if query_single("teachers", [("phone", "==", phone)]):
        return jsonify({"error": "Phone already registered"}), 409

    # Don't create the teacher doc yet — store registration data in the OTP doc.
    # Teacher is only created in Firestore after OTP is successfully verified.
    otp, rl_headers = _store_otp(phone, pending_data={
        "name": name,
        "title": title,
        "school_name": school_name,
        "school_id": school_id,
        "phone": phone,
    })
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests.", "retry_after": _retry_after(rl_headers)}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

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

    if not phone:
        return jsonify({"error": "phone is required"}), 400

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(jsonify({"error": "Too many requests. Try again later.", "retry_after": _retry_after(ip_headers)}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    teacher = query_single("teachers", [("phone", "==", phone)])
    student = None if teacher else query_single("students", [("phone", "==", phone)])
    if not teacher and not student:
        return jsonify({"error": "Phone not registered"}), 404

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests.", "retry_after": _retry_after(rl_headers)}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    try:
        channel = _send_otp(phone, otp)
    except Exception as exc:
        logger.error("OTP delivery failed for ...%s: %s", phone[-4:], exc)
        resp = make_response(jsonify({"error": "Failed to send verification code. Please try again."}), 503)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

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

    if not phone or not otp:
        return jsonify({"error": "verification_id and otp_code are required"}), 400

    # ── Demo bypass ───────────────────────────────────────────────────────────
    if is_demo() and otp == "1234":
        # In demo mode any phone + OTP "1234" is accepted automatically.
        # Skip all rate-limit and hash checks.
        otp_doc = get_doc("otp_verifications", phone) or {}
        pending_data = otp_doc.get("pending_data")
        delete_doc("otp_verifications", phone)

        if pending_data and pending_data.get("role") == "student":
            student = Student(
                first_name=pending_data["first_name"],
                surname=pending_data["surname"],
                phone=pending_data["phone"],
                class_id=pending_data.get("class_id") or "pending",
            )
            upsert("students", student.id, student.model_dump())
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

            return jsonify({"error": "Account not found"}), 404

    # ── End demo bypass ───────────────────────────────────────────────────────

    otp_doc = get_doc("otp_verifications", phone)
    if not otp_doc:
        return jsonify({"error": "OTP not found or expired"}), 410

    attempts = otp_doc.get("attempts", 0)
    reset_ts = datetime.now(timezone.utc).timestamp() + _WINDOW
    rl_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts - 1, reset_ts)

    if attempts >= _OTP_VERIFY_LIMIT:
        delete_doc("otp_verifications", phone)
        resp = make_response(jsonify({"error": "Too many attempts. Request a new OTP.", "retry_after": 0}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    method = otp_doc.get("method", "self")

    if method == "verify":
        # US numbers: Twilio Verify generated and sent its own code — check via their API
        verify_sid = otp_doc.get("verify_sid")
        if not verify_sid:
            return jsonify({"error": "Verification configuration error"}), 500
        import os
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException
        try:
            twilio = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
            check = twilio.verify.v2.services(verify_sid).verification_checks.create(
                to=phone, code=otp
            )
            if check.status != "approved":
                new_attempts = attempts + 1
                if new_attempts >= _OTP_VERIFY_LIMIT:
                    delete_doc("otp_verifications", phone)
                else:
                    upsert("otp_verifications", phone, {"attempts": new_attempts})
                bad_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - new_attempts, reset_ts)
                resp = make_response(jsonify({"error": "Invalid OTP"}), 400)
                for k, v in bad_headers.items():
                    resp.headers[k] = v
                return resp
        except TwilioRestException as e:
            if e.code == 20404:
                return jsonify({"error": "OTP not found or expired"}), 400
            return jsonify({"error": "Verification service error"}), 500
    else:
        # Non-US / self-managed: check hash stored in Firestore
        if not verify_otp_hash(otp, otp_doc["otp_hash"]):
            new_attempts = attempts + 1
            if new_attempts >= _OTP_VERIFY_LIMIT:
                delete_doc("otp_verifications", phone)
            else:
                upsert("otp_verifications", phone, {"attempts": new_attempts})
            bad_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - new_attempts, reset_ts)
            resp = make_response(jsonify({"error": "Invalid OTP"}), 400)
            for k, v in bad_headers.items():
                resp.headers[k] = v
            return resp

    # Capture pending_data before deleting the OTP doc
    pending_data = otp_doc.get("pending_data")
    delete_doc("otp_verifications", phone)

    if pending_data and pending_data.get("role") == "student":
        # Student registration flow
        student = Student(
            first_name=pending_data["first_name"],
            surname=pending_data["surname"],
            phone=pending_data["phone"],
            class_id=pending_data.get("class_id") or "pending",
        )
        upsert("students", student.id, student.model_dump())
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
        upsert("teachers", teacher.id, teacher.model_dump())
        teacher_doc = teacher.model_dump()
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

        return jsonify({"error": "Account not found"}), 404

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
        return jsonify({"error": "verification_id is required"}), 400

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(jsonify({"error": "Too many requests. Try again later.", "retry_after": _retry_after(ip_headers)}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests.", "retry_after": _retry_after(rl_headers)}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    channel = _send_otp(phone, otp)
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
        return jsonify({"error": err}), 401

    # Check teachers first, then students
    doc = get_doc("teachers", user_id)
    if doc:
        return jsonify(_safe(doc)), 200

    doc = get_doc("students", user_id)
    if doc:
        return jsonify(_safe_student(doc)), 200

    return jsonify({"error": "Not found"}), 404


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
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    updates = {k: v for k, v in body.items() if k in _PROFILE_UPDATABLE}

    if not updates:
        return jsonify({"error": "No updatable fields provided"}), 400

    upsert("teachers", teacher_id, updates)
    return jsonify({"message": "profile updated", **updates}), 200


# ─── Recover ──────────────────────────────────────────────────────────────────

@auth_bp.post("/auth/recover")
def auth_recover():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()

    if not phone:
        return jsonify({"error": "phone is required"}), 400

    teacher = query_single("teachers", [("phone", "==", phone)])
    if not teacher:
        return jsonify({"error": "Phone not registered"}), 404

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(jsonify({"error": "Too many requests. Try again later.", "retry_after": _retry_after(ip_headers)}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests.", "retry_after": _retry_after(rl_headers)}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    _send_otp(phone, otp)
    resp = make_response(jsonify({"message": "Recovery OTP sent"}), 200)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


# ─── PIN management ───────────────────────────────────────────────────────────

@auth_bp.post("/auth/pin/set")
def auth_pin_set():
    user_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()
    if len(pin) != 4 or not pin.isdigit():
        return jsonify({"error": "PIN must be exactly 4 digits"}), 400

    upsert("teachers", user_id, {"pin_hash": hash_pin(pin), "pin_attempts": 0, "pin_locked": False})
    return jsonify({"message": "PIN set"}), 200


@auth_bp.post("/auth/pin/verify")
def auth_pin_verify():
    user_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    pin = (body.get("pin") or "").strip()

    teacher = get_doc("teachers", user_id)
    if not teacher or not teacher.get("pin_hash"):
        return jsonify({"error": "No PIN set"}), 400

    if teacher.get("pin_locked"):
        return jsonify({"error": "PIN locked after too many attempts"}), 403

    if not verify_pin(pin, teacher["pin_hash"]):
        attempts = teacher.get("pin_attempts", 0) + 1
        locked = attempts >= 5
        upsert("teachers", user_id, {"pin_attempts": attempts, "pin_locked": locked})
        return jsonify({"error": "Wrong PIN", "attempts": attempts}), 400

    upsert("teachers", user_id, {"pin_attempts": 0})
    return jsonify({"message": "PIN verified"}), 200


@auth_bp.delete("/auth/pin")
def auth_pin_delete():
    user_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    upsert("teachers", user_id, {"pin_hash": None, "pin_attempts": 0, "pin_locked": False})
    return jsonify({"message": "PIN removed"}), 200


# ─── Profile update ───────────────────────────────────────────────────────────

@auth_bp.post("/auth/profile/request-otp")
def auth_profile_request_otp():
    """Send OTP to a phone number for profile update verification. Requires valid JWT (teacher or student)."""
    user_id, err = require_role(request, "teacher", "student")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        return jsonify({"error": "phone is required"}), 400

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(jsonify({"error": "Too many requests. Try again later.", "retry_after": _retry_after(ip_headers)}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests.", "retry_after": _retry_after(rl_headers)}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    channel = _send_otp(phone, otp)
    resp = make_response(jsonify({"message": "OTP sent", "channel": channel, "verification_id": phone}), 200)
    for k, v in rl_headers.items():
        resp.headers[k] = v
    return resp


@auth_bp.post("/auth/terms-accept")
def auth_terms_accept():
    """Record that the teacher has accepted the current terms version. JWT required, no OTP."""
    user_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

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
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    verification_id = (body.get("verification_id") or "").strip()
    otp_code = (body.get("otp_code") or "").strip()

    if not verification_id or not otp_code:
        return jsonify({"error": "verification_id and otp_code are required"}), 400

    # Verify OTP
    otp_doc = get_doc("otp_verifications", verification_id)
    if not otp_doc:
        return jsonify({"error": "OTP not found or expired"}), 400

    attempts = otp_doc.get("attempts", 0)
    reset_ts = datetime.now(timezone.utc).timestamp() + _WINDOW
    rl_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts - 1, reset_ts)

    if attempts >= _OTP_VERIFY_LIMIT:
        delete_doc("otp_verifications", verification_id)
        resp = make_response(jsonify({"error": "Too many attempts. Request a new OTP.", "retry_after": 0}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    method = otp_doc.get("method", "self")

    if method == "verify":
        verify_sid = otp_doc.get("verify_sid")
        if not verify_sid:
            return jsonify({"error": "Verification configuration error"}), 500
        import os
        from twilio.rest import Client
        from twilio.base.exceptions import TwilioRestException
        try:
            twilio = Client(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"])
            check = twilio.verify.v2.services(verify_sid).verification_checks.create(
                to=verification_id, code=otp_code
            )
            if check.status != "approved":
                new_attempts = attempts + 1
                if new_attempts >= _OTP_VERIFY_LIMIT:
                    delete_doc("otp_verifications", verification_id)
                else:
                    upsert("otp_verifications", verification_id, {"attempts": new_attempts})
                bad_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - new_attempts, reset_ts)
                resp = make_response(jsonify({"error": "Invalid OTP"}), 400)
                for k, v in bad_headers.items():
                    resp.headers[k] = v
                return resp
        except TwilioRestException as e:
            if e.code == 20404:
                return jsonify({"error": "OTP not found or expired"}), 400
            return jsonify({"error": "Verification service error"}), 500
    else:
        if not verify_otp_hash(otp_code, otp_doc["otp_hash"]):
            new_attempts = attempts + 1
            if new_attempts >= _OTP_VERIFY_LIMIT:
                delete_doc("otp_verifications", verification_id)
            else:
                upsert("otp_verifications", verification_id, {"attempts": new_attempts})
            bad_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - new_attempts, reset_ts)
            resp = make_response(jsonify({"error": "Invalid OTP"}), 400)
            for k, v in bad_headers.items():
                resp.headers[k] = v
            return resp

    delete_doc("otp_verifications", verification_id)

    teacher = get_doc("teachers", user_id)
    if not teacher:
        return jsonify({"error": "Teacher not found"}), 404

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
            return jsonify({"error": "Phone number already registered to another account"}), 409
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
        return jsonify({"error": "join_code is required"}), 400

    # Normalize: uppercase, strip whitespace — join codes are always stored uppercase
    code = raw_code.upper()
    logger.info("[auth] student/lookup normalised join_code=%s", code)

    cls = query_single("classes", [("join_code", "==", code)])
    if not cls:
        logger.info("[auth] student/lookup no class found for join_code=%s", code)
        return jsonify({"error": "No class found. Check the code and try again."}), 404

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

    if not first_name or not surname or not phone:
        return jsonify({"error": "first_name, surname, and phone are required"}), 400
    if not class_id and not class_join_code and not manual_class_name:
        return jsonify({"error": "class_id, class_join_code, or manual_class_name is required"}), 400

    # Resolve join code → class_id if not already provided
    if class_join_code and not class_id:
        cls = query_single("classes", [("join_code", "==", class_join_code)])
        if cls:
            class_id = cls["id"]
            logger.info("[auth] student/register resolved join_code=%s to class_id=%s", class_join_code, class_id)

    # Reject duplicate phone (student already exists)
    if query_single("students", [("phone", "==", phone)]):
        return jsonify({"error": "Phone already registered"}), 409

    # IP rate limit
    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(
            jsonify({"error": "Too many requests. Try again later.", "retry_after": _retry_after(ip_headers)}),
            429,
        )
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone, pending_data={
        "role": "student",
        "first_name": first_name,
        "surname": surname,
        "phone": phone,
        "class_id": class_id,
        "manual_class_name": manual_class_name,
    })
    if otp is None:
        resp = make_response(
            jsonify({"error": "Too many OTP requests.", "retry_after": _retry_after(rl_headers)}),
            429,
        )
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

    channel = _send_otp(phone, otp)
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
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    updates: dict = {}

    first_name = (body.get("first_name") or "").strip()
    surname = (body.get("surname") or "").strip()
    if first_name:
        updates["first_name"] = first_name
    if surname:
        updates["surname"] = surname

    if not updates:
        return jsonify({"error": "No valid fields to update"}), 400

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
        return jsonify({"error": err}), 401
    if caller_id != student_id:
        return jsonify({"error": "Forbidden"}), 403

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

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
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    join_code = (body.get("join_code") or "").strip().upper()
    class_id = (body.get("class_id") or "").strip()

    if not join_code and not class_id:
        return jsonify({"error": "join_code or class_id is required"}), 400

    cls = None
    if class_id:
        cls = get_doc("classes", class_id)
    if not cls and join_code:
        cls = query_single("classes", [("join_code", "==", join_code)])
    if not cls:
        return jsonify({"error": "Class not found. Check with your teacher."}), 404

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

    existing_ids: list[str] = student.get("class_ids", [])
    # Backfill: if student has a single class_id but no class_ids list yet
    if not existing_ids and student.get("class_id"):
        existing_ids = [student["class_id"]]

    if cls["id"] in existing_ids:
        return jsonify({"error": f"You are already enrolled in {cls.get('name', 'this class')}."}), 409

    new_ids = list(set(existing_ids + [cls["id"]]))
    upsert("students", student_id, {"class_ids": new_ids, "class_id": cls["id"]})

    # Bump student count on the class
    upsert("classes", cls["id"], {"student_count": cls.get("student_count", 0) + 1})

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
        return jsonify({"error": err}), 401

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

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
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    class_id = (body.get("class_id") or "").strip()
    if not class_id:
        return jsonify({"error": "class_id is required"}), 400

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

    class_ids: list[str] = student.get("class_ids", [])
    if not class_ids and student.get("class_id"):
        class_ids = [student["class_id"]]

    if class_id not in class_ids:
        return jsonify({"error": "You are not enrolled in this class"}), 404

    new_ids = [c for c in class_ids if c != class_id]
    new_active = new_ids[0] if new_ids else None
    upsert("students", student_id, {"class_ids": new_ids, "class_id": new_active})

    # Decrement student count on the class
    cls = get_doc("classes", class_id)
    if cls:
        upsert("classes", class_id, {"student_count": max(0, cls.get("student_count", 1) - 1)})

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
