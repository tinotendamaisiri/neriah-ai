"""
WhatsApp webhook — GET verification + POST state machine.

Teacher states : IDLE → CLASS_SETUP → AWAITING_REGISTER → AWAITING_ANSWER_KEY → MARKING_ACTIVE → ERROR
Student states : IDLE → STUDENT_ONBOARDING_SCHOOL → STUDENT_ONBOARDING_CLASS
                      → STUDENT_ONBOARDING_NAME   → STUDENT_ONBOARDING_CONFIRM → IDLE

Session documents live in Firestore collection 'sessions'.
"""

from __future__ import annotations

import difflib
import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.annotator import annotate_image
from shared.config import settings
from shared.firestore_client import get_doc, increment_field, query, query_single, upsert
from shared.gcs_client import generate_signed_url, upload_bytes
from shared.gemma_client import (
    check_image_quality,
    extract_answer_key_from_image,
    extract_names_from_image,
    generate_marking_scheme,
    grade_submission,
    student_tutor,
)
from shared.models import AnswerKey, Class, Mark, Session, Student, WhatsAppState
from shared.submission_codes import generate_unique_submission_code
from shared.whatsapp_client import download_media, send_image, send_text
from functions.teacher_whatsapp import (
    TEACHER_REVIEW_ACTIVE,
    TEACHER_REVIEW_SELECTING,
    handle_teacher_results,
    handle_teacher_review_active,
    handle_teacher_review_selecting,
)

logger = logging.getLogger(__name__)
whatsapp_bp = Blueprint("whatsapp", __name__)

_HELP_MENU = (
    "Neriah — What would you like to do?\n\n"
    "1. *setup class* — create a new class\n"
    "2. *mark* — mark student books\n"
    "3. *answer key* — upload or generate an answer key\n"
    "4. *help* — show this menu"
)

# Minimal seed school list used when Firestore 'schools' collection is empty.
# Kept in sync with functions/schools.py _SEED_SCHOOLS.
_SEED_SCHOOLS = [
    {"id": "zw-001", "name": "Prince Edward School",       "city": "Harare"},
    {"id": "zw-002", "name": "St George's College",        "city": "Harare"},
    {"id": "zw-003", "name": "Harare High School",         "city": "Harare"},
    {"id": "zw-004", "name": "Girls High School",          "city": "Harare"},
    {"id": "zw-005", "name": "Highlands Junior School",    "city": "Harare"},
    {"id": "zw-006", "name": "Borrowdale Primary School",  "city": "Harare"},
    {"id": "zw-007", "name": "Marlborough High School",    "city": "Harare"},
    {"id": "zw-008", "name": "Kuwadzana Primary School",   "city": "Harare"},
    {"id": "zw-009", "name": "Christian Brothers College", "city": "Bulawayo"},
    {"id": "zw-010", "name": "Eveline High School",        "city": "Bulawayo"},
    {"id": "zw-011", "name": "Mzilikazi Primary School",   "city": "Bulawayo"},
    {"id": "zw-012", "name": "Plumtree High School",       "city": "Bulawayo"},
    {"id": "zw-013", "name": "Townsend Primary School",    "city": "Bulawayo"},
    {"id": "zw-014", "name": "Goromonzi High School",      "city": "Goromonzi"},
    {"id": "zw-015", "name": "Mutare Boys High School",    "city": "Mutare"},
    {"id": "zw-016", "name": "Marist Brothers Nyanga",     "city": "Nyanga"},
    {"id": "zw-017", "name": "Chiredzi High School",       "city": "Chiredzi"},
    {"id": "zw-018", "name": "Chinhoyi Primary School",    "city": "Chinhoyi"},
    {"id": "zw-019", "name": "Gweru Technical College",    "city": "Gweru"},
    {"id": "zw-020", "name": "Harare Polytechnic",         "city": "Harare"},
]


# ─── Webhook verification (GET) ───────────────────────────────────────────────

@whatsapp_bp.get("/whatsapp")
def whatsapp_verify():
    mode = request.args.get("hub.mode")
    token = request.args.get("hub.verify_token")
    challenge = request.args.get("hub.challenge")

    if mode == "subscribe" and token == settings.WHATSAPP_VERIFY_TOKEN:
        return challenge, 200
    return "Forbidden", 403


