# functions/whatsapp_webhook.py
# POST /api/whatsapp  — WhatsApp Cloud API webhook receiver.
# GET  /api/whatsapp  — Meta webhook verification challenge.
#
# This file implements the full WhatsApp conversation state machine.
# States: IDLE → CLASS_SETUP → AWAITING_REGISTER → AWAITING_ANSWER_KEY → MARKING_ACTIVE
# See CLAUDE.md Section 5 for the full state machine specification.

from __future__ import annotations

import logging

import azure.functions as func

from shared.cosmos_client import get_session, save_session
from shared.models import Session, SessionContext, WhatsAppState
from shared.whatsapp_client import send_text, send_image

logger = logging.getLogger(__name__)

bp = func.Blueprint()


# ── Public async handlers (called from function_app.py @app.route decorators) ─

async def handle_verification(req: func.HttpRequest) -> func.HttpResponse:
    """GET /api/whatsapp — Meta webhook verification challenge."""
    return _handle_verification(req)


async def handle_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """POST /api/whatsapp — inbound WhatsApp messages."""
    return _handle_message(req)


# ── HTTP trigger ──────────────────────────────────────────────────────────────

@bp.route(route="whatsapp", methods=["GET", "POST"])
def whatsapp_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """
    Entry point for all inbound WhatsApp messages.
    GET:  webhook verification (Meta sends hub.challenge, we echo it back)
    POST: inbound message — parse, load session, route to state handler
    """
    if req.method == "GET":
        return _handle_verification(req)
    return _handle_message(req)


# ── Webhook verification ──────────────────────────────────────────────────────

def _handle_verification(req: func.HttpRequest) -> func.HttpResponse:
    """
    Meta verifies the webhook by sending:
        GET ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
    We must respond with the raw challenge string if the token matches.
    """
    # TODO: implement — read hub.verify_token from query params, compare with settings.whatsapp_verify_token
    # TODO: return hub.challenge as plain text 200, or 403 if token mismatch
    from shared.config import settings

    mode = req.params.get("hub.mode")
    token = req.params.get("hub.verify_token")
    challenge = req.params.get("hub.challenge")

    if mode == "subscribe" and token == settings.whatsapp_verify_token:
        return func.HttpResponse(challenge, status_code=200)
    return func.HttpResponse("Forbidden", status_code=403)


# ── Message routing ───────────────────────────────────────────────────────────

def _handle_message(req: func.HttpRequest) -> func.HttpResponse:
    """
    Parse the inbound message payload, load the teacher's session from Cosmos,
    and dispatch to the correct state handler.
    """
    # TODO: parse req.get_json() — validate it's a real message (not status update, delivery receipt)
    # TODO: extract phone, message_type (text/image), and message body/media_id
    # TODO: load or create session document from Cosmos (sessions container, partition key = phone)
    # TODO: dispatch to state handler based on session.state
    # TODO: always return HTTP 200 immediately — WhatsApp will retry on non-200 responses

    try:
        body = req.get_json()
        # TODO: implement full parsing of WhatsApp webhook payload structure
        phone = _extract_phone(body)
        message = _extract_message(body)

        if not phone or not message:
            return func.HttpResponse("OK", status_code=200)  # ignore non-message events

        session_doc = get_session(phone)
        if session_doc:
            session = Session(**session_doc)
        else:
            session = Session(id=phone, phone=phone)

        _dispatch(session, message)
        return func.HttpResponse("OK", status_code=200)

    except Exception as e:
        logger.exception("Unhandled error in whatsapp_webhook: %s", e)
        return func.HttpResponse("OK", status_code=200)  # still 200 — prevent WhatsApp retries


def _dispatch(session: Session, message: dict) -> None:
    """Route to the correct state handler based on session.state."""
    # TODO: implement dispatch table
    handlers = {
        WhatsAppState.IDLE: _handle_idle,
        WhatsAppState.CLASS_SETUP: _handle_class_setup,
        WhatsAppState.AWAITING_REGISTER: _handle_awaiting_register,
        WhatsAppState.AWAITING_ANSWER_KEY: _handle_awaiting_answer_key,
        WhatsAppState.MARKING_ACTIVE: _handle_marking_active,
        WhatsAppState.ERROR: _handle_error,
    }
    handler = handlers.get(session.state, _handle_idle)
    handler(session, message)


