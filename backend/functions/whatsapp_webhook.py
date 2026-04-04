# functions/whatsapp_webhook.py
# POST /api/whatsapp  — WhatsApp Cloud API webhook receiver.
# GET  /api/whatsapp  — Meta webhook verification challenge.
#
# This file implements the full WhatsApp conversation state machine.
# States: IDLE → CLASS_SETUP → AWAITING_REGISTER → AWAITING_ANSWER_KEY → MARKING_ACTIVE
# See CLAUDE.md Section 5 for the full state machine specification.
#
# Student submissions are handled separately from the teacher state machine:
#   - Structured format:  "NERIAH SUBMISSION\nClass: CODE\nStudent: Name\nAssignment: Title"
#   - Simple format:      "First Surname - Assignment Title"  (image + text, phone matched)

from __future__ import annotations

import logging
import re
from uuid import uuid4

import azure.functions as func
import httpx

from shared.cosmos_client import get_session, query_items, save_session, upsert_item
from shared.models import Session, SessionContext, Student, WhatsAppState
from shared.whatsapp_client import send_image, send_text

logger = logging.getLogger(__name__)

# ── WhatsApp media download ───────────────────────────────────────────────────

async def _download_wa_media(media_id: str) -> bytes | None:
    """Download image bytes from WhatsApp Cloud API using a media ID."""
    from shared.config import settings
    headers = {"Authorization": f"Bearer {settings.whatsapp_access_token}"}
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # Step 1: get download URL
            r = await client.get(
                f"https://graph.facebook.com/v19.0/{media_id}",
                headers=headers,
            )
            if r.status_code != 200:
                logger.error("_download_wa_media: URL fetch failed %d", r.status_code)
                return None
            url = r.json().get("url")
            if not url:
                return None
            # Step 2: download bytes
            r2 = await client.get(url, headers=headers)
            if r2.status_code != 200:
                logger.error("_download_wa_media: download failed %d", r2.status_code)
                return None
            return r2.content
    except Exception as exc:
        logger.error("_download_wa_media error: %s", exc)
        return None

bp = func.Blueprint()


# ── Public async handlers (called from function_app.py @app.route decorators) ─

async def handle_verification(req: func.HttpRequest) -> func.HttpResponse:
    """GET /api/whatsapp — Meta webhook verification challenge."""
    return _handle_verification(req)


async def handle_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """POST /api/whatsapp — inbound WhatsApp messages."""
    return await _handle_message(req)


# ── HTTP trigger ──────────────────────────────────────────────────────────────

@bp.route(route="whatsapp", methods=["GET", "POST"])
async def whatsapp_webhook(req: func.HttpRequest) -> func.HttpResponse:
    """
    Entry point for all inbound WhatsApp messages.
    GET:  webhook verification (Meta sends hub.challenge, we echo it back)
    POST: inbound message — parse, load session, route to state handler
    """
    if req.method == "GET":
        return _handle_verification(req)
    return await _handle_message(req)


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

async def _handle_message(req: func.HttpRequest) -> func.HttpResponse:
    """
    Parse the inbound message payload.
    First checks if the message is a student submission; if not, routes through
    the teacher state machine.
    Always returns 200 to prevent WhatsApp retries.
    """
    try:
        body = req.get_json()
        phone = _extract_phone(body)
        message = _extract_message(body)

        if not phone or not message:
            return func.HttpResponse("OK", status_code=200)

        # Student submissions are intercepted before the teacher state machine
        if await _try_student_submission(phone, message):
            return func.HttpResponse("OK", status_code=200)

        session_doc = get_session(phone)
        if session_doc:
            session = Session(**session_doc)
        else:
            session = Session(id=phone, phone=phone)

        _dispatch(session, message)
        return func.HttpResponse("OK", status_code=200)

    except Exception as e:
        logger.exception("Unhandled error in whatsapp_webhook: %s", e)
        return func.HttpResponse("OK", status_code=200)


async def _try_student_submission(phone: str, message: dict) -> bool:
    """
    Intercept inbound messages that look like student homework submissions.
    Returns True if the message was handled as a submission (caller should not process further).

    Two formats accepted:
      Structured: caption starts with "NERIAH SUBMISSION"
      Simple:     image with "First Surname - Assignment Title" caption, phone registered as student
    """
    msg_type = message.get("type")
    if msg_type != "image":
        return False

    caption: str = (message.get("image", {}).get("caption") or "").strip()
    media_id: str = message.get("image", {}).get("id", "")

    # ── Structured format ─────────────────────────────────────────────────────
    if caption.upper().startswith("NERIAH SUBMISSION"):
        return await _handle_structured_submission(phone, caption, media_id)

    # ── Simple format: phone must be a registered student ─────────────────────
    student_docs = await query_items(
        "students",
        "SELECT * FROM c WHERE c.phone = @phone",
        [{"name": "@phone", "value": phone}],
    )
    if not student_docs:
        return False  # not a registered student — let teacher state machine handle

    # Need "Name - Assignment" format
    dash_match = re.match(r"^(.+?)\s+-\s+(.+)$", caption)
    if not dash_match:
        return False  # can't parse assignment, fall through to teacher flow

    student = student_docs[0]
    assignment_title = dash_match.group(2).strip()
    return await _process_student_submission(
        phone=phone,
        student=student,
        assignment_title=assignment_title,
        media_id=media_id,
    )


