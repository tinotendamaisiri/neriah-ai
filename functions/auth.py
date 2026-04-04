"""Auth endpoints — register, login, verify OTP, me, recover, PIN management."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

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

logger = logging.getLogger(__name__)
auth_bp = Blueprint("auth", __name__)


def _send_otp(phone: str, otp: str) -> None:
    """Send OTP via WhatsApp or SMS. Falls back to logging in dev."""
    import os
    if os.getenv("ENVIRONMENT", "dev") == "dev":
        logger.info("DEV OTP for %s: %s", phone, otp)
        return
    # Production: integrate WhatsApp or SMS here
    logger.info("OTP dispatched for %s", phone)


def _store_otp(phone: str) -> str:
    otp = generate_otp()
    upsert("otp_verifications", phone, {
        "id": phone,
        "phone": phone,
        "otp_hash": hash_otp(otp),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return otp


# ─── Register ─────────────────────────────────────────────────────────────────

@auth_bp.post("/auth/register")
def auth_register():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    name = (body.get("name") or "").strip()
    school_name = (body.get("school_name") or "").strip() or None

    if not phone or not name:
        return jsonify({"error": "phone and name are required"}), 400

    if query_single("teachers", [("phone", "==", phone)]):
        return jsonify({"error": "Phone already registered"}), 409

    teacher = Teacher(phone=phone, name=name, school_name=school_name)
    upsert("teachers", teacher.id, teacher.model_dump())

    otp = _store_otp(phone)
    _send_otp(phone, otp)

    return jsonify({"message": "OTP sent", "channel": "sms"}), 201


# ─── Login ────────────────────────────────────────────────────────────────────

@auth_bp.post("/auth/login")
def auth_login():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()

    if not phone:
        return jsonify({"error": "phone is required"}), 400

    if not query_single("teachers", [("phone", "==", phone)]):
        return jsonify({"error": "Phone not registered"}), 404

    otp = _store_otp(phone)
    _send_otp(phone, otp)

    return jsonify({"message": "OTP sent", "channel": "sms"}), 200


# ─── Verify OTP ───────────────────────────────────────────────────────────────

@auth_bp.post("/auth/verify")
def auth_verify():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    otp = (body.get("otp") or "").strip()

    if not phone or not otp:
        return jsonify({"error": "phone and otp are required"}), 400

    otp_doc = get_doc("otp_verifications", phone)
    if not otp_doc:
        return jsonify({"error": "OTP not found or expired"}), 400

    if otp_doc.get("attempts", 0) >= 5:
        return jsonify({"error": "Too many attempts. Request a new OTP."}), 429

    if not verify_otp_hash(otp, otp_doc["otp_hash"]):
        upsert("otp_verifications", phone, {"attempts": otp_doc.get("attempts", 0) + 1})
        return jsonify({"error": "Invalid OTP"}), 400

    delete_doc("otp_verifications", phone)

    teacher = query_single("teachers", [("phone", "==", phone)])
    if not teacher:
        return jsonify({"error": "Account not found"}), 404

    token = create_jwt(teacher["id"], "teacher", teacher.get("token_version", 0))
    return jsonify({"token": token, "user": _safe(teacher)}), 200


# ─── Resend OTP ───────────────────────────────────────────────────────────────

@auth_bp.post("/auth/resend-otp")
def auth_resend_otp():
    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()

    if not phone:
        return jsonify({"error": "phone is required"}), 400

    otp = _store_otp(phone)
    _send_otp(phone, otp)
    return jsonify({"message": "OTP resent", "channel": "sms"}), 200


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

    otp = _store_otp(phone)
    _send_otp(phone, otp)
    return jsonify({"message": "Recovery OTP sent"}), 200


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


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _safe(teacher: dict) -> dict:
    """Strip sensitive fields before returning to client."""
    return {k: v for k, v in teacher.items() if k not in ("pin_hash",)}
