# functions/auth.py
# Auth endpoints for the Neriah mobile app.
#
# POST /api/auth/register     — teacher registration: validate fields, send OTP
# POST /api/auth/login        — login (teacher or student): send OTP
# POST /api/auth/verify       — verify OTP, receive JWT + user object
# POST /api/auth/resend-otp   — resend OTP (with optional channel_preference)
# GET  /api/auth/me           — return current user from JWT (with token_version check)
# POST /api/auth/recover      — account recovery: send OTP, invalidates all old sessions on verify
# POST /api/auth/pin/set      — store bcrypt-hashed PIN on user document
# POST /api/auth/pin/verify   — verify PIN (locks after 5 wrong attempts)
# DELETE /api/auth/pin        — remove PIN from user document

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta

import azure.functions as func
import bcrypt

from shared.auth import (
    create_jwt,
    generate_otp,
    get_user_from_request,
    hash_otp,
    verify_otp_hash,
)
from shared.cosmos_client import (
    delete_item,
    get_item,
    get_teacher_by_phone,
    query_items,
    upsert_item,
)
from shared.config import get_settings
from shared.models import EducationLevel, OTPVerification, Student, Teacher
from shared.sms_client import send_otp

logger = logging.getLogger(__name__)

# ── E.164 phone validation ────────────────────────────────────────────────────

_PHONE_RE = re.compile(r'^\+[1-9]\d{9,14}$')


def _is_valid_phone(phone: str) -> bool:
    return bool(_PHONE_RE.fullmatch(phone))


# ── Rate-limit helper ─────────────────────────────────────────────────────────

async def _count_recent_otps(phone: str) -> int:
    one_hour_ago = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    results = await query_items(
        container_name="otp_verifications",
        query="SELECT c.id FROM c WHERE c.phone = @phone AND c.created_at >= @since",
        parameters=[
            {"name": "@phone", "value": phone},
            {"name": "@since", "value": one_hour_ago},
        ],
        partition_key=phone,
    )
    return len(results)


# ── Token version check (auth endpoints only) ─────────────────────────────────

async def _get_verified_user(payload: dict) -> dict | None:
    """Fetch user from Cosmos and verify token_version matches the JWT claim.

    Returns the user document if valid, None if not found or version mismatch.
    """
    role = payload.get("role", "")
    phone = payload.get("phone", "")
    user_id = payload.get("id", "")
    token_ver = payload.get("token_version", 1)
    user_doc = None

    if role == "teacher":
        user_doc = await get_teacher_by_phone(phone)
    elif role == "student":
        class_id = payload.get("class_id")
        if class_id and user_id:
            try:
                user_doc = await get_item("students", user_id, class_id)
            except Exception:
                pass
        if not user_doc:
            sr = await query_items(
                "students",
                "SELECT * FROM c WHERE c.id = @id",
                [{"name": "@id", "value": user_id}],
            )
            user_doc = sr[0] if sr else None

    if not user_doc:
        return None
    if user_doc.get("token_version", 1) != token_ver:
        return None
    return user_doc


# ── JSON helpers ──────────────────────────────────────────────────────────────

def _ok(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(json.dumps(body), status_code=status, mimetype="application/json")


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"error": message}), status_code=status, mimetype="application/json")


def _masked(phone: str) -> str:
    return phone[:-3].replace(phone[1:-3], "*" * (len(phone) - 4)) + phone[-3:]


# ── OTP dispatch helper ───────────────────────────────────────────────────────

async def _send_otp_and_store(
    phone: str,
    role: str,
    purpose: str,
    pending_data: dict,
    channel_preference: str = "whatsapp",
) -> tuple[OTPVerification, str]:
    """Generate OTP, send it, persist the verification doc.

    For US numbers via Twilio Verify, Twilio owns the OTP code — the hash we
    store is never used for verification (otp_method="verify" branches to
    Twilio's verification_checks API in handle_auth_verify instead).

    Returns (otp_doc, channel_used).
    Raises Exception (propagates from send_otp) if all configured channels fail.
    """
    raw_otp = generate_otp()
    hashed = hash_otp(raw_otp)

    channel_used, method_info = await send_otp(phone, raw_otp, channel_preference)

    # Only log the OTP when we manage it ourselves — Verify's code is on the user's phone
    if method_info["method"] == "self":
        logger.warning("[DEV] OTP for ...%s: %s", phone[-4:], raw_otp)
    else:
        logger.info("[DEV] OTP managed by Twilio Verify for ...%s — check SMS on device", phone[-4:])

    now = datetime.utcnow()
    otp_doc = OTPVerification(
        phone=phone,
        otp_code=hashed,
        role=role,
        purpose=purpose,
        channel_preference=channel_preference,
        channel_used=channel_used,
        otp_method=method_info["method"],
        verify_sid=method_info.get("verify_sid"),
        pending_data=pending_data,
        created_at=now,
        expires_at=now + timedelta(minutes=5),
    )
    await upsert_item("otp_verifications", otp_doc.model_dump(mode="json"))
    return otp_doc, channel_used