# ─── Incoming message (POST) ──────────────────────────────────────────────────

@whatsapp_bp.post("/whatsapp")
def whatsapp_webhook():
    # ── HMAC signature verification ───────────────────────────────────────────
    # Verifies X-Hub-Signature-256 sent by Meta to reject spoofed webhook calls.
    # Skipped when WHATSAPP_APP_SECRET is not configured (local / demo).
    if settings.WHATSAPP_APP_SECRET:
        import hashlib as _hashlib  # noqa: PLC0415
        import hmac as _hmac  # noqa: PLC0415
        raw_body = request.get_data()
        sig_header = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + _hmac.new(
            settings.WHATSAPP_APP_SECRET.encode(),
            raw_body,
            _hashlib.sha256,
        ).hexdigest()
        if not _hmac.compare_digest(sig_header, expected):
            logger.warning("[whatsapp] HMAC signature mismatch — rejecting webhook")
            return "", 403

    body = request.get_json(silent=True) or {}
    try:
        entry = body["entry"][0]["changes"][0]["value"]
        messages = entry.get("messages", [])
        if not messages:
            return "ok", 200
        msg = messages[0]
    except (KeyError, IndexError):
        return "ok", 200

    phone = msg["from"]
    msg_type = msg.get("type", "text")

    text = ""
    media_id = None
    if msg_type == "text":
        text = msg.get("text", {}).get("body", "").strip()
    elif msg_type == "image":
        media_id = msg.get("image", {}).get("id")
    elif msg_type == "interactive":
        reply = msg.get("interactive", {}).get("button_reply", {})
        text = reply.get("id", reply.get("title", "")).lower().strip()

    session = _get_or_create_session(phone)
    state = session.get("state", WhatsAppState.IDLE)
    context = session.get("context", {})

    try:
        _route(phone, state, context, text, media_id)
    except Exception:
        logger.exception("Unhandled error in WhatsApp handler for %s", phone)
        _set_state(phone, WhatsAppState.ERROR, context)
        send_text(phone, "Something went wrong. Type 'menu' to start over or 'help' for options.")

    return "ok", 200


# ─── State router ─────────────────────────────────────────────────────────────

def _route(phone: str, state: str, context: dict, text: str, media_id: str | None):
    text_lower = text.lower()

    # Global escape hatches
    if text_lower in ("menu", "restart", "reset"):
        _set_state(phone, WhatsAppState.IDLE, {})
        send_text(phone, _HELP_MENU)
        return

    if text_lower == "help":
        send_text(phone, _HELP_MENU)
        return

    # ── Teacher review states (checked before student states) ─────────────────
    if state == TEACHER_REVIEW_SELECTING:
        teacher = _get_teacher(phone)
        if teacher:
            handle_teacher_review_selecting(phone, context, text_lower)
        else:
            _set_state(phone, WhatsAppState.IDLE, {})
            send_text(phone, _HELP_MENU)
        return

    if state == TEACHER_REVIEW_ACTIVE:
        teacher = _get_teacher(phone)
        if teacher:
            handle_teacher_review_active(phone, context, text, teacher)
        else:
            _set_state(phone, WhatsAppState.IDLE, {})
            send_text(phone, _HELP_MENU)
        return

    # ── Student onboarding states ──────────────────────────────────────────────
    if state == WhatsAppState.STUDENT_ONBOARDING_SCHOOL:
        _handle_onboarding_school(phone, context, text, media_id)
        return
    if state == WhatsAppState.STUDENT_ONBOARDING_CLASS:
        _handle_onboarding_class(phone, context, text, media_id)
        return
    if state == WhatsAppState.STUDENT_ONBOARDING_NAME:
        _handle_onboarding_name(phone, context, text, media_id)
        return
    if state == WhatsAppState.STUDENT_ONBOARDING_CONFIRM:
        _handle_onboarding_confirm(phone, context, text, media_id)
        return

    # ── Teacher / IDLE states ──────────────────────────────────────────────────
    if state == WhatsAppState.IDLE:
        _handle_idle(phone, context, text_lower, media_id)
    elif state == WhatsAppState.CLASS_SETUP:
        _handle_class_setup(phone, context, text_lower, media_id)
    elif state == WhatsAppState.AWAITING_REGISTER:
        _handle_awaiting_register(phone, context, text, media_id)
    elif state == WhatsAppState.AWAITING_ANSWER_KEY:
        _handle_awaiting_answer_key(phone, context, text, media_id)
    elif state == WhatsAppState.MARKING_ACTIVE:
        _handle_marking_active(phone, context, text, media_id)
    elif state == WhatsAppState.ERROR:
        _set_state(phone, WhatsAppState.IDLE, {})
        send_text(phone, _HELP_MENU)


