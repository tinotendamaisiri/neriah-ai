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
    require_auth,
    require_role,
    verify_otp_hash,
    verify_pin,
)
from shared.firestore_client import delete_doc, get_doc, query_single, upsert
from shared.models import Teacher
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
        resp = make_response(jsonify({"error": "Too many requests. Try again later."}), 429)
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
        resp = make_response(jsonify({"error": "Too many OTP requests. Try again in 10 minutes."}), 429)
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
        resp = make_response(jsonify({"error": "Too many requests. Try again later."}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    if not query_single("teachers", [("phone", "==", phone)]):
        return jsonify({"error": "Phone not registered"}), 404

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests. Try again in 10 minutes."}), 429)
        for k, v in rl_headers.items():
            resp.headers[k] = v
        return resp

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

    if not phone or not otp:
        return jsonify({"error": "verification_id and otp_code are required"}), 400

    otp_doc = get_doc("otp_verifications", phone)
    if not otp_doc:
        return jsonify({"error": "OTP not found or expired"}), 400

    attempts = otp_doc.get("attempts", 0)
    reset_ts = datetime.now(timezone.utc).timestamp() + _WINDOW
    rl_headers = _rl_headers(_OTP_VERIFY_LIMIT, _OTP_VERIFY_LIMIT - attempts - 1, reset_ts)

    if attempts >= _OTP_VERIFY_LIMIT:
        delete_doc("otp_verifications", phone)
        resp = make_response(jsonify({"error": "Too many attempts. Request a new OTP."}), 429)
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

    if pending_data:
        # Registration flow: create teacher now that OTP is confirmed
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
        # Login flow: teacher must already exist
        teacher_doc = query_single("teachers", [("phone", "==", phone)])
        if not teacher_doc:
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
        resp = make_response(jsonify({"error": "Too many requests. Try again later."}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests. Try again in 10 minutes."}), 429)
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
    user_id, role, err = require_auth(request)
    if err:
        return jsonify({"error": err}), 401

    doc = get_doc("teachers", user_id)
    if not doc:
        return jsonify({"error": "Not found"}), 404

    return jsonify(_safe(doc)), 200


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
        resp = make_response(jsonify({"error": "Too many requests. Try again later."}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests. Try again in 10 minutes."}), 429)
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
    user_id, _, err = require_auth(request)
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
    user_id, _, err = require_auth(request)
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
    user_id, _, err = require_auth(request)
    if err:
        return jsonify({"error": err}), 401

    upsert("teachers", user_id, {"pin_hash": None, "pin_attempts": 0, "pin_locked": False})
    return jsonify({"message": "PIN removed"}), 200


# ─── Profile update ───────────────────────────────────────────────────────────

@auth_bp.post("/auth/profile/request-otp")
def auth_profile_request_otp():
    """Send OTP to a phone number for profile update verification. Requires valid JWT."""
    user_id, _, err = require_auth(request)
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        return jsonify({"error": "phone is required"}), 400

    ip = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    ip_blocked, ip_headers = _check_ip_rate_limit(ip)
    if ip_blocked:
        resp = make_response(jsonify({"error": "Too many requests. Try again later."}), 429)
        for k, v in ip_headers.items():
            resp.headers[k] = v
        return resp

    otp, rl_headers = _store_otp(phone)
    if otp is None:
        resp = make_response(jsonify({"error": "Too many OTP requests. Try again in 10 minutes."}), 429)
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
    user_id, _, err = require_auth(request)
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
    user_id, _, err = require_auth(request)
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
        resp = make_response(jsonify({"error": "Too many attempts. Request a new OTP."}), 429)
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