# ── POST /api/auth/register ───────────────────────────────────────────────────

async def handle_auth_register(req: func.HttpRequest) -> func.HttpResponse:
    """Register a new teacher: validate → check duplicate → rate-limit → send OTP.

    Request body:
        {
          "first_name": "Tino",
          "surname": "Maisiri",
          "phone": "+263771234567",
          "school": "Harare Primary",
          "education_level": "grade_7",
          "role": "teacher",
          "channel_preference": "whatsapp"   ← optional, default "whatsapp"
        }

    Response 200:
        { "verification_id": "<uuid>", "message": "OTP sent to +263...567", "channel": "sms" }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    required = ["first_name", "surname", "phone"]
    missing = [f for f in required if not body.get(f)]
    if missing:
        return _err(f"Missing required fields: {missing}")

    phone: str = body["phone"].strip()
    if not _is_valid_phone(phone):
        return _err("phone must be in E.164 format, e.g. +263771234567")

    existing_teacher = await get_teacher_by_phone(phone)
    if existing_teacher:
        return _err("Phone already registered. Please login instead.", status=409)

    recent_count = await _count_recent_otps(phone)
    if recent_count >= 5:
        return _err("Too many verification attempts. Please wait before trying again.", status=429)

    channel_preference: str = body.get("channel_preference", "whatsapp")

    # ── School resolution ─────────────────────────────────────────────────────
    # Accepts school_id (from picker), school_name (unlisted fallback), or
    # legacy school (free text from old clients).
    pending_school: str = ""
    pending_school_id: str | None = None

    school_id_raw: str | None = body.get("school_id")
    school_name_raw: str | None = body.get("school_name")

    if school_id_raw:
        school_docs = await query_items(
            "schools",
            "SELECT c.id, c.name FROM c WHERE c.id = @id",
            [{"name": "@id", "value": school_id_raw}],
            partition_key=school_id_raw,
        )
        if not school_docs:
            return _err("School not found.", status=404)
        pending_school = school_docs[0]["name"]
        pending_school_id = school_id_raw
    elif school_name_raw:
        pending_school = school_name_raw.strip()
    else:
        pending_school = body.get("school", "").strip()  # legacy free-text field

    try:
        otp_doc, channel_used = await _send_otp_and_store(
            phone=phone,
            role="teacher",
            purpose="register",
            pending_data={
                "first_name": body["first_name"].strip(),
                "surname": body["surname"].strip(),
                "school": pending_school,
                "school_id": pending_school_id,
                "education_level": body.get("education_level", ""),
            },
            channel_preference=channel_preference,
        )
    except Exception as exc:
        return _err(str(exc), status=503)

    return _ok({
        "verification_id": otp_doc.id,
        "message": f"OTP sent to {_masked(phone)}",
        "channel": channel_used,
    })


# ── POST /api/auth/login ──────────────────────────────────────────────────────

async def handle_auth_login(req: func.HttpRequest) -> func.HttpResponse:
    """Request an OTP to log in as an existing teacher or student.

    Request body:
        { "phone": "+263771234567", "channel_preference": "whatsapp" }

    Response 200:
        { "verification_id": "<uuid>", "role": "teacher"|"student", "message": "...", "channel": "sms" }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    phone: str = (body.get("phone") or "").strip()
    if not _is_valid_phone(phone):
        return _err("phone must be in E.164 format, e.g. +263771234567")

    role: str | None = None
    user_doc: dict | None = None

    teacher_doc = await get_teacher_by_phone(phone)
    if teacher_doc:
        role = "teacher"
        user_doc = teacher_doc
    else:
        student_results = await query_items(
            container_name="students",
            query="SELECT * FROM c WHERE c.phone = @phone",
            parameters=[{"name": "@phone", "value": phone}],
        )
        if student_results:
            role = "student"
            user_doc = student_results[0]

    if not user_doc:
        return _err("No account found for this number. Please register first.", status=404)

    recent_count = await _count_recent_otps(phone)
    if recent_count >= 5:
        return _err("Too many verification attempts. Please wait before trying again.", status=429)

    pending: dict = {"user_id": user_doc["id"]}
    if role == "student":
        pending["class_id"] = user_doc.get("class_id")

    channel_preference: str = body.get("channel_preference", "whatsapp")

    try:
        otp_doc, channel_used = await _send_otp_and_store(
            phone=phone,
            role=role,
            purpose="login",
            pending_data=pending,
            channel_preference=channel_preference,
        )
    except Exception as exc:
        return _err(str(exc), status=503)

    return _ok({
        "verification_id": otp_doc.id,
        "role": role,
        "message": f"OTP sent to {_masked(phone)}",
        "channel": channel_used,
    })