# ─── IDLE ─────────────────────────────────────────────────────────────────────

def _handle_idle(phone: str, context: dict, text: str, media_id: str | None):
    # Check if this phone is a registered teacher or student.
    teacher = _get_teacher(phone)
    if teacher:
        # Registered teacher — existing command-driven flow.
        _handle_teacher_idle(phone, context, text, media_id)
        return

    student = _get_student_by_phone(phone)
    if student:
        # Registered student — photo → submission flow, text → tutor.
        if media_id:
            _handle_student_submission(phone, student, media_id)
        elif text and _is_tutor_intent(text):
            _handle_student_tutor_wa(phone, student, text)
        else:
            send_text(
                phone,
                "Hi! Send a photo of your homework to submit it 📸\n\n"
                "Or ask me a question about your work — I'm here to help you study! 📚",
            )
        return

    # Unregistered phone — start student onboarding.
    if media_id:
        send_text(
            phone,
            "Hi! To submit homework you need to register first.\n"
            "Reply *START* to begin.",
        )
        return

    if text.lower() in ("start", "hi", "hello", "hey") or text:
        _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_SCHOOL, {})
        send_text(
            phone,
            "Welcome to Neriah! 👋\n"
            "To get started, reply with your school name.",
        )


def _handle_teacher_idle(phone: str, context: dict, text: str, media_id: str | None):
    # Review graded homework (WhatsApp-based approval flow)
    if any(k in text for k in ("results", "review", "grades", "approve")):
        teacher = _get_teacher(phone)
        if teacher:
            handle_teacher_results(phone, teacher)
        return

    if any(k in text for k in ("setup", "class", "create")):
        _set_state(phone, WhatsAppState.CLASS_SETUP, {"step": "name"})
        send_text(phone, "Let's set up a class. What is the class name?")
    elif any(k in text for k in ("mark", "grade", "check")) or media_id:
        send_text(phone, "To start marking, please set up a class first. Type 'setup class'.")
    elif any(k in text for k in ("answer", "key", "scheme")):
        send_text(phone, "To upload an answer key, please set up a class first. Type 'setup class'.")
    else:
        send_text(phone, _HELP_MENU)


# ─── STUDENT_ONBOARDING_SCHOOL ────────────────────────────────────────────────

def _handle_onboarding_school(phone: str, context: dict, text: str, media_id: str | None):
    if not text.strip():
        send_text(phone, "Please type your school name.")
        return

    text_lower = text.lower().strip()

    # User is confirming a previously matched school.
    if context.get("pending_school_id"):
        if text_lower in ("yes", "y", "✅", "confirm"):
            context["school_id"] = context.pop("pending_school_id")
            context["school_name"] = context.pop("pending_school_name")

            classes = _get_classes_for_school(context["school_id"])
            if not classes:
                send_text(
                    phone,
                    f"No classes found at {context['school_name']} yet.\n"
                    "Ask your teacher to create a class first, then message us again.",
                )
                _set_state(phone, WhatsAppState.IDLE, {})
                return

            # Store class list so we can map number → class_id without another DB call.
            context["class_options"] = [
                {"id": c["id"], "name": c["name"], "education_level": c.get("education_level", "")}
                for c in classes[:10]
            ]
            _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_CLASS, context)

            lines = "\n".join(
                f"{i + 1}. {c['name']}"
                for i, c in enumerate(context["class_options"])
            )
            send_text(phone, f"Which class are you in?\n\n{lines}\n\nReply with the number of your class.")
            return

        # Not a confirmation — treat the reply as a new school name.
        context.pop("pending_school_id", None)
        context.pop("pending_school_name", None)

    # Fuzzy match against school list.
    matches = _fuzzy_match_school(text)
    if not matches:
        send_text(
            phone,
            "I couldn't find that school. Please try again with the full school name\n"
            "(e.g. *Chiredzi High School*).",
        )
        _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_SCHOOL, context)
        return

    best = matches[0]
    context["pending_school_id"] = best["id"]
    context["pending_school_name"] = best["name"]
    _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_SCHOOL, context)
    send_text(
        phone,
        f"Is this your school?\n✅ *{best['name']}*\n\n"
        "Reply *YES* to confirm or type your school name again.",
    )