# ── STATE: IDLE ───────────────────────────────────────────────────────────────

def _handle_idle(session: Session, message: dict) -> None:
    """
    Default state. Detect teacher intent and route to the correct flow.

    Incoming message intent detection (MVP: keyword matching, upgrade to GPT later):
        - "setup", "new class", "create class"  → CLASS_SETUP
        - "mark", or image with no context       → MARKING_ACTIVE (or prompt to select class)
        - "answer key", "scheme"                 → AWAITING_ANSWER_KEY
        - anything else                          → send help menu, stay IDLE
    """
    # TODO: implement intent detection
    # TODO: if teacher has no classes yet, always route to CLASS_SETUP first
    phone = session.phone
    msg_type = message.get("type")
    text = message.get("text", "").lower().strip()

    if any(keyword in text for keyword in ["setup", "new class", "create class"]):
        session.state = WhatsAppState.CLASS_SETUP
        session.context = SessionContext(setup_step="awaiting_class_name")
        save_session(session.model_dump())
        send_text(phone, "Let's set up a new class. What is the class name?")

    elif any(keyword in text for keyword in ["mark", "marking"]) or msg_type == "image":
        # TODO: check if teacher has at least one class and one answer key before switching state
        session.state = WhatsAppState.MARKING_ACTIVE
        save_session(session.model_dump())
        send_text(phone, "Marking mode ready. Send a student's book photo, or reply with the register number to identify them first.")

    elif any(keyword in text for keyword in ["answer key", "scheme", "answers"]):
        session.state = WhatsAppState.AWAITING_ANSWER_KEY
        save_session(session.model_dump())
        send_text(phone, "Please photograph the question paper (with answers), or type 'generate' and I'll create a marking scheme for you.")

    else:
        _send_help_menu(phone)


# ── STATE: CLASS_SETUP ────────────────────────────────────────────────────────

def _handle_class_setup(session: Session, message: dict) -> None:
    """
    Multi-step class creation flow.
    Steps: (1) collect class name → (2) collect education level → (3) transition to AWAITING_REGISTER

    session.context.setup_step tracks which step we are on.
    """
    # TODO: implement multi-step setup
    phone = session.phone
    step = session.context.setup_step
    text = message.get("text", "").strip()

    if step == "awaiting_class_name":
        # TODO: validate class name (non-empty, max 50 chars)
        # TODO: store class_name in session.context (add field to SessionContext model)
        session.context.setup_step = "awaiting_education_level"
        save_session(session.model_dump())
        _send_education_level_menu(phone)

    elif step == "awaiting_education_level":
        # TODO: parse education level from text or interactive list reply
        # TODO: validate it maps to a valid EducationLevel enum value
        # TODO: create Class document in Cosmos, store class_id in session.context
        session.state = WhatsAppState.AWAITING_REGISTER
        session.context.setup_step = None
        save_session(session.model_dump())
        send_text(phone, "Class created. Now let's add your students. Photograph the register page, or type names one per line. Reply 'skip' to add students later.")

    else:
        # TODO: handle unexpected step value — reset to step 1
        logger.warning("Unknown setup_step '%s' for phone %s", step, phone)
        session.context.setup_step = "awaiting_class_name"
        save_session(session.model_dump())
        send_text(phone, "Let's start over. What is the class name?")


# ── STATE: AWAITING_REGISTER ──────────────────────────────────────────────────