# ── POST /api/auth/verify ─────────────────────────────────────────────────────

async def handle_auth_verify(req: func.HttpRequest) -> func.HttpResponse:
    """Verify an OTP code and receive a JWT + user object.

    Request body:
        { "verification_id": "<uuid>", "otp_code": "123456" }

    Response 200:
        { "token": "<jwt>", "user": { id, first_name, surname, phone, role, ... } }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    verification_id: str = (body.get("verification_id") or "").strip()
    provided_otp: str = (body.get("otp_code") or "").strip()

    if not verification_id or not provided_otp:
        return _err("verification_id and otp_code are required")

    results = await query_items(
        container_name="otp_verifications",
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": verification_id}],
    )
    if not results:
        return _err("Verification code not found or already used.", status=410)

    otp_doc: dict = results[0]

    now_str = datetime.utcnow().isoformat()
    if now_str > otp_doc.get("expires_at", ""):
        return _err("Verification code has expired. Please request a new one.", status=410)

    attempts: int = otp_doc.get("attempts", 0)
    if attempts >= 3:
        return _err("Too many incorrect attempts. Please request a new code.", status=429)

    # Extract phone early — needed by both verify paths below
    phone: str = otp_doc["phone"]
    otp_method: str = otp_doc.get("otp_method", "self")

    if otp_method == "verify":
        # ── Twilio Verify owns this OTP — validate via their API ──────────────
        import os as _os  # noqa: PLC0415
        from twilio.rest import Client as _TwilioClient  # noqa: PLC0415
        from twilio.base.exceptions import TwilioRestException as _TwilioError  # noqa: PLC0415

        try:
            _client = _TwilioClient(
                _os.environ.get("TWILIO_ACCOUNT_SID", ""),
                _os.environ.get("TWILIO_AUTH_TOKEN", ""),
            )
            _check = _client.verify.v2.services(otp_doc.get("verify_sid", "")).verification_checks.create(
                to=phone,
                code=provided_otp,
            )
            if _check.status != "approved":
                otp_doc["attempts"] = attempts + 1
                await upsert_item("otp_verifications", otp_doc)
                remaining = max(0, 3 - otp_doc["attempts"])
                return _err(
                    f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
                    status=400,
                )
        except _TwilioError as exc:
            if exc.code == 20404:
                return _err("Verification code not found or already used.", status=410)
            logger.error("Twilio Verify check failed: code=%s msg=%s", exc.code, exc.msg)
            return _err("Could not verify code. Please try again.", status=500)
    else:
        # ── Self-managed OTP — verify hash stored in Cosmos ───────────────────
        if not verify_otp_hash(provided_otp, otp_doc["otp_code"]):
            otp_doc["attempts"] = attempts + 1
            await upsert_item("otp_verifications", otp_doc)
            remaining = 3 - otp_doc["attempts"]
            return _err(
                f"Incorrect code. {remaining} attempt{'s' if remaining != 1 else ''} remaining.",
                status=400,
            )

    try:
        await delete_item("otp_verifications", otp_doc["id"], otp_doc["phone"])
    except Exception as exc:
        logger.warning("Could not delete OTP doc %s: %s", otp_doc["id"], exc)

    role: str = otp_doc["role"]
    purpose: str = otp_doc["purpose"]
    pending: dict = otp_doc.get("pending_data") or {}
    # phone already extracted above for OTP verification

    if purpose == "register":
        # ── Teacher registration ───────────────────────────────────────────────
        education_level_str = pending.get("education_level", "")
        ed_levels: list[EducationLevel] = []
        if education_level_str:
            try:
                ed_levels = [EducationLevel(education_level_str)]
            except ValueError:
                pass

        teacher = Teacher(
            phone=phone,
            first_name=pending.get("first_name", ""),
            surname=pending.get("surname", ""),
            school=pending.get("school") or None,
            school_id=pending.get("school_id") or None,
            education_levels_active=ed_levels,
            token_version=1,
        )
        await upsert_item("teachers", teacher.model_dump(mode="json"))

        token = create_jwt(
            teacher.id, phone, "teacher",
            extra_claims={
                "first_name": teacher.first_name,
                "surname": teacher.surname,
                "token_version": 1,
                "school": teacher.school,
            },
        )
        return _ok({"token": token, "user": {
            "id": teacher.id,
            "first_name": teacher.first_name,
            "surname": teacher.surname,
            "phone": teacher.phone,
            "role": "teacher",
            "school": teacher.school,
        }})

    elif purpose == "activate":
        # ── Student activating a pre-created account ──────────────────────────
        student_id: str = pending.get("student_id", "")
        class_id: str | None = pending.get("class_id")
        student_doc = None
        if class_id and student_id:
            try:
                student_doc = await get_item("students", student_id, class_id)
            except Exception:
                pass
        if not student_doc:
            sr = await query_items(
                "students",
                "SELECT * FROM c WHERE c.id = @id",
                [{"name": "@id", "value": student_id}],
            )
            student_doc = sr[0] if sr else None
        if not student_doc:
            return _err("Student account not found.", status=404)

        token_ver = student_doc.get("token_version", 1)
        token = create_jwt(
            student_doc["id"], phone, "student",
            extra_claims={
                "first_name": student_doc.get("first_name", ""),
                "surname": student_doc.get("surname", ""),
                "token_version": token_ver,
                "class_id": student_doc.get("class_id"),
            },
        )
        return _ok({"token": token, "user": {
            "id": student_doc["id"],
            "first_name": student_doc.get("first_name", ""),
            "surname": student_doc.get("surname", ""),
            "phone": student_doc.get("phone"),
            "role": "student",
            "class_id": student_doc.get("class_id"),
        }})

    elif purpose == "student_register":
        # ── Student self-registration via join code ────────────────────────────
        new_class_id: str = pending.get("class_id", "")
        teacher_id_for_class: str = pending.get("teacher_id", "")

        student = Student(
            class_id=new_class_id,
            first_name=pending.get("first_name", ""),
            surname=pending.get("surname", ""),
            phone=phone,
            token_version=1,
        )
        await upsert_item("students", student.model_dump(mode="json"))

        if new_class_id and teacher_id_for_class:
            try:
                class_results = await query_items(
                    "classes",
                    "SELECT * FROM c WHERE c.id = @id",
                    [{"name": "@id", "value": new_class_id}],
                    partition_key=teacher_id_for_class,
                )
                if class_results:
                    class_doc = class_results[0]
                    ids: list = class_doc.get("student_ids", [])
                    if student.id not in ids:
                        class_doc["student_ids"] = ids + [student.id]
                        await upsert_item("classes", class_doc)
            except Exception as exc:
                logger.warning("student_register: could not update class.student_ids: %s", exc)

        token = create_jwt(
            student.id, phone, "student",
            extra_claims={
                "first_name": student.first_name,
                "surname": student.surname,
                "token_version": 1,
                "class_id": new_class_id,
            },
        )
        return _ok({"token": token, "user": {
            "id": student.id,
            "first_name": student.first_name,
            "surname": student.surname,
            "phone": phone,
            "role": "student",
            "class_id": new_class_id,
        }})

    elif purpose == "account_recovery":
        # ── Account recovery — increment token_version to invalidate all old sessions ──
        if role == "teacher":
            user_doc = await get_teacher_by_phone(phone)
        else:
            user_id_r: str = pending.get("user_id", "")
            class_id_r: str | None = pending.get("class_id")
            user_doc = None
            if class_id_r and user_id_r:
                try:
                    user_doc = await get_item("students", user_id_r, class_id_r)
                except Exception:
                    pass
            if not user_doc:
                sr = await query_items(
                    "students",
                    "SELECT * FROM c WHERE c.id = @id",
                    [{"name": "@id", "value": user_id_r}],
                )
                user_doc = sr[0] if sr else None

        if not user_doc:
            return _err("Account not found.", status=404)

        new_version: int = user_doc.get("token_version", 1) + 1
        user_doc["token_version"] = new_version
        user_doc["pin_hash"] = None
        user_doc["pin_locked"] = False
        container = "teachers" if role == "teacher" else "students"
        await upsert_item(container, user_doc)

        extra: dict = {
            "first_name": user_doc.get("first_name", ""),
            "surname": user_doc.get("surname", ""),
            "token_version": new_version,
        }
        if role == "teacher":
            extra["school"] = user_doc.get("school")
        else:
            extra["class_id"] = user_doc.get("class_id")

        token = create_jwt(user_doc["id"], phone, role, extra_claims=extra)
        return _ok({"token": token, "user": {
            "id": user_doc["id"],
            "first_name": user_doc.get("first_name", ""),
            "surname": user_doc.get("surname", ""),
            "phone": user_doc.get("phone", phone),
            "role": role,
            **({"school": user_doc.get("school")} if role == "teacher" else {"class_id": user_doc.get("class_id")}),
        }})

    else:  # purpose == "login"
        # ── Login (teacher or student) ─────────────────────────────────────────
        user_id_l: str = pending.get("user_id", "")

        if role == "teacher":
            user_doc = await get_teacher_by_phone(phone)
            if not user_doc:
                return _err("Account not found.", status=404)
            token_ver = user_doc.get("token_version", 1)
            token = create_jwt(
                user_doc["id"], phone, "teacher",
                extra_claims={
                    "first_name": user_doc.get("first_name", ""),
                    "surname": user_doc.get("surname", ""),
                    "token_version": token_ver,
                    "school": user_doc.get("school"),
                },
            )
            return _ok({"token": token, "user": {
                "id": user_doc["id"],
                "first_name": user_doc.get("first_name", ""),
                "surname": user_doc.get("surname", ""),
                "phone": user_doc.get("phone", phone),
                "role": "teacher",
                "school": user_doc.get("school"),
            }})

        else:  # student login
            login_class_id: str | None = pending.get("class_id")
            login_user_doc = None
            if login_class_id and user_id_l:
                try:
                    login_user_doc = await get_item("students", user_id_l, login_class_id)
                except Exception:
                    pass
            if not login_user_doc:
                sr = await query_items(
                    "students",
                    "SELECT * FROM c WHERE c.id = @id",
                    [{"name": "@id", "value": user_id_l}],
                )
                login_user_doc = sr[0] if sr else None

            if not login_user_doc:
                return _err("Account not found.", status=404)

            token_ver = login_user_doc.get("token_version", 1)
            token = create_jwt(
                login_user_doc["id"], phone, "student",
                extra_claims={
                    "first_name": login_user_doc.get("first_name", ""),
                    "surname": login_user_doc.get("surname", ""),
                    "token_version": token_ver,
                    "class_id": login_user_doc.get("class_id"),
                },
            )
            return _ok({"token": token, "user": {
                "id": login_user_doc["id"],
                "first_name": login_user_doc.get("first_name", ""),
                "surname": login_user_doc.get("surname", ""),
                "phone": login_user_doc.get("phone"),
                "role": "student",
                "class_id": login_user_doc.get("class_id"),
            }})


# ── POST /api/auth/resend-otp ─────────────────────────────────────────────────

async def handle_auth_resend_otp(req: func.HttpRequest) -> func.HttpResponse:
    """Resend a new OTP, optionally switching delivery channel.

    Request body:
        { "verification_id": "<uuid>", "channel_preference": "sms" }

    Response 200:
        { "verification_id": "<new_uuid>", "message": "New code sent to ...", "channel": "sms" }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    verification_id: str = (body.get("verification_id") or "").strip()
    if not verification_id:
        return _err("verification_id is required")

    results = await query_items(
        container_name="otp_verifications",
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": verification_id}],
    )
    if not results:
        return _err("Verification not found or already expired.", status=404)

    original: dict = results[0]
    phone: str = original["phone"]

    recent_count = await _count_recent_otps(phone)
    if recent_count >= 5:
        return _err("Too many verification attempts. Please wait before trying again.", status=429)

    try:
        await delete_item("otp_verifications", original["id"], phone)
    except Exception as exc:
        logger.warning("Could not delete old OTP doc %s: %s", original["id"], exc)

    # Allow switching channel on resend
    channel_preference: str = body.get("channel_preference") or original.get("channel_preference", "whatsapp")

    try:
        new_otp_doc, channel_used = await _send_otp_and_store(
            phone=phone,
            role=original["role"],
            purpose=original["purpose"],
            pending_data=original.get("pending_data") or {},
            channel_preference=channel_preference,
        )
    except Exception as exc:
        return _err(str(exc), status=503)

    return _ok({
        "verification_id": new_otp_doc.id,
        "message": f"New code sent to {_masked(phone)}",
        "channel": channel_used,
    })