# ─── STUDENT_ONBOARDING_CLASS ─────────────────────────────────────────────────

def _handle_onboarding_class(phone: str, context: dict, text: str, media_id: str | None):
    class_options: list[dict] = context.get("class_options", [])

    try:
        choice = int(text.strip())
    except ValueError:
        lines = "\n".join(f"{i + 1}. {c['name']}" for i, c in enumerate(class_options))
        send_text(phone, f"Please reply with a number.\n\n{lines}")
        return

    if not (1 <= choice <= len(class_options)):
        send_text(phone, f"Please reply with a number between 1 and {len(class_options)}.")
        return

    picked = class_options[choice - 1]
    context["class_id"] = picked["id"]
    context["class_name"] = picked["name"]
    context.pop("class_options", None)  # no longer needed
    _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_NAME, context)
    send_text(phone, "What is your full name?")


# ─── STUDENT_ONBOARDING_NAME ─────────────────────────────────────────────────

def _handle_onboarding_name(phone: str, context: dict, text: str, media_id: str | None):
    name = text.strip()
    if not name or len(name) < 2:
        send_text(phone, "Please type your full name.")
        return

    name = name.title()
    parts = name.split(None, 1)
    context["first_name"] = parts[0]
    context["surname"] = parts[1] if len(parts) > 1 else ""
    _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_CONFIRM, context)

    send_text(
        phone,
        f"Welcome *{context['first_name']}*! You will be registered in "
        f"*{context['class_name']}* at *{context['school_name']}*.\n\n"
        "Reply *YES* to confirm or *NO* to go back.",
    )


# ─── STUDENT_ONBOARDING_CONFIRM ──────────────────────────────────────────────

def _handle_onboarding_confirm(phone: str, context: dict, text: str, media_id: str | None):
    text_lower = text.lower().strip()

    if text_lower in ("no", "n", "back"):
        # Go back to name entry.
        context.pop("first_name", None)
        context.pop("surname", None)
        _set_state(phone, WhatsAppState.STUDENT_ONBOARDING_NAME, context)
        send_text(phone, "No problem. What is your full name?")
        return

    if text_lower not in ("yes", "y", "✅", "confirm"):
        send_text(
            phone,
            f"Reply *YES* to confirm registration in *{context['class_name']}* "
            f"at *{context['school_name']}*, or *NO* to go back.",
        )
        return

    # Cross-role guard: refuse to create a Student if this phone is
    # already a Teacher. The IDLE branch already routes existing
    # teachers to teacher flow before onboarding starts, so this is
    # a belt-and-braces check against any path that might otherwise
    # land here with a teacher's phone (e.g. a teacher mid-flow whose
    # session got rebuilt via a different state transition). The API
    # register endpoints enforce the same rule with explicit 409s; we
    # keep the WhatsApp wording user-friendly.
    if query_single("teachers", [("phone", "==", phone)]):
        _set_state(phone, WhatsAppState.IDLE, {})
        send_text(
            phone,
            "This number is already registered as a *teacher* account. "
            "If you're a student, please use a different number to register. "
            "If you're the teacher, just reply *menu* to continue as teacher.",
        )
        return

    # Create the student document.
    student = Student(
        class_id=context["class_id"],
        first_name=context["first_name"],
        surname=context.get("surname", ""),
        phone=phone,
    )
    upsert("students", student.id, student.model_dump())

    # Bump class student_count.
    try:
        increment_field("classes", context["class_id"], "student_count")
    except Exception:
        logger.warning("Could not increment student_count for class %s", context["class_id"])

    _set_state(phone, WhatsAppState.IDLE, {})
    send_text(
        phone,
        f"Welcome *{context['first_name']}*! 🎉 You are now registered in "
        f"*{context['class_name']}* at *{context['school_name']}*.\n\n"
        "Send a photo of your homework to submit it. 📸",
    )


