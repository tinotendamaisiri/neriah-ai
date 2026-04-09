# functions/student_auth.py
# Student-specific auth endpoints.
#
# POST /api/auth/student/lookup   — find a pre-created student record by name or phone
# POST /api/auth/student/activate — activate a pre-created student account (teacher-added flow)
# POST /api/auth/student/register — self-register as a student via class join code

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta

import azure.functions as func

from shared.auth import generate_otp, hash_otp
from shared.cosmos_client import get_item, query_items, upsert_item
from shared.models import OTPVerification
from shared.sms_client import send_otp

logger = logging.getLogger(__name__)

_PHONE_RE = re.compile(r'^\+[1-9]\d{9,14}$')


def _is_valid_phone(phone: str) -> bool:
    return bool(_PHONE_RE.fullmatch(phone))


def _ok(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(json.dumps(body, default=str), status_code=status, mimetype="application/json")


def _err(message: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"error": message}), status_code=status, mimetype="application/json")


async def _count_recent_otps(phone: str) -> int:
    """Count OTP docs for this phone issued in the last hour."""
    since = (datetime.utcnow() - timedelta(hours=1)).isoformat()
    results = await query_items(
        container_name="otp_verifications",
        query="SELECT c.id FROM c WHERE c.phone = @phone AND c.created_at >= @since",
        parameters=[{"name": "@phone", "value": phone}, {"name": "@since", "value": since}],
        partition_key=phone,
    )
    return len(results)