# ── GET /api/auth/me ──────────────────────────────────────────────────────────

async def handle_auth_me(req: func.HttpRequest) -> func.HttpResponse:
    """Return current user's profile. Validates token_version against Cosmos.

    Requires: Authorization: Bearer <jwt>
    Response 200: { user object }
    """
    payload = get_user_from_request(req)
    if payload is None:
        return _err("Authentication required.", status=401)

    user_doc = await _get_verified_user(payload)
    if user_doc is None:
        return _err("Session expired. Please log in again.", status=401)

    role: str = payload.get("role", "")

    if role == "teacher":
        return _ok({
            "id": user_doc["id"],
            "first_name": user_doc.get("first_name", ""),
            "surname": user_doc.get("surname", ""),
            "phone": user_doc.get("phone", ""),
            "role": "teacher",
            "school": user_doc.get("school"),
            "email": user_doc.get("email"),
            "subscription_status": user_doc.get("subscription_status", "trial"),
            "pin_set": bool(user_doc.get("pin_hash")),
        })

    elif role == "student":
        return _ok({
            "id": user_doc["id"],
            "first_name": user_doc.get("first_name", ""),
            "surname": user_doc.get("surname", ""),
            "phone": user_doc.get("phone"),
            "role": "student",
            "class_id": user_doc.get("class_id"),
            "register_number": user_doc.get("register_number"),
            "pin_set": bool(user_doc.get("pin_hash")),
        })

    return _err("Unknown role in token.", status=400)