# ─── Student AI tutor (registered student in IDLE) ───────────────────────────

_TUTOR_KEYWORDS = (
    "help", "explain", "how do i", "what is", "why ", "why?", "tutor", "study",
    "what does", "how does", "can you help", "i don't understand", "i dont understand",
    "confused", "stuck",
)


def _is_tutor_intent(text: str) -> bool:
    t = text.lower()
    return any(t.startswith(kw) or kw in t for kw in _TUTOR_KEYWORDS)


def _handle_student_tutor_wa(phone: str, student: dict, message: str) -> None:
    """Route a student text message to the Socratic tutor and reply via WhatsApp."""
    from functions.tutor import check_rate_limit, increment_usage, _is_eligible

    student_id = student["id"]

    if not _is_eligible(student_id):
        send_text(
            phone,
            "The AI tutor is available for students at subscribed schools. "
            "Ask your teacher about Neriah.",
        )
        return

    if not check_rate_limit(student_id):
        send_text(phone, (
            "You've been studying hard today! You've used all 50 tutor messages for today. "
            "They reset at midnight. Keep up the great work!"
        ))
        return

    # Load conversation history — keyed by student_id for WhatsApp channel
    from shared.firestore_client import get_doc as _gd, upsert as _up
    from datetime import datetime, timezone

    conv_id = f"wa_{student_id}"
    conv_doc = _gd("tutor_conversations", conv_id)
    history: list[dict] = conv_doc.get("messages", []) if conv_doc else []

    # Resolve education level from student's class
    cls = _gd("classes", student.get("class_id", ""))
    education_level = cls.get("education_level", "Form 4") if cls else "Form 4"

    response_text = student_tutor(message, history, education_level)

    now = datetime.now(timezone.utc).isoformat()
    updated_history = history + [
        {"role": "user", "content": message},
        {"role": "assistant", "content": response_text},
    ]
    _up("tutor_conversations", conv_id, {
        "id": conv_id,
        "student_id": student_id,
        "messages": updated_history,
        "created_at": conv_doc.get("created_at", now) if conv_doc else now,
        "updated_at": now,
    })

    increment_usage(student_id)
    send_text(phone, response_text)


# ─── Student homework submission (registered student in IDLE) ─────────────────

def _handle_student_submission(phone: str, student: dict, media_id: str):
    class_id = student.get("class_id")
    if not class_id:
        send_text(phone, "Your class could not be found. Please contact your teacher.")
        return

    # Find the most recent open answer key for this class.
    answer_keys = query(
        "answer_keys",
        [("class_id", "==", class_id), ("open_for_submission", "==", True)],
        order_by="created_at",
        direction="DESCENDING",
        limit=1,
    )
    if not answer_keys:
        send_text(
            phone,
            "There are no open assignments for your class right now. "
            "Check with your teacher.",
        )
        return

    answer_key = answer_keys[0]
    send_text(phone, "Received! Grading your homework... ✏️")

    image_bytes = download_media(media_id)
    # Normalise orientation before grading + annotation. See
    # shared/orientation.py — handles EXIF rotation + a vision pre-check
    # for the residual cases (rotated within frame, no EXIF, etc.) so
    # the page is upright before Gemma reads it and before ticks land.
    from shared.orientation import normalize_to_upright
    image_bytes = normalize_to_upright(image_bytes)

    quality = check_image_quality(image_bytes)
    if not quality.get("pass", True):
        send_text(phone, f"⚠️ {quality.get('suggestion', 'Please retake the photo and try again.')}")
        return

    education_level = answer_key.get("education_level", "Form 4")
    raw_verdicts = grade_submission(image_bytes, answer_key, education_level)

    score = sum(float(v.get("awarded_marks", 0)) for v in raw_verdicts)
    max_score = sum(float(v.get("max_marks", 1)) for v in raw_verdicts) or float(
        answer_key.get("total_marks", 1)
    )
    percentage = round(score / max_score * 100, 1) if max_score else 0.0

    annotated_bytes = annotate_image(image_bytes, raw_verdicts)
    blob_name = f"{student['id']}/{uuid.uuid4()}.jpg"
    upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes, public=False)
    marked_url = generate_signed_url(settings.GCS_BUCKET_MARKED, blob_name, expiry_minutes=60)

    mark = Mark(
        student_id=student["id"],
        class_id=class_id,
        answer_key_id=answer_key["id"],
        teacher_id=answer_key.get("teacher_id", ""),
        score=score,
        max_score=max_score,
        percentage=percentage,
        verdicts=[],
        marked_image_url=marked_url,
        source="student_whatsapp",
        approved=False,
    )
    upsert("marks", mark.id, mark.model_dump())

    # The graded image used to be sent back to the student here, before
    # the teacher had even seen it. That violated the "teacher approves
    # first" policy. The reply is now fired from the approval handler
    # in submissions.py:_dispatch_student_reply_secondary_channels,
    # which dispatches to WhatsApp / email / push based on mark.source.
    # Acknowledge receipt so the student knows their submission landed.
    send_text(
        phone,
        "Thanks — your homework has been received. Your teacher will review it and "
        "we'll send the marked result back here once it's approved.",
    )