async def _handle_structured_submission(
    phone: str, caption: str, media_id: str
) -> bool:
    """Parse and process a NERIAH SUBMISSION structured caption."""
    lines = {
        k.strip().lower(): v.strip()
        for line in caption.splitlines()
        if ":" in line
        for k, v in [line.split(":", 1)]
    }
    join_code = lines.get("class", "").upper()
    student_name = lines.get("student", "")
    assignment_title = lines.get("assignment", "")

    # Validate we have all fields
    name_parts = student_name.split()
    if len(name_parts) < 2:
        send_text(phone, _bad_format_reply())
        return True

    if not join_code or not assignment_title:
        send_text(phone, _bad_format_reply())
        return True

    # Look up class by join code
    class_docs = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.join_code = @code",
        [{"name": "@code", "value": join_code}],
    )
    if not class_docs:
        send_text(phone, _bad_format_reply("Invalid class code. Check your code and try again."))
        return True
    cls = class_docs[0]

    # Match student: phone first, then name fuzzy match, then auto-create
    student = await _resolve_student(phone, student_name, cls)
    if student is None:
        send_text(phone, _bad_format_reply("Could not match your name to a student in this class."))
        return True

    return await _process_student_submission(
        phone=phone,
        student=student,
        assignment_title=assignment_title,
        media_id=media_id,
        class_override=cls,
        notify_teacher_new_student=student.get("_auto_created", False),
    )