def _handle_awaiting_register(session: Session, message: dict) -> None:
    """
    Collect student list via:
        - Register photo (OCR to extract names)
        - Manual text (names, one per line)
        - "skip" to proceed without students (add later)
    On completion → transition to AWAITING_ANSWER_KEY.
    """
    # TODO: implement register collection
    phone = session.phone
    msg_type = message.get("type")
    text = message.get("text", "").lower().strip()

    if text == "skip":
        session.state = WhatsAppState.AWAITING_ANSWER_KEY
        save_session(session.model_dump())
        send_text(phone, "No problem. You can add students later. Now let's set up the answer key. Photograph the question paper or type 'generate'.")

    elif msg_type == "image":
        # TODO: download image from WhatsApp media API using media_id
        # TODO: run OCR to extract names from register page
        # TODO: present extracted names to teacher for confirmation
        # TODO: create Student documents in Cosmos for confirmed names
        # TODO: transition to AWAITING_ANSWER_KEY
        send_text(phone, "Received your register photo. Processing... (TODO: implement OCR extraction)")

    elif msg_type == "text" and text:
        # TODO: parse names from text (split on newlines and/or commas)
        # TODO: create Student documents in Cosmos
        # TODO: confirm count to teacher and transition
        names = [n.strip() for n in message.get("text", "").splitlines() if n.strip()]
        send_text(phone, f"Got {len(names)} students. (TODO: save to Cosmos and transition to answer key setup)")

    else:
        send_text(phone, "Please send a register photo, type student names (one per line), or reply 'skip' to continue.")


# ── STATE: AWAITING_ANSWER_KEY ────────────────────────────────────────────────

def _handle_awaiting_answer_key(session: Session, message: dict) -> None:
    """
    Collect the answer key via:
        - Question paper photo (OCR → auto-generate scheme → teacher confirms)
        - "generate" keyword (ask for subject → GPT generates from subject context)
        - Manual Q&A text
    On completion → transition to MARKING_ACTIVE.
    """
    # TODO: implement answer key collection
    phone = session.phone
    msg_type = message.get("type")
    text = message.get("text", "").lower().strip()

    if text == "generate":
        # TODO: ask for subject name, then call openai_client.generate_marking_scheme()
        send_text(phone, "What subject is this for? (e.g. Mathematics, English, Science)")

    elif msg_type == "image":
        # TODO: quality gate → OCR question paper → generate_marking_scheme() → confirm with teacher
        # TODO: store AnswerKey document, transition to MARKING_ACTIVE
        send_text(phone, "Received question paper photo. Processing... (TODO: implement)")

    else:
        # TODO: parse manual Q&A text (e.g. "1. 42\n2. Paris\n3. H2O")
        # TODO: create AnswerKey and Question documents
        send_text(phone, "Please photograph the question paper, type 'generate' for auto-generation, or type answers as: 1. answer, 2. answer, ...")


# ── STATE: MARKING_ACTIVE ─────────────────────────────────────────────────────

def _handle_marking_active(session: Session, message: dict) -> None:
    """
    Main marking loop. Teacher sends student book photos one at a time.
    Each image triggers the full pipeline: quality gate → OCR → grade → annotate → store → reply.

    Teacher can:
        - Send image → mark it
        - Send register number or name to identify the student first
        - Say "done" or "stop" to end the session
        - Say "next student" to clear current student context
    """
    phone = session.phone
    msg_type = message.get("type")
    text = message.get("text", "").lower().strip()

    if text in ("done", "stop", "finish"):
        # TODO: query marks for this session, send summary (n books marked, average score)
        session.state = WhatsAppState.IDLE
        save_session(session.model_dump())
        send_text(phone, "Marking session ended. Great work! Type 'menu' any time to start again.")
        return

    if text == "next student":
        session.context.current_student_id = None
        save_session(session.model_dump())
        send_text(phone, "Ready for the next student. Send their book photo.")
        return

    if msg_type == "image":
        _handle_image_submission(session, message)
        return

    if msg_type == "text" and text:
        # TODO: treat text as student identifier (register number or partial name)
        # TODO: fuzzy match against class student list, set session.context.current_student_id
        # TODO: confirm match with teacher before marking
        send_text(phone, f"Looking for student '{message.get('text', '')}' in your class... (TODO: implement fuzzy match)")
        return

    send_text(phone, "Send a student's book photo to mark it, or type 'done' to finish.")