# ─── CLASS_SETUP ──────────────────────────────────────────────────────────────

_LEVEL_MENU = (
    "What education level is this class?\n\n"
    "1. Grade 1–3\n2. Grade 4–5\n3. Grade 6–7\n"
    "4. Form 1–2\n5. Form 3–4\n6. Form 5–6 (A-Level)\n7. College/University"
)

_LEVEL_MAP = {
    "1": "Grade 3", "grade 1": "Grade 1", "grade 2": "Grade 2", "grade 3": "Grade 3",
    "2": "Grade 5", "grade 4": "Grade 4", "grade 5": "Grade 5",
    "3": "Grade 7", "grade 6": "Grade 6", "grade 7": "Grade 7",
    "4": "Form 2",  "form 1": "Form 1",   "form 2": "Form 2",
    "5": "Form 4",  "form 3": "Form 3",   "form 4": "Form 4",
    "6": "Form 6 (A-Level)", "form 5": "Form 5 (A-Level)", "form 6": "Form 6 (A-Level)",
    "7": "College/University", "college": "College/University", "university": "College/University",
}


def _handle_class_setup(phone: str, context: dict, text: str, media_id: str | None):
    step = context.get("step")

    if step == "name":
        if not text:
            send_text(phone, "Please type a class name.")
            return
        context["class_name"] = text.title()
        context["step"] = "level"
        _set_state(phone, WhatsAppState.CLASS_SETUP, context)
        send_text(phone, _LEVEL_MENU)

    elif step == "level":
        level = _LEVEL_MAP.get(text.lower())
        if not level:
            send_text(phone, f"Please reply with a number 1–7.\n\n{_LEVEL_MENU}")
            return

        teacher = _get_teacher(phone)
        if not teacher:
            send_text(phone, "Your account was not found. Please register first.")
            _set_state(phone, WhatsAppState.IDLE, {})
            return

        cls = Class(
            teacher_id=teacher["id"],
            name=context["class_name"],
            education_level=level,
        )
        upsert("classes", cls.id, cls.model_dump())

        context["class_id"] = cls.id
        context["education_level"] = level
        context["step"] = None
        _set_state(phone, WhatsAppState.AWAITING_REGISTER, context)
        send_text(
            phone,
            f"Class '{cls.name}' created!\n\n"
            "Now send a photo of the class register page to extract student names, "
            "or type them one per line.\n\nType 'skip' to add students later.",
        )


# ─── AWAITING_REGISTER ────────────────────────────────────────────────────────

def _handle_awaiting_register(phone: str, context: dict, text: str, media_id: str | None):
    if text.lower() == "skip":
        _set_state(phone, WhatsAppState.AWAITING_ANSWER_KEY, context)
        send_text(phone, "Students skipped. Now send the answer key or type 'generate'.")
        return

    names: list[str] = []

    if media_id:
        send_text(phone, "Reading the register...")
        image_bytes = download_media(media_id)
        names = extract_names_from_image(image_bytes)
    else:
        names = [n.strip() for n in text.splitlines() if n.strip()]

    if not names:
        send_text(phone, "I couldn't find any names. Please try again or type 'skip'.")
        return

    class_id = context.get("class_id")
    for raw_name in names:
        parts = raw_name.strip().split(None, 1)
        first = parts[0]
        sur = parts[1] if len(parts) > 1 else ""
        student = Student(class_id=class_id, first_name=first, surname=sur)
        upsert("students", student.id, student.model_dump())

    cls = get_doc("classes", class_id)
    if cls:
        upsert("classes", class_id, {"student_count": cls.get("student_count", 0) + len(names)})

    _set_state(phone, WhatsAppState.AWAITING_ANSWER_KEY, context)
    send_text(
        phone,
        f"Added {len(names)} student(s).\n\n"
        "Now send a photo of the answer key or question paper, "
        "type the Q&A pairs, or type 'generate' to auto-generate a marking scheme.",
    )