# ── POST /api/auth/recover ────────────────────────────────────────────────────

async def handle_auth_recover(req: func.HttpRequest) -> func.HttpResponse:
    """Account recovery: sends OTP. On verify, increments token_version (invalidates all sessions).

    Request body:
        { "phone": "+263771234567", "channel_preference": "whatsapp" }

    Response 200:
        { "verification_id": "uuid", "role": "teacher"|"student", "message": "...", "channel": "sms" }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    phone: str = (body.get("phone") or "").strip()
    if not _is_valid_phone(phone):
        return _err("phone must be in E.164 format, e.g. +263771234567")

    # Find user — teacher first, then student
    role: str | None = None
    user_doc: dict | None = None

    teacher_doc = await get_teacher_by_phone(phone)
    if teacher_doc:
        role = "teacher"
        user_doc = teacher_doc
    else:
        student_results = await query_items(
            container_name="students",
            query="SELECT * FROM c WHERE c.phone = @phone",
            parameters=[{"name": "@phone", "value": phone}],
        )
        if student_results:
            role = "student"
            user_doc = student_results[0]

    if not user_doc:
        return _err("No account found with this phone number.", status=404)

    recent_count = await _count_recent_otps(phone)
    if recent_count >= 5:
        return _err("Too many verification attempts. Please wait before trying again.", status=429)

    pending: dict = {"user_id": user_doc["id"]}
    if role == "student":
        pending["class_id"] = user_doc.get("class_id")

    channel_preference: str = body.get("channel_preference", "whatsapp")

    try:
        otp_doc, channel_used = await _send_otp_and_store(
            phone=phone,
            role=role,
            purpose="account_recovery",
            pending_data=pending,
            channel_preference=channel_preference,
        )
    except Exception as exc:
        return _err(str(exc), status=503)

    return _ok({
        "verification_id": otp_doc.id,
        "role": role,
        "message": f"Recovery code sent to {_masked(phone)}",
        "channel": channel_used,
    })


# ── POST /api/auth/pin/set ────────────────────────────────────────────────────

async def handle_auth_pin_set(req: func.HttpRequest) -> func.HttpResponse:
    """Set or update a 4-digit PIN on the authenticated user's account.

    Request body: { "pin": "1234" }
    Requires: Authorization: Bearer <jwt>
    Response 200: { "success": true }
    """
    payload = get_user_from_request(req)
    if payload is None:
        return _err("Authentication required.", status=401)

    user_doc = await _get_verified_user(payload)
    if user_doc is None:
        return _err("Session expired. Please log in again.", status=401)

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    pin: str = str(body.get("pin", "")).strip()
    if not re.fullmatch(r'\d{4}', pin):
        return _err("PIN must be exactly 4 digits.")

    pin_hash = bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()
    user_doc["pin_hash"] = pin_hash
    user_doc["pin_locked"] = False

    container = "teachers" if payload.get("role") == "teacher" else "students"
    await upsert_item(container, user_doc)

    return _ok({"success": True})


# ── POST /api/auth/pin/verify ─────────────────────────────────────────────────

async def handle_auth_pin_verify(req: func.HttpRequest) -> func.HttpResponse:
    """Verify the user's PIN. Locks after 5 wrong attempts (forces OTP recovery).

    Request body: { "pin": "1234" }
    Requires: Authorization: Bearer <jwt>
    Response 200: { "valid": true } or { "valid": false, "locked": false, "attempts_remaining": N }
    """
    payload = get_user_from_request(req)
    if payload is None:
        return _err("Authentication required.", status=401)

    user_doc = await _get_verified_user(payload)
    if user_doc is None:
        return _err("Session expired. Please log in again.", status=401)

    if user_doc.get("pin_locked"):
        return _err("PIN locked due to too many incorrect attempts. Please use account recovery.", status=423)

    if not user_doc.get("pin_hash"):
        return _err("No PIN is set on this account.", status=404)

    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    pin: str = str(body.get("pin", "")).strip()

    # Count wrong PIN attempts (stored on user doc)
    wrong_attempts: int = user_doc.get("pin_wrong_attempts", 0)

    if bcrypt.checkpw(pin.encode(), user_doc["pin_hash"].encode()):
        # Correct — reset attempt counter
        if wrong_attempts:
            user_doc["pin_wrong_attempts"] = 0
            container = "teachers" if payload.get("role") == "teacher" else "students"
            await upsert_item(container, user_doc)
        return _ok({"valid": True})

    # Wrong PIN
    wrong_attempts += 1
    user_doc["pin_wrong_attempts"] = wrong_attempts

    if wrong_attempts >= 5:
        user_doc["pin_locked"] = True
        container = "teachers" if payload.get("role") == "teacher" else "students"
        await upsert_item(container, user_doc)
        return _ok({"valid": False, "locked": True, "attempts_remaining": 0})

    container = "teachers" if payload.get("role") == "teacher" else "students"
    await upsert_item(container, user_doc)

    return _ok({
        "valid": False,
        "locked": False,
        "attempts_remaining": 5 - wrong_attempts,
    })


# ── DELETE /api/auth/pin ──────────────────────────────────────────────────────

async def handle_auth_pin_delete(req: func.HttpRequest) -> func.HttpResponse:
    """Remove PIN from the authenticated user's account.

    Requires: Authorization: Bearer <jwt>
    Response 200: { "success": true }
    """
    payload = get_user_from_request(req)
    if payload is None:
        return _err("Authentication required.", status=401)

    user_doc = await _get_verified_user(payload)
    if user_doc is None:
        return _err("Session expired. Please log in again.", status=401)

    user_doc["pin_hash"] = None
    user_doc["pin_locked"] = False
    user_doc["pin_wrong_attempts"] = 0

    container = "teachers" if payload.get("role") == "teacher" else "students"
    await upsert_item(container, user_doc)

    return _ok({"success": True})
