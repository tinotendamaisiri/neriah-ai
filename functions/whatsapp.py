"""
WhatsApp webhook — GET verification + POST state machine.

States: IDLE → CLASS_SETUP → AWAITING_REGISTER → AWAITING_ANSWER_KEY → MARKING_ACTIVE → ERROR
Session documents live in Firestore collection 'sessions'.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.annotator import annotate_image
from shared.config import settings
from shared.firestore_client import get_doc, query_single, upsert
from shared.gcs_client import upload_bytes
from shared.gemma_client import (
    check_image_quality,
    extract_answer_key_from_image,
    extract_names_from_image,
    generate_marking_scheme,
    grade_submission,
)
from shared.models import AnswerKey, Class, Mark, Session, Student, WhatsAppState
from shared.whatsapp_client import download_media, send_image, send_text

logger = logging.getLogger(__name__)
whatsapp_bp = Blueprint("whatsapp", __name__)

_HELP_MENU = (
    "Neriah — What would you like to do?\n\n"
    "1. *setup class* — create a new class\n"
    "2. *mark* — mark student books\n"
    "3. *answer key* — upload or generate an answer key\n"
    "4. *help* — show this menu"
)


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

    # Extract text or media ID
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
    if any(k in text for k in ("setup", "class", "create")):
        _set_state(phone, WhatsAppState.CLASS_SETUP, {"step": "name"})
        send_text(phone, "Let's set up a class. What is the class name?")
    elif any(k in text for k in ("mark", "grade", "check")) or media_id:
        send_text(phone, "To start marking, please set up a class first. Type 'setup class'.")
    elif any(k in text for k in ("answer", "key", "scheme")):
        send_text(phone, "To upload an answer key, please set up a class first. Type 'setup class'.")
    else:
        send_text(phone, _HELP_MENU)


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
        # Use Gemma 4 to extract names from register photo
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

    # Update student count
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
        # Extract Q&A from image
        scheme = extract_answer_key_from_image(image_bytes)
        if not scheme:
            send_text(phone, "Couldn't read the answer key. Please try again or type the answers.")
            return
        _store_answer_key(phone, class_id, education_level, scheme, context)
        return

    if text:
        # Manual text Q&A entry
        scheme = generate_marking_scheme(text, education_level)
        _store_answer_key(phone, class_id, education_level, scheme, context)
        return

    send_text(phone, "Please send the answer key photo, type the answers, or type 'generate'.")


def _store_answer_key(phone: str, class_id: str, education_level: str, scheme: dict, context: dict):
    teacher = _get_teacher(phone)
    teacher_id = teacher["id"] if teacher else "unknown"
    questions = scheme.get("questions", [])
    total_marks = sum(float(q.get("marks", 0)) for q in questions)

    key = AnswerKey(
        class_id=class_id,
        teacher_id=teacher_id,
        title=scheme.get("title", "Answer Key"),
        education_level=education_level,
        questions=questions,
        total_marks=total_marks,
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

    # ── Mark the submission ───────────────────────────────────────────────────
    answer_key_id = context.get("answer_key_id")
    answer_key = get_doc("answer_keys", answer_key_id) if answer_key_id else None
    if not answer_key:
        send_text(phone, "No answer key found. Type 'answer key' to set one up.")
        return

    send_text(phone, "Marking...")
    image_bytes = download_media(media_id)

    # Quality gate
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

    # Annotate image
    annotated_bytes = annotate_image(image_bytes, raw_verdicts)

    # Upload annotated image
    student_id = context.get("current_student_id", str(uuid.uuid4()))
    blob_name = f"{student_id}/{uuid.uuid4()}.jpg"
    teacher = _get_teacher(phone)
    teacher_id = teacher["id"] if teacher else "unknown"
    marked_url = upload_bytes(settings.GCS_BUCKET_MARKED, blob_name, annotated_bytes)

    # Store mark
    mark = Mark(
        student_id=student_id,
        class_id=context.get("class_id", ""),
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

    # Build caption
    correct = sum(1 for v in raw_verdicts if v.get("verdict") == "correct")
    total_q = len(raw_verdicts)
    caption = (
        f"*Score: {score:.0f}/{max_score:.0f} ({percentage:.0f}%)*\n"
        f"{correct}/{total_q} questions correct\n\n"
        "Send the next book photo or type 'done' to end."
    )
    send_image(phone, marked_url, caption)


# ─── Session helpers ──────────────────────────────────────────────────────────

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


def _get_teacher(phone: str):
    from shared.firestore_client import query_single as _qs
    return _qs("teachers", [("phone", "==", phone)])