# ─── AWAITING_ANSWER_KEY ─────────────────────────────────────────────────────

def _handle_awaiting_answer_key(phone: str, context: dict, text: str, media_id: str | None):
    class_id = context.get("class_id")
    education_level = context.get("education_level", "Form 4")

    if text.lower() == "generate":
        send_text(phone, "What subject is this for? (e.g. Mathematics, English, Science)")
        context["awaiting_subject"] = True
        _set_state(phone, WhatsAppState.AWAITING_ANSWER_KEY, context)
        return

    if context.get("awaiting_subject"):
        subject = text
        send_text(phone, f"Generating marking scheme for {subject}...")
        scheme = generate_marking_scheme(
            f"Subject: {subject}. Education level: {education_level}.", education_level
        )
        _store_answer_key(phone, class_id, education_level, scheme, context)
        return

    if media_id:
        send_text(phone, "Reading the answer key...")
        image_bytes = download_media(media_id)
        quality = check_image_quality(image_bytes)
        if not quality.get("pass", True):
            send_text(phone, f"Image quality issue: {quality.get('suggestion', 'Please retake.')}")
            return
        scheme = extract_answer_key_from_image(image_bytes)
        if not scheme:
            send_text(phone, "Couldn't read the answer key. Please try again or type the answers.")
            return
        _store_answer_key(phone, class_id, education_level, scheme, context)
        return

    if text:
        scheme = generate_marking_scheme(text, education_level)
        _store_answer_key(phone, class_id, education_level, scheme, context)
        return

    send_text(phone, "Please send the answer key photo, type the answers, or type 'generate'.")


def _store_answer_key(phone: str, class_id: str, education_level: str, scheme: dict, context: dict):
    teacher = _get_teacher(phone)
    if not teacher:
        send_text(phone, "Could not find your teacher profile. Please register first.")
        return
    teacher_id = teacher["id"]
    questions = scheme.get("questions", [])
    if not questions:
        send_text(phone, "Could not generate a marking scheme — no questions found. Try a clearer image or type the answers manually.")
        return
    total_marks = sum(float(q.get("marks", 0)) for q in questions)

    key = AnswerKey(
        class_id=class_id,
        teacher_id=teacher_id,
        title=scheme.get("title", "Answer Key"),
        education_level=education_level,
        questions=questions,
        total_marks=total_marks,
        submission_code=generate_unique_submission_code(),
    )
    upsert("answer_keys", key.id, key.model_dump())

    context["answer_key_id"] = key.id
    context.pop("awaiting_subject", None)
    _set_state(phone, WhatsAppState.MARKING_ACTIVE, context)
    send_text(
        phone,
        f"Answer key '{key.title}' saved ({len(questions)} questions, {total_marks:.0f} marks).\n\n"
        "Ready to mark! Send the student's book photo.\n"
        "Type 'done' when you've finished the session.",
    )


# ─── MARKING_ACTIVE ───────────────────────────────────────────────────────────