async def _resolve_student(
    phone: str, full_name: str, cls: dict
) -> dict | None:
    """
    Match a student in the class by:
      1. Phone number match
      2. Case-insensitive first_name + surname match
      3. Auto-create with the provided name (flagged for teacher review)
    """
    class_id = cls["id"]

    # 1. Phone match
    phone_match = await query_items(
        "students",
        "SELECT * FROM c WHERE c.class_id = @cid AND c.phone = @phone",
        [{"name": "@cid", "value": class_id}, {"name": "@phone", "value": phone}],
        partition_key=class_id,
    )
    if phone_match:
        return phone_match[0]

    # 2. Name match (case-insensitive)
    name_parts = full_name.strip().split()
    first = name_parts[0].lower()
    surname = " ".join(name_parts[1:]).lower()
    class_students = await query_items(
        "students",
        "SELECT * FROM c WHERE c.class_id = @cid",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    for s in class_students:
        if (
            s.get("first_name", "").lower() == first
            and s.get("surname", "").lower() == surname
        ):
            return s

    # 3. Auto-create
    new_id = str(uuid4())
    new_student = Student(
        id=new_id,
        class_id=class_id,
        first_name=name_parts[0],
        surname=" ".join(name_parts[1:]),
        phone=phone,
    )
    doc = new_student.model_dump(mode="json")
    doc["_auto_created"] = True  # ephemeral flag for push notification
    await upsert_item("students", doc)

    # Add to class student_ids
    class_doc = dict(cls)
    student_ids: list = class_doc.get("student_ids") or []
    if new_id not in student_ids:
        student_ids.append(new_id)
        class_doc["student_ids"] = student_ids
        await upsert_item("classes", class_doc)

    logger.info("_resolve_student: auto-created student %s for class %s", new_id, class_id)
    return doc


async def _process_student_submission(
    phone: str,
    student: dict,
    assignment_title: str,
    media_id: str,
    class_override: dict | None = None,
    notify_teacher_new_student: bool = False,
) -> bool:
    """
    Run the marking pipeline for a WhatsApp student submission.
    Sets source="whatsapp", approved=False (teacher must review).
    Returns True (always — message was handled regardless of outcome).
    """
    from datetime import datetime

    from shared.annotator import annotate_image
    from shared.blob_client import generate_sas_url, upload_bytes, upload_marked
    from shared.config import settings
    from shared.models import Mark
    from shared.ocr_client import run_ocr
    from shared.openai_client import check_image_quality, grade_submission
    from shared.push_client import send_push_notification

    class_id = student.get("class_id", "")
    student_id = student.get("id", "")
    student_name = f"{student.get('first_name', '')} {student.get('surname', '')}".strip()

    # Load class if not provided
    if class_override:
        cls = class_override
    else:
        class_docs = await query_items(
            "classes",
            "SELECT * FROM c WHERE c.id = @id",
            [{"name": "@id", "value": class_id}],
        )
        cls = class_docs[0] if class_docs else {}

    teacher_id = cls.get("teacher_id", "")
    education_level = cls.get("education_level", "grade_7")

    # Find the answer key by title (fuzzy, case-insensitive)
    answer_keys = await query_items(
        "answer_keys",
        "SELECT * FROM c WHERE c.class_id = @cid AND c.open_for_submission = true",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    matched_ak = None
    title_lower = assignment_title.lower()
    for ak in answer_keys:
        ak_title = (ak.get("title") or ak.get("subject") or "").lower()
        if title_lower in ak_title or ak_title in title_lower:
            matched_ak = ak
            break

    if not matched_ak:
        send_text(
            phone,
            f"Assignment '{assignment_title}' was not found or is not accepting submissions. "
            "Check the assignment title and try again.",
        )
        return True

    # Download image
    image_bytes = await _download_wa_media(media_id)
    if not image_bytes:
        send_text(phone, "Could not download your image. Please try sending it again.")
        return True

    # Quality gate
    try:
        quality = await check_image_quality(image_bytes)
        if not quality.pass_check:
            send_text(phone, quality.suggestion or "The photo quality is too low. Please retake and resubmit.")
            return True
    except Exception as exc:
        logger.warning("_process_student_submission: quality gate error: %s", exc)

    try:
        # Upload raw scan
        scan_blob = f"{teacher_id}/{class_id}/{student_id}/wa_{uuid4()}.jpg"
        await upload_bytes(image_bytes, scan_blob, container_name=settings.azure_storage_container_scans)

        # OCR
        ocr_result = await run_ocr(image_bytes)
        ocr_text = ocr_result.full_text if hasattr(ocr_result, "full_text") else str(ocr_result)
        bounding_boxes = ocr_result.bounding_boxes if hasattr(ocr_result, "bounding_boxes") else None

        # Grade
        from shared.models import AnswerKey
        answer_key = AnswerKey(**matched_ak)
        verdicts = await grade_submission(ocr_text, answer_key, education_level)

        # Annotate
        annotated_bytes = None
        if bounding_boxes:
            try:
                annotated_bytes = await annotate_image(image_bytes, bounding_boxes, verdicts)
            except Exception as exc:
                logger.warning("_process_student_submission: annotation failed: %s", exc)

        # Upload annotated
        marked_image_url = None
        if annotated_bytes:
            marked_blob = f"{teacher_id}/{class_id}/{student_id}/wa_marked_{uuid4()}.jpg"
            await upload_marked(annotated_bytes, marked_blob)
            marked_image_url = generate_sas_url(
                settings.azure_storage_container_marked, marked_blob, expiry_hours=24 * 365
            )

        score = sum(v.awarded_marks for v in verdicts)
        max_score = sum(q.max_marks for q in answer_key.questions)

        mark = Mark(
            teacher_id=teacher_id,
            student_id=student_id,
            answer_key_id=matched_ak["id"],
            class_id=class_id,
            score=score,
            max_score=max_score,
            percentage=round(score / max_score * 100, 2) if max_score else None,
            marked_image_url=marked_image_url,
            raw_ocr_text=ocr_text,
            source="whatsapp",
            approved=False,
        )
        await upsert_item("marks", mark.model_dump(mode="json"))

        send_text(
            phone,
            "Submission received! Your teacher will review and grade it. "
            "You'll be notified when your results are ready.",
        )

        # Notify teacher
        teacher_docs = await query_items(
            "teachers",
            "SELECT c.push_token, c.first_name FROM c WHERE c.id = @id",
            [{"name": "@id", "value": teacher_id}],
        )
        if teacher_docs and teacher_docs[0].get("push_token"):
            ak_title = matched_ak.get("title") or matched_ak.get("subject", "assignment")
            msg = f"New submission" if not notify_teacher_new_student else "New student auto-registered"
            await send_push_notification(
                teacher_docs[0]["push_token"],
                title=msg,
                body=f"{student_name} submitted {ak_title}",
                data={"mark_id": mark.id, "class_id": class_id},
            )

    except Exception as exc:
        logger.exception("_process_student_submission: pipeline error: %s", exc)
        send_text(phone, "There was an error processing your submission. Please try again.")

    return True


def _bad_format_reply(reason: str = "") -> str:
    prefix = f"{reason}\n\n" if reason else ""
    return (
        f"{prefix}Please resend your photo with this caption:\n\n"
        "NERIAH SUBMISSION\n"
        "Class: YOUR-CLASS-CODE\n"
        "Student: FirstName Surname\n"
        "Assignment: Assignment-Title"
    )


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
    save_session(session.model_dump())
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