async def _issue_otp(
    phone: str,
    role: str,
    purpose: str,
    pending_data: dict,
    channel_preference: str = "whatsapp",
) -> tuple[OTPVerification, str]:
    """Create and persist an OTPVerification document. Returns (otp_doc, channel_used)."""
    raw_otp = generate_otp()
    channel_used, method_info = await send_otp(phone, raw_otp, channel_preference)

    if method_info["method"] == "self":
        logger.warning("[DEV] OTP for ...%s: %s", phone[-4:], raw_otp)
    else:
        logger.info("[DEV] OTP managed by Twilio Verify for ...%s — check SMS on device", phone[-4:])

    now = datetime.utcnow()
    otp_doc = OTPVerification(
        phone=phone,
        otp_code=hash_otp(raw_otp),
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


def _masked(phone: str) -> str:
    return phone[:-3].replace(phone[1:-3], "*" * (len(phone) - 4)) + phone[-3:]


# ── POST /api/auth/student/lookup ─────────────────────────────────────────────

async def handle_student_lookup(req: func.HttpRequest) -> func.HttpResponse:
    """Find student records before first-time activation.

    Search priority:
      1. Exact phone match (cross-partition WHERE phone = @phone)
      2. Case-insensitive first_name + surname match if no phone match

    No auth required — called before the student has a JWT.

    Request body:
        { "first_name": "Tendai", "surname": "Moyo", "phone": "+263771234567" }

    Response 200:
        { "matches": [ { student, class, teacher, school } ] }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    phone: str = (body.get("phone") or "").strip()
    first_name: str = (body.get("first_name") or "").strip()
    surname: str = (body.get("surname") or "").strip()

    student_docs: list[dict] = []

    # Step 1 — phone search (exact, cross-partition)
    if phone and _is_valid_phone(phone):
        student_docs = await query_items(
            container_name="students",
            query="SELECT * FROM c WHERE c.phone = @phone",
            parameters=[{"name": "@phone", "value": phone}],
        )

    # Step 2 — name search if no phone match
    if not student_docs and first_name and surname:
        student_docs = await query_items(
            container_name="students",
            query=(
                "SELECT * FROM c "
                "WHERE LOWER(c.first_name) = LOWER(@fn) "
                "AND LOWER(c.surname) = LOWER(@sn)"
            ),
            parameters=[
                {"name": "@fn", "value": first_name},
                {"name": "@sn", "value": surname},
            ],
        )

    if not student_docs:
        return _ok({"matches": []})

    # Enrich each match with class + teacher info
    matches = []
    for student in student_docs:
        class_id: str = student.get("class_id", "")
        # Load class (cross-partition — we don't have teacher_id here)
        class_results = await query_items(
            container_name="classes",
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": class_id}],
        )
        class_doc = class_results[0] if class_results else {}

        # Load teacher by id (cross-partition — teachers are partitioned by phone, not id)
        teacher_doc: dict = {}
        if class_doc.get("teacher_id"):
            teacher_results = await query_items(
                container_name="teachers",
                query="SELECT * FROM c WHERE c.id = @id",
                parameters=[{"name": "@id", "value": class_doc["teacher_id"]}],
            )
            teacher_doc = teacher_results[0] if teacher_results else {}

        matches.append({
            "student": {
                "id": student["id"],
                "first_name": student.get("first_name", ""),
                "surname": student.get("surname", ""),
                "register_number": student.get("register_number"),
                "class_id": class_id,
            },
            "class": {
                "id": class_doc.get("id", ""),
                "name": class_doc.get("name", ""),
                "subject": class_doc.get("subject"),
                "education_level": class_doc.get("education_level", ""),
            },
            "teacher": {
                "first_name": teacher_doc.get("first_name", ""),
                "surname": teacher_doc.get("surname", ""),
            },
            "school": teacher_doc.get("school"),
        })

    return _ok({"matches": matches})


# ── POST /api/auth/student/activate ──────────────────────────────────────────

async def handle_student_activate(req: func.HttpRequest) -> func.HttpResponse:
    """Activate a pre-created student account (teacher-added flow).

    The teacher created the student record. The student claims it by providing
    their student_id (from the lookup) and their phone number to receive an OTP.

    Request body:
        { "student_id": "uuid", "phone": "+263771234567" }

    Response 200:
        { "verification_id": "uuid", "message": "OTP sent to +263...567" }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    student_id: str = (body.get("student_id") or "").strip()
    phone: str = (body.get("phone") or "").strip()

    if not student_id:
        return _err("student_id is required")
    if not _is_valid_phone(phone):
        return _err("phone must be in E.164 format, e.g. +263771234567")

    # Load student by id — cross-partition since we only have student id
    results = await query_items(
        container_name="students",
        query="SELECT * FROM c WHERE c.id = @id",
        parameters=[{"name": "@id", "value": student_id}],
    )
    if not results:
        return _err("Student not found.", status=404)

    student_doc: dict = results[0]

    # Update phone if different (or not set)
    if student_doc.get("phone") != phone:
        student_doc["phone"] = phone
        await upsert_item("students", student_doc)

    # Rate limit
    if await _count_recent_otps(phone) >= 5:
        return _err("Too many verification attempts. Please wait before trying again.", status=429)

    channel_preference: str = body.get("channel_preference", "whatsapp")

    try:
        otp_doc, channel_used = await _issue_otp(
            phone=phone,
            role="student",
            purpose="activate",
            pending_data={
                "student_id": student_doc["id"],
                "class_id": student_doc.get("class_id"),
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


# ── POST /api/auth/student/register ──────────────────────────────────────────

async def handle_student_self_register(req: func.HttpRequest) -> func.HttpResponse:
    """Student self-registers by providing a class_id directly, or a class join code.

    Accepts either:
      - class_id (new preferred flow — student picks class from school list)
      - class_join_code (legacy flow — teacher gives student a 6-char code)

    A new Student document is created in Cosmos when the OTP is verified
    (handled in POST /api/auth/verify with purpose="student_register").

    Request body:
        {
          "first_name": "Tendai",
          "surname": "Moyo",
          "phone": "+263771234567",
          "class_id": "uuid"            ← preferred
          // OR:
          "class_join_code": "A7B3K2"  ← legacy
        }

    Response 200:
        { "verification_id": "uuid", "message": "OTP sent" }
    """
    try:
        body = req.get_json()
    except Exception:
        return _err("Invalid JSON body")

    first_name: str = (body.get("first_name") or "").strip()
    surname: str = (body.get("surname") or "").strip()
    phone: str = (body.get("phone") or "").strip()
    email: str = (body.get("email") or "").strip().lower()
    class_id_direct: str = (body.get("class_id") or "").strip()
    join_code: str = (body.get("class_join_code") or "").strip().upper()

    if not first_name or not surname:
        return _err("first_name and surname are required")
    if not phone:
        return _err("phone is required")
    if not _is_valid_phone(phone):
        return _err("phone must be in E.164 format, e.g. +263771234567")
    if not class_id_direct and not join_code:
        return _err("class_id or class_join_code is required")

    # Resolve class document
    if class_id_direct:
        # New flow: class_id provided directly
        class_results = await query_items(
            container_name="classes",
            query="SELECT * FROM c WHERE c.id = @id",
            parameters=[{"name": "@id", "value": class_id_direct}],
        )
        if not class_results:
            return _err("Class not found.", status=404)
    else:
        # Legacy flow: resolve via join code (cross-partition)
        class_results = await query_items(
            container_name="classes",
            query="SELECT * FROM c WHERE c.join_code = @code",
            parameters=[{"name": "@code", "value": join_code}],
        )
        if not class_results:
            return _err("Invalid class code. Please check the code and try again.", status=400)

    class_doc: dict = class_results[0]

    # Check if phone already registered as student
    existing = await query_items(
        container_name="students",
        query="SELECT c.id FROM c WHERE c.phone = @phone",
        parameters=[{"name": "@phone", "value": phone}],
    )
    if existing:
        return _err("This phone number is already registered. Please use the login option.", status=409)

    # Rate limit
    if await _count_recent_otps(phone) >= 5:
        return _err("Too many verification attempts. Please wait before trying again.", status=429)

    channel_preference: str = body.get("channel_preference", "whatsapp")

    try:
        pending: dict = {
            "first_name": first_name,
            "surname": surname,
            "phone": phone,
            "class_id": class_doc["id"],
            "teacher_id": class_doc.get("teacher_id"),
        }
        if email:
            pending["email"] = email
        otp_doc, channel_used = await _issue_otp(
            phone=phone,
            role="student",
            purpose="student_register",
            pending_data=pending,
            channel_preference=channel_preference,
        )
    except Exception as exc:
        return _err(str(exc), status=503)

    return _ok({
        "verification_id": otp_doc.id,
        "message": f"OTP sent to {_masked(phone)}",
        "channel": channel_used,
    })