def _handle_marking_active(phone: str, context: dict, text: str, media_id: str | None):
    text_lower = text.lower()

    if text_lower in ("done", "stop", "finish", "end"):
        _set_state(phone, WhatsAppState.IDLE, {})
        send_text(phone, "Session ended. Type 'mark' to start a new session or 'help' for options.")
        return

    if text_lower in ("next", "next student"):
        context.pop("current_student_id", None)
        _set_state(phone, WhatsAppState.MARKING_ACTIVE, context)
        send_text(phone, "Ready for next student. Send the book photo.")
        return

    if not media_id:
        send_text(phone, "Please send the student's book photo, or type 'done' to end.")
        return

    answer_key_id = context.get("answer_key_id")
    answer_key = get_doc("answer_keys", answer_key_id) if answer_key_id else None
    if not answer_key:
        send_text(phone, "No answer key found. Type 'answer key' to set one up.")
        return

    send_text(phone, "Marking...")
    image_bytes = download_media(media_id)
    # Normalise orientation before grading + annotation — same rationale
    # as the student-submission path above.
    from shared.orientation import normalize_to_upright
    image_bytes = normalize_to_upright(image_bytes)

    quality = check_image_quality(image_bytes)
    if not quality.get("pass", True):
        from functions.mark import _quality_message
        send_text(phone, _quality_message(quality.get("reason", "")))
        return

    education_level = answer_key.get("education_level", "Form 4")
    raw_verdicts = grade_submission(image_bytes, answer_key, education_level)

    score = sum(float(v.get("awarded_marks", 0)) for v in raw_verdicts)
    max_score = sum(float(v.get("max_marks", 1)) for v in raw_verdicts) or float(
        answer_key.get("total_marks", 1)
    )
    percentage = round(score / max_score * 100, 1) if max_score else 0.0

    annotated_bytes = annotate_image(image_bytes, raw_verdicts)

    student_id = context.get("current_student_id", str(uuid.uuid4()))
    blob_name = f"{student_id}/{uuid.uuid4()}.jpg"
    teacher = _get_teacher(phone)
    if not teacher:
        send_text(phone, "Could not find your teacher profile. Mark not saved.")
        return
    teacher_id = teacher["id"]
    class_id = context.get("class_id", "")
    if not class_id:
        send_text(phone, "No class selected. Type 'menu' to start over.")
        return
    upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes, public=False)
    marked_url = generate_signed_url(settings.GCS_BUCKET_MARKED, blob_name, expiry_minutes=60)

    mark = Mark(
        student_id=student_id,
        class_id=class_id,
        answer_key_id=answer_key_id,
        teacher_id=teacher_id,
        score=score,
        max_score=max_score,
        percentage=percentage,
        verdicts=[],
        marked_image_url=marked_url,
        source="teacher_scan",
        approved=True,
    )
    upsert("marks", mark.id, mark.model_dump())

    correct = sum(1 for v in raw_verdicts if v.get("verdict") == "correct")
    total_q = len(raw_verdicts)
    caption = (
        f"*Score: {score:.0f}/{max_score:.0f} ({percentage:.0f}%)*\n"
        f"{correct}/{total_q} questions correct\n\n"
        "Send the next book photo or type 'done' to end."
    )
    send_image(phone, marked_url, caption)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_or_create_session(phone: str) -> dict:
    doc = get_doc("sessions", phone)
    if doc:
        return doc
    session = Session(id=phone, phone=phone)
    upsert("sessions", phone, session.model_dump())
    return session.model_dump()


def _set_state(phone: str, state: str, context: dict) -> None:
    upsert("sessions", phone, {
        "state": state,
        "context": context,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })


def _get_teacher(phone: str) -> dict | None:
    return query_single("teachers", [("phone", "==", phone)])


def _get_student_by_phone(phone: str) -> dict | None:
    return query_single("students", [("phone", "==", phone)])


def _get_classes_for_school(school_id: str) -> list[dict]:
    """Return all classes whose teachers belong to the given school."""
    teachers = query("teachers", [("school_id", "==", school_id)])
    if not teachers:
        return []
    classes: list[dict] = []
    for teacher in teachers:
        classes.extend(query("classes", [("teacher_id", "==", teacher["id"])]))
    # Sort by education_level then name for a predictable numbered list.
    classes.sort(key=lambda c: (c.get("education_level", ""), c.get("name", "")))
    return classes


def _fuzzy_match_school(text: str) -> list[dict]:
    """Return up to 3 schools that fuzzy-match the given text."""
    try:
        schools = query("schools", []) or _SEED_SCHOOLS
    except Exception:
        schools = _SEED_SCHOOLS

    names = [s["name"] for s in schools]
    close = difflib.get_close_matches(text.title(), names, n=3, cutoff=0.35)

    # Also include any school whose name contains the query as a substring.
    text_lower = text.lower()
    substring_matches = [
        s["name"] for s in schools
        if text_lower in s["name"].lower() and s["name"] not in close
    ]
    all_matches = close + substring_matches[:3]

    return [s for s in schools if s["name"] in all_matches]