def _handle_image_submission(session: Session, message: dict) -> None:
    """
    Full marking pipeline for an inbound WhatsApp image.
    TODO pipeline:
        1. quality_gate(image_bytes) → reject with specific message if fail
        2. run_ocr(image_bytes) → (full_text, bounding_boxes)
        3. load answer_key from Cosmos using session.context.answer_key_id
        4. grade_submission(full_text, answer_key, education_level) → verdicts
        5. annotate_image(image_bytes, bounding_boxes, verdicts) → annotated_bytes
        6. upload_marked(annotated_bytes) → marked_image_url
        7. upsert Mark document to Cosmos
        8. send_image(phone, marked_image_url, caption=score_summary)
    """
    # TODO: implement full pipeline — import these at top of file once confirmed working:
    # from shared.ocr_client import run_ocr
    # from shared.openai_client import check_image_quality, grade_submission
    # from shared.annotator import annotate_image
    # from shared.blob_client import upload_marked
    # from shared.cosmos_client import upsert_item, get_item

    phone = session.phone
    media_id = message.get("image", {}).get("id")

    if not media_id:
        send_text(phone, "Could not read the image. Please try sending it again.")
        return

    # TODO: Step 1 — download image bytes from WhatsApp media API using media_id
    # TODO: Step 2 — quality gate: check_image_quality(image_bytes)
    #               if not result.pass_check: send_text(phone, result.suggestion); return
    # TODO: Step 3 — upload raw scan: upload_scan(image_bytes)
    # TODO: Step 4 — OCR: run_ocr(image_bytes) → (full_text, bounding_boxes)
    # TODO: Step 5 — load answer key from Cosmos
    # TODO: Step 6 — grade: grade_submission(full_text, answer_key, education_level) → verdicts
    # TODO: Step 7 — annotate: annotate_image(image_bytes, bounding_boxes, verdicts) → annotated_bytes
    # TODO: Step 8 — upload annotated: upload_marked(annotated_bytes) → marked_image_url
    # TODO: Step 9 — write Mark to Cosmos
    # TODO: Step 10 — send_image(phone, marked_image_url, caption=f"Score: {score}/{max_score}")

    send_text(phone, "Image received. Marking pipeline not yet implemented.")


# ── STATE: ERROR ──────────────────────────────────────────────────────────────

def _handle_error(session: Session, message: dict) -> None:
    """
    Unrecoverable error state. Always include a recovery prompt.
    Any message from the teacher in this state → transition back to IDLE.
    """
    # TODO: log the error context stored in session for debugging
    phone = session.phone
    session.state = WhatsAppState.IDLE
    session.context = SessionContext()
    upsert_session(session.model_dump())
    send_text(phone, "Something went wrong. I've reset your session. Type 'menu' to start over or 'help' for options.")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_phone(body: dict) -> str | None:
    """Extract sender phone number from WhatsApp webhook payload."""
    # TODO: implement — navigate body["entry"][0]["changes"][0]["value"]["messages"][0]["from"]
    try:
        return body["entry"][0]["changes"][0]["value"]["messages"][0]["from"]
    except (KeyError, IndexError, TypeError):
        return None


def _extract_message(body: dict) -> dict | None:
    """Extract the first message object from the webhook payload."""
    # TODO: implement — same path as above but return the full message object
    try:
        return body["entry"][0]["changes"][0]["value"]["messages"][0]
    except (KeyError, IndexError, TypeError):
        return None


def _send_help_menu(phone: str) -> None:
    """Send the main help menu listing available commands."""
    # TODO: upgrade to WhatsApp interactive list message
    send_text(
        phone,
        "Hi! I'm Neriah, your AI marking assistant.\n\n"
        "Here's what I can do:\n"
        "• Type 'setup class' — create a new class\n"
        "• Type 'mark' — start marking books\n"
        "• Type 'answer key' — upload or generate a marking scheme\n\n"
        "What would you like to do?",
    )


def _send_education_level_menu(phone: str) -> None:
    """Send education level selection as a WhatsApp interactive list."""
    # TODO: implement using send_interactive_list
    send_text(
        phone,
        "What education level is this class?\n"
        "Reply with a number:\n"
        "1. Grade 1\n2. Grade 2\n3. Grade 3\n4. Grade 4\n"
        "5. Grade 5\n6. Grade 6\n7. Grade 7\n"
        "8. Form 1\n9. Form 2\n10. Form 3\n11. Form 4\n12. Form 5\n13. Form 6\n"
        "14. Tertiary",
    )
