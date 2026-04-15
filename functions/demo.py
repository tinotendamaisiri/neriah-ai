"""
Demo-only endpoints.

All routes in this blueprint are guarded by is_demo(). They will return 403
if NERIAH_ENV != "demo", so it is safe to register this blueprint in all
deployments — the routes just won't do anything in production.

Routes
------
POST /api/demo/reset         — wipe + re-seed demo Firestore + GCS
POST /api/demo/student-token — return a signed JWT for demo-student-1
POST /api/demo/grade         — create pre-canned grading result without AI
"""

from __future__ import annotations

import logging
import random
import string
import uuid
from datetime import datetime, timezone

import io

from flask import Blueprint, jsonify, request
from PIL import Image as PILImage, ImageDraw

from shared.auth import create_jwt, hash_pin, verify_pin
from shared.config import is_demo, settings
from shared.firestore_client import delete_doc, get_db, get_doc, query, upsert
from shared.user_context import get_user_context

logger = logging.getLogger(__name__)
demo_bp = Blueprint("demo", __name__)

# ── Seed data (mirrors scripts/seed_demo.py) ──────────────────────────────────

DEMO_TEACHER_ID  = "demo-teacher-1"
DEMO_STUDENT_ID  = "demo-student-1"
DEMO_CLASS_ID    = "demo-class-1"
DEMO_SCHOOL_ID   = "demo-school-1"
DEMO_HW_ID       = "demo-homework-1"

_DEMO_QUESTIONS = [
    {"question_number": 1, "question_text": "Solve for x: 2x + 5 = 11",          "answer": "x = 3",   "marks": 2},
    {"question_number": 2, "question_text": "What is 15% of 200?",                "answer": "30",      "marks": 2},
    {"question_number": 3, "question_text": "Area of rectangle 8cm × 5cm",        "answer": "40 cm²",  "marks": 2},
    {"question_number": 4, "question_text": "Simplify 3(2x+4) − 2(x−1)",         "answer": "4x + 14", "marks": 2},
    {"question_number": 5, "question_text": "Probability of red (3 red, 7 blue)", "answer": "3/10",    "marks": 2},
]

_DEMO_VERDICTS = [
    {"question_number": 1, "correct": True,  "awarded_marks": 2, "feedback": "Correct — x = 3"},
    {"question_number": 2, "correct": True,  "awarded_marks": 2, "feedback": "Correct — 30"},
    {"question_number": 3, "correct": True,  "awarded_marks": 2, "feedback": "Correct — 40 cm²"},
    {"question_number": 4, "correct": False, "awarded_marks": 0, "feedback": "Expected 4x + 14, got 4x + 12"},
    {"question_number": 5, "correct": False, "awarded_marks": 1, "feedback": "Partial credit — 3/10 accepted"},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _guard() -> bool:
    """Return True (forbidden) when not in demo mode."""
    return not is_demo()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _wipe_collection(collection: str) -> int:
    """Delete every document in a Firestore collection. Returns count deleted."""
    db = get_db()
    batch_size = 400
    deleted = 0
    while True:
        docs = list(db.collection(collection).limit(batch_size).stream())
        if not docs:
            break
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        deleted += len(docs)
    return deleted


def _wipe_gcs_bucket(bucket_name: str) -> int:
    """Delete every blob in a GCS bucket. Returns count deleted."""
    try:
        from google.cloud import storage
        client = storage.Client(project=settings.GCP_PROJECT_ID)
        bucket = client.bucket(bucket_name)
        blobs = list(bucket.list_blobs())
        bucket.delete_blobs(blobs)
        return len(blobs)
    except Exception:
        logger.exception("Failed to wipe GCS bucket %s", bucket_name)
        return 0


_ZIMSEC_FORM2_MATHS = """
ZIMSEC Form 2 Mathematics Syllabus — Key Topics

Algebra
Linear equations with one unknown: solve by isolating the variable.
Simultaneous equations: substitution and elimination methods.
Inequalities: represent on a number line; flip sign when multiplying/dividing by negative.
Factorisation: common factors, difference of two squares, trinomials.

Arithmetic
Percentages: convert to fraction, apply to amounts.
Ratio and proportion: cross-multiplication.
Profit and loss: percentage profit = (profit/cost price) × 100.

Geometry
Area of rectangles, triangles, circles: formulae must be memorised.
Volume of cuboids and cylinders.
Angles in parallel lines: corresponding, alternate, co-interior.

Statistics and Probability
Probability: P(event) = favourable outcomes / total outcomes.
Mean, median, mode from grouped and ungrouped data.
Frequency tables and histograms.

Marking Conventions (ZIMSEC O-Level)
- Method marks (M): awarded for correct method even if arithmetic error.
- Accuracy marks (A): awarded only when the method is correct and the answer is correct.
- Follow-through marks (ft): if answer carries from previous wrong answer, award if method correct.
- Show all working — unsupported answers receive 0.
"""

_DEMO_GRADING_EXAMPLES = [
    {
        "text": (
            "Subject: Mathematics\nEducation Level: Form 2\nCurriculum: ZIMSEC\n"
            "Question: Solve for x: 2x + 5 = 11\n"
            "Correct Answer: x = 3\n"
            "Student Answer: 2x = 11-5, 2x = 6, x = 3\n"
            "Verdict: correct\nScore: 2/2\n"
            "Teacher Feedback: Full working shown — method and accuracy marks awarded.\n"
            "Teacher Override: False"
        ),
        "metadata": {
            "subject": "Mathematics", "education_level": "form_2",
            "curriculum": "ZIMSEC", "verdict": "correct", "teacher_override": False,
        },
    },
    {
        "text": (
            "Subject: Mathematics\nEducation Level: Form 2\nCurriculum: ZIMSEC\n"
            "Question: What is 15% of 200?\n"
            "Correct Answer: 30\n"
            "Student Answer: 15/100 × 200 = 30\n"
            "Verdict: correct\nScore: 2/2\n"
            "Teacher Feedback: Correct method and answer.\nTeacher Override: False"
        ),
        "metadata": {
            "subject": "Mathematics", "education_level": "form_2",
            "curriculum": "ZIMSEC", "verdict": "correct", "teacher_override": False,
        },
    },
    {
        "text": (
            "Subject: Mathematics\nEducation Level: Form 2\nCurriculum: ZIMSEC\n"
            "Question: Simplify 3(2x+4) − 2(x−1)\n"
            "Correct Answer: 4x + 14\n"
            "Student Answer: 6x+12-2x-2 = 4x+10\n"
            "Verdict: partial\nScore: 1/2\n"
            "Teacher Feedback: Correct expansion of 3(2x+4) but sign error in -2(x-1).\n"
            "Teacher Override: False"
        ),
        "metadata": {
            "subject": "Mathematics", "education_level": "form_2",
            "curriculum": "ZIMSEC", "verdict": "partial", "teacher_override": False,
        },
    },
    {
        "text": (
            "Subject: Mathematics\nEducation Level: Form 2\nCurriculum: ZIMSEC\n"
            "Question: Area of rectangle 8cm × 5cm\n"
            "Correct Answer: 40 cm²\n"
            "Student Answer: 8+5 = 13\n"
            "Verdict: incorrect\nScore: 0/2\n"
            "Teacher Feedback: Used addition instead of multiplication for area.\n"
            "Teacher Override: False"
        ),
        "metadata": {
            "subject": "Mathematics", "education_level": "form_2",
            "curriculum": "ZIMSEC", "verdict": "incorrect", "teacher_override": False,
        },
    },
    {
        "text": (
            "Subject: Mathematics\nEducation Level: Form 2\nCurriculum: ZIMSEC\n"
            "Question: Probability of drawing red (3 red, 7 blue)\n"
            "Correct Answer: 3/10\n"
            "Student Answer: 3 out of 10 = 3/10\n"
            "Verdict: correct\nScore: 2/2\n"
            "Teacher Feedback: Correct — stated ratio and fractional form both accepted.\n"
            "Teacher Override: False"
        ),
        "metadata": {
            "subject": "Mathematics", "education_level": "form_2",
            "curriculum": "ZIMSEC", "verdict": "correct", "teacher_override": False,
        },
    },
]


def _seed_rag() -> None:
    """
    Seed the demo vector DB with ZIMSEC Form 2 Maths syllabus context and
    pre-built grading examples.  Fails silently — never interrupts demo reset.
    """
    try:
        from shared.vector_db import store_document  # noqa: PLC0415

        # Syllabus chunks
        chunks = [c.strip() for c in _ZIMSEC_FORM2_MATHS.strip().split("\n\n") if c.strip()]
        for i, chunk in enumerate(chunks):
            store_document(
                "syllabuses",
                f"demo-zimsec-form2-maths-chunk-{i}",
                f"[ZIMSEC Mathematics form_2]\nCountry: Zimbabwe\n\n{chunk}",
                {
                    "country": "Zimbabwe", "curriculum": "ZIMSEC",
                    "subject": "Mathematics", "education_level": "form_2",
                    "year": "2026", "syllabus_id": "demo-zimsec-form2-maths",
                    "doc_type": "syllabus", "chunk_index": i,
                    "source_filename": "demo_zimsec_form2_maths.txt",
                },
            )

        # Grading examples
        for i, ex in enumerate(_DEMO_GRADING_EXAMPLES):
            store_document(
                "grading_examples",
                f"demo-grading-example-{i}",
                ex["text"],
                ex["metadata"],
            )

        logger.info("[demo] RAG seed complete: %d syllabus chunks, %d grading examples",
                    len(chunks), len(_DEMO_GRADING_EXAMPLES))
    except Exception:
        logger.exception("[demo] RAG seed failed — non-fatal")


def _seed() -> dict:
    """Populate demo Firestore with baseline data. Returns counts."""
    now = _now()

    # School
    upsert("schools", DEMO_SCHOOL_ID, {
        "id": DEMO_SCHOOL_ID, "name": "Greendale Primary School",
        "city": "Harare", "country": "Zimbabwe",
        "subscription_active": True, "created_at": now,
    })

    # Teacher
    upsert("teachers", DEMO_TEACHER_ID, {
        "id": DEMO_TEACHER_ID, "phone": "+1234567890",
        "name": "Mr. Maisiri", "title": "Mr",
        "school_id": DEMO_SCHOOL_ID, "school_name": "Greendale Primary School",
        "role": "teacher", "token_version": 0, "created_at": now,
    })

    # Class
    upsert("classes", DEMO_CLASS_ID, {
        "id": DEMO_CLASS_ID, "name": "Form 2A", "subject": "Mathematics",
        "curriculum": "ZIMSEC", "education_level": "form_2",
        "teacher_id": DEMO_TEACHER_ID, "school_id": DEMO_SCHOOL_ID,
        "student_count": 1, "created_at": now,
    })

    # Student
    upsert("students", DEMO_STUDENT_ID, {
        "id": DEMO_STUDENT_ID, "name": "Tendai Moyo",
        "phone": "+0987654321", "role": "student",
        "school_id": DEMO_SCHOOL_ID, "class_id": DEMO_CLASS_ID,
        "token_version": 0, "created_at": now,
    })

    # Pre-built homework (answer key) with marking scheme
    upsert("answer_keys", DEMO_HW_ID, {
        "id": DEMO_HW_ID, "class_id": DEMO_CLASS_ID,
        "teacher_id": DEMO_TEACHER_ID,
        "title": "Maths Chapter 5 Test",
        "education_level": "form_2", "subject": "Mathematics",
        "questions": _DEMO_QUESTIONS,
        "open_for_submission": True,
        "status": "active", "ai_generated": True,
        "created_at": now, "updated_at": now,
    })

    return {"schools": 1, "teachers": 1, "classes": 1, "students": 1, "answer_keys": 1}


# ── POST /api/demo/reset ──────────────────────────────────────────────────────

@demo_bp.post("/demo/reset")
def demo_reset():
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    logger.info("[demo] Reset requested")

    # Wipe Firestore collections
    collections = [
        "teachers", "students", "classes", "answer_keys",
        "marks", "submissions", "sessions", "otp_verifications",
        "ip_rate_limits", "schools",
        # RAG collections
        "rag_syllabuses", "rag_grading_examples",
    ]
    wiped: dict[str, int] = {}
    for col in collections:
        wiped[col] = _wipe_collection(col)
        logger.info("[demo] Wiped %d docs from %s", wiped[col], col)

    # Wipe GCS demo buckets
    gcs_wiped: dict[str, int] = {}
    for bucket_env, bucket_label in [
        (settings.GCS_BUCKET_SCANS,       "scans"),
        (settings.GCS_BUCKET_MARKED,      "marked"),
        (settings.GCS_BUCKET_SUBMISSIONS, "submissions"),
    ]:
        gcs_wiped[bucket_label] = _wipe_gcs_bucket(bucket_env)

    # Clear ChromaDB in-memory cache
    try:
        from shared.vector_db import clear_chroma_cache  # noqa: PLC0415
        clear_chroma_cache()
    except Exception:
        logger.warning("[demo] ChromaDB cache clear failed — non-fatal")

    # Re-seed Firestore + vector DB
    seeded = _seed()
    _seed_rag()

    logger.info("[demo] Reset complete — seeded %s", seeded)
    return jsonify({
        "status": "reset",
        "message": "Demo data has been reset",
        "wiped": wiped,
        "gcs_wiped": gcs_wiped,
        "seeded": seeded,
    }), 200


# ── POST /api/demo/student-token ──────────────────────────────────────────────

@demo_bp.post("/demo/student-token")
def demo_student_token():
    """Return a signed JWT for the pre-seeded demo student (no OTP required)."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    student = {
        "id": DEMO_STUDENT_ID, "name": "Tendai Moyo",
        "phone": "+0987654321", "role": "student",
        "class_id": DEMO_CLASS_ID, "school_id": DEMO_SCHOOL_ID,
    }
    token = create_jwt(DEMO_STUDENT_ID, "student", 0)
    return jsonify({"token": token, "user": student}), 200


# ── POST /api/demo/grade ──────────────────────────────────────────────────────

@demo_bp.post("/demo/grade")
def demo_grade():
    """
    Create a pre-canned grading result in Firestore without running AI inference.
    Body: { answer_key_id: str }
    Returns the created mark document.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    answer_key_id = (body.get("answer_key_id") or DEMO_HW_ID).strip()
    submission_id = body.get("submission_id") or str(uuid.uuid4())

    # Resolve and log the demo user context so RAG injection is visible in logs.
    # This mirrors what real endpoints do — the demo teacher profile maps to
    # country=Zimbabwe, curriculum=ZIMSEC, subject=Mathematics, level=form_2.
    demo_ctx = get_user_context(DEMO_TEACHER_ID, "teacher", class_id=DEMO_CLASS_ID)
    logger.info("[demo] grade context: %s", demo_ctx)

    mark_id = str(uuid.uuid4())
    now = _now()
    score = sum(v["awarded_marks"] for v in _DEMO_VERDICTS)
    max_score = sum(q["marks"] for q in _DEMO_QUESTIONS)

    mark_doc = {
        "id": mark_id,
        "student_id": DEMO_STUDENT_ID,
        "teacher_id": DEMO_TEACHER_ID,
        "class_id": DEMO_CLASS_ID,
        "answer_key_id": answer_key_id,
        "submission_id": submission_id,
        "score": score,
        "max_score": max_score,
        "percentage": round((score / max_score) * 100, 1),
        "verdicts": _DEMO_VERDICTS,
        "approved": False,
        "source": "demo",
        "created_at": now,
        "updated_at": now,
    }
    upsert("marks", mark_id, mark_doc)

    # Update submission status if it exists
    try:
        from shared.firestore_client import get_doc
        sub_doc = get_doc("submissions", submission_id)
        if sub_doc:
            upsert("submissions", submission_id, {
                "status": "graded", "mark_id": mark_id, "updated_at": now,
            })
    except Exception:
        pass

    logger.info("[demo] Created pre-canned mark %s (%.0f%%)", mark_id, mark_doc["percentage"])
    return jsonify(mark_doc), 201


# ── POST /api/demo/ai-grade ──────────────────────────────────────────────────

@demo_bp.post("/demo/ai-grade")
def demo_ai_grade():
    """
    Real AI grading for the web demo — accepts a question paper image and runs
    the full grade_submission pipeline with demo user context injected.

    Unlike /api/demo/grade (pre-canned), this calls Gemma and returns live verdicts.
    Requires NERIAH_ENV=demo.

    Body (multipart/form-data):
        image        — JPEG / PNG of the student's work
        answer_key_id — optional; defaults to DEMO_HW_ID
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    image_file = request.files.get("image")
    if not image_file:
        return jsonify({"error": "image file is required"}), 400

    image_file.seek(0, 2)
    if image_file.tell() > 10 * 1024 * 1024:
        return jsonify({"error": "Image too large (max 10 MB)"}), 413
    image_file.seek(0)
    image_bytes = image_file.read()

    answer_key_id = (request.form.get("answer_key_id") or DEMO_HW_ID).strip()

    # Fetch demo answer key
    answer_key = get_doc("answer_keys", answer_key_id) or {
        "questions": _DEMO_QUESTIONS,
        "education_level": "form_2",
        "subject": "Mathematics",
        "class_id": DEMO_CLASS_ID,
    }
    education_level = answer_key.get("education_level", "form_2")

    # Build demo user context (country=Zimbabwe, curriculum=ZIMSEC, subject=Mathematics)
    demo_ctx = get_user_context(DEMO_TEACHER_ID, "teacher", class_id=DEMO_CLASS_ID)
    logger.info("[demo/ai-grade] context: %s", demo_ctx)

    try:
        from shared.gemma_client import check_image_quality, grade_submission  # noqa: PLC0415
        from shared.models import GradingVerdict  # noqa: PLC0415

        quality = check_image_quality(image_bytes)
        if not quality.get("pass", True):
            reason = quality.get("reason", "")
            return jsonify({"error": "image_quality_rejected", "message": reason}), 422

        raw_verdicts = grade_submission(
            image_bytes, answer_key, education_level, user_context=demo_ctx,
        )
        verdicts = [GradingVerdict(**v) for v in raw_verdicts if isinstance(v, dict)]
        score     = sum(v.awarded_marks for v in verdicts)
        max_score = sum(v.max_marks for v in verdicts) or float(
            answer_key.get("total_marks", len(_DEMO_QUESTIONS) * 2)
        )
        percentage = round(score / max_score * 100, 1) if max_score else 0.0

        logger.info("[demo/ai-grade] %.0f%% (%s/%s)", percentage, score, max_score)
        return jsonify({
            "score": score,
            "max_score": max_score,
            "percentage": percentage,
            "verdicts": [v.model_dump() for v in verdicts],
            "context_injected": demo_ctx,
        }), 200

    except Exception:
        logger.exception("[demo/ai-grade] AI grading failed — falling back to pre-canned")
        score     = sum(v["awarded_marks"] for v in _DEMO_VERDICTS)
        max_score = sum(q["marks"] for q in _DEMO_QUESTIONS)
        return jsonify({
            "score": score,
            "max_score": max_score,
            "percentage": round(score / max_score * 100, 1),
            "verdicts": _DEMO_VERDICTS,
            "context_injected": demo_ctx,
            "fallback": True,
        }), 200


# ── POST /api/demo/teacher/assistant ─────────────────────────────────────────

_DEMO_ASSISTANT_HOMEWORK = {
    "title": "ZIMSEC Form 2 Mathematics — Algebra",
    "instructions": "Show all working. Marks are awarded for correct method even if the final answer is wrong.",
    "questions": [
        {"number": 1, "question": "Solve for x: 2x + 5 = 11", "marks": 2},
        {"number": 2, "question": "Factorise completely: x² − 9", "marks": 2},
        {"number": 3, "question": "Expand and simplify: 3(2x + 4) − 2(x − 1)", "marks": 3},
        {"number": 4, "question": "Solve the simultaneous equations: x + y = 7 and 2x − y = 5", "marks": 3},
    ],
    "total_marks": 10,
    "due_suggestion": "3 days",
}

_DEMO_ASSISTANT_QUIZ = {
    "title": "ZIMSEC Form 2 Maths — Fractions & Percentages Quiz",
    "questions": [
        {
            "number": 1,
            "question": "What is 1/2 + 1/4?",
            "options": {"a": "3/4", "b": "1/2", "c": "2/6", "d": "1"},
            "correct_answer": "a",
            "marks": 1,
        },
        {
            "number": 2,
            "question": "What is 15% of 200?",
            "options": {"a": "15", "b": "20", "c": "30", "d": "40"},
            "correct_answer": "c",
            "marks": 1,
        },
        {
            "number": 3,
            "question": "Which fraction is equivalent to 0.75?",
            "options": {"a": "1/4", "b": "3/4", "c": "7/5", "d": "2/3"},
            "correct_answer": "b",
            "marks": 1,
        },
        {
            "number": 4,
            "question": "A jacket costs $80. It is discounted by 25%. What is the sale price?",
            "options": {"a": "$55", "b": "$60", "c": "$65", "d": "$70"},
            "correct_answer": "b",
            "marks": 2,
        },
    ],
    "total_marks": 5,
}

_DEMO_ASSISTANT_RESPONSES: dict = {
    "chat": {
        "action_type": "chat",
        "response": (
            "Great question! When explaining fractions to Form 2 students, "
            "start with visual models — pizza slices, number lines, and grid paper work well. "
            "Then connect to real-world ZIMSEC contexts: market prices (half a dollar), "
            "recipe measurements, and land divisions. "
            "Always have students shade diagrams before moving to symbolic notation."
        ),
    },
    "create_homework": {
        "action_type": "create_homework",
        "structured": _DEMO_ASSISTANT_HOMEWORK,
        "exportable": True,
    },
    "create_quiz": {
        "action_type": "create_quiz",
        "structured": _DEMO_ASSISTANT_QUIZ,
        "exportable": True,
    },
    "prepare_notes": {
        "action_type": "prepare_notes",
        "structured": {
            "title": "Form 2 Mathematics — Linear Equations",
            "objectives": [
                "Solve linear equations with one unknown",
                "Verify solutions by substitution",
                "Apply equations to real-world word problems",
            ],
            "sections": [
                {
                    "heading": "What is a Linear Equation?",
                    "content": "A linear equation has the form ax + b = c, where x is the unknown. "
                               "The goal is to isolate x on one side of the equation.",
                    "key_points": [
                        "Perform the same operation on both sides",
                        "Collect like terms before solving",
                        "Always verify your answer by substituting back",
                    ],
                },
                {
                    "heading": "Worked Example",
                    "content": "Solve 2x + 5 = 11\nStep 1: 2x = 11 − 5 = 6\nStep 2: x = 6 ÷ 2 = 3\nCheck: 2(3) + 5 = 11 ✓",
                    "key_points": ["Subtract 5 from both sides", "Divide both sides by 2"],
                },
            ],
        },
    },
    "teaching_methods": {
        "action_type": "teaching_methods",
        "response": (
            "Evidence-based teaching strategies for Form 2 Mathematics (ZIMSEC):\n\n"
            "1. **Socratic questioning** — ask 'Why?' and 'How do you know?' instead of "
            "accepting the first answer. Builds critical thinking.\n\n"
            "2. **Peer learning pairs** — seat stronger students next to those who are "
            "struggling. Explaining a concept reinforces the teacher's understanding too.\n\n"
            "3. **5-minute entry tasks** — begin every lesson with a short problem from the "
            "previous lesson. Activates prior knowledge and reveals gaps immediately.\n\n"
            "4. **Visual concept maps** — have students draw connections between topics "
            "(e.g., fractions → decimals → percentages). Effective for kinaesthetic learners.\n\n"
            "5. **Real-world contexts** — Zimbabwe examples (EcoCash transactions, "
            "crop yields, market prices) make abstract algebra immediately relevant."
        ),
    },
    "exam_questions": {
        "action_type": "exam_questions",
        "structured": {
            "title": "ZIMSEC Form 2 Mathematics — End of Term Examination",
            "questions": [
                {
                    "number": 1,
                    "question": "Solve for x: 3x − 7 = 14",
                    "marks": 2,
                    "mark_scheme": "3x = 21 (M1); x = 7 (A1)",
                },
                {
                    "number": 2,
                    "question": "Factorise: x² + 5x + 6",
                    "marks": 2,
                    "mark_scheme": "(x + 2)(x + 3) — award M1 for correct method, A1 for correct factors",
                },
                {
                    "number": 3,
                    "question": "A rectangle has length (2x + 3) cm and width (x − 1) cm. "
                                "Write an expression for the perimeter and simplify.",
                    "marks": 3,
                    "mark_scheme": "Perimeter = 2(2x+3) + 2(x−1) (M1); = 4x+6+2x−2 (M1); = 6x + 4 cm (A1)",
                },
            ],
            "total_marks": 7,
        },
        "exportable": False,
    },
}


@demo_bp.post("/demo/teacher/assistant")
def demo_teacher_assistant():
    """
    Teacher AI assistant for the web demo.
    Returns pre-canned structured responses for most action types, but pulls
    class context from real demo Firestore data — no hardcoded class context.
    For class_performance: returns real Firestore stats (or no-data guidance).
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body        = request.get_json(silent=True) or {}
    action_type = (body.get("action_type") or "chat").strip().lower()
    curriculum  = body.get("curriculum") or "ZIMSEC"
    level       = body.get("level") or "Form 2"
    file_data   = (body.get("file_data") or "").strip()
    media_type  = (body.get("media_type") or "").strip().lower()

    # ── extract_students: return pre-canned roster for bulk import UI ─────────────
    if action_type == "extract_students":
        students = [
            {"first_name": "Tendai",   "surname": "Moyo"},
            {"first_name": "Chipo",    "surname": "Dube"},
            {"first_name": "Takudzwa", "surname": "Ncube"},
            {"first_name": "Blessing", "surname": "Chivanda"},
            {"first_name": "Farai",    "surname": "Gumbo"},
        ]
        logger.info("[demo/teacher/assistant] extract_students: returning %d demo students", len(students))
        return jsonify({
            "action_type":     "extract_students",
            "students":        students,
            "conversation_id": f"demo-conv-{uuid.uuid4().hex[:8]}",
        }), 200

    # ── Fetch real class context from demo Firestore ──────────────────────────
    from functions.teacher_assistant import get_teacher_context_data  # noqa: PLC0415
    needs_marks  = action_type == "class_performance"
    teacher_ctx  = get_teacher_context_data(
        DEMO_TEACHER_ID,
        include_marks=needs_marks,
    )
    logger.info(
        "[demo/teacher/assistant] action_type=%s has_data=%s include_marks=%s",
        action_type, teacher_ctx.get("has_data"), needs_marks,
    )

    # ── class_performance: build response entirely from Firestore data ────────
    if action_type == "class_performance":
        if teacher_ctx.get("has_data"):
            # Construct the structured performance response from real data
            classes = teacher_ctx.get("classes", [])
            first   = classes[0] if classes else {}
            structured = {
                "summary": (
                    f"{first.get('name', 'Your class')} has an overall average of "
                    f"{first.get('average_score', 0)}%. "
                    f"Submission rate: {first.get('submission_rate', 'N/A')}."
                ),
                "top_students":        first.get("top_students", []),
                "struggling_students": first.get("struggling_students", []),
                "weak_topics":         first.get("weak_topics", []),
                "recommendations": [
                    f"Focus revision sessions on: {', '.join(first.get('weak_topics', ['key topics']))}.",
                    "Pair top performers with struggling students for peer learning.",
                    "Use entry tasks at the start of each lesson to activate prior knowledge.",
                ],
            }
        else:
            # Demo Firestore has no marks yet — return honest no-data response
            structured = {
                "summary": (
                    "No graded submissions found yet. "
                    "Once students submit work and you grade it, Neriah will show real insights here."
                ),
                "top_students":        [],
                "struggling_students": [],
                "weak_topics":         [],
                "recommendations":     [
                    "Assign a homework task to your class.",
                    "Ask students to submit their work via the Neriah app.",
                    "Grade their submissions to unlock performance analytics.",
                ],
            }
        return jsonify({
            "action_type":     "class_performance",
            "structured":      structured,
            "conversation_id": f"demo-conv-{uuid.uuid4().hex[:8]}",
            "curriculum":      curriculum,
            "level":           level,
            "context_injected": teacher_ctx,
        }), 200

    # ── All other action types: pre-canned structured response + real context ──
    canned = _DEMO_ASSISTANT_RESPONSES.get(action_type, _DEMO_ASSISTANT_RESPONSES["chat"])
    resp = dict(canned)
    resp["conversation_id"]  = f"demo-conv-{uuid.uuid4().hex[:8]}"
    resp["curriculum"]       = curriculum
    resp["level"]            = level
    resp["context_injected"] = teacher_ctx   # real Firestore data, not hardcoded

    # When a file is attached, prepend a short note to the canned text response
    if file_data and media_type in ("image", "pdf", "word"):
        file_label = {"image": "image", "pdf": "PDF document", "word": "Word document"}.get(media_type, "file")
        if "response" in resp:
            resp["response"] = (
                f"I can see the {file_label} you've shared. "
                f"In the live version of Neriah, I'd analyse its content and tailor my response. "
                f"For now, here's what I'd typically suggest:\n\n{resp['response']}"
            )

    logger.info("[demo/teacher/assistant] action_type=%s curriculum=%s level=%s file=%s",
                action_type, curriculum, level, media_type or "none")
    return jsonify(resp), 200


@demo_bp.post("/demo/teacher/assistant/export")
def demo_teacher_assistant_export():
    """
    Export AI-generated homework or quiz to demo Firestore as a draft answer_key.
    Mirrors the real /api/teacher/assistant/export endpoint.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body         = request.get_json(silent=True) or {}
    content_type = (body.get("content_type") or "homework").strip().lower()
    content      = body.get("content") or {}
    class_id     = (body.get("class_id") or DEMO_CLASS_ID).strip()
    title        = (body.get("title") or content.get("title") or "Demo Homework").strip()

    questions_raw = content.get("questions") or []
    questions: list[dict] = []
    for i, q in enumerate(questions_raw):
        if content_type == "quiz":
            opts    = q.get("options") or {}
            correct = q.get("correct_answer", "")
            answer  = opts.get(correct, correct)
            questions.append({
                "question_number": q.get("number", i + 1),
                "question_text":   q.get("question", ""),
                "answer":          answer,
                "marks":           int(q.get("marks", 1)),
                "marking_notes":   f"Correct: {correct}) {answer}",
            })
        else:
            questions.append({
                "question_number": q.get("number", i + 1),
                "question_text":   q.get("question", ""),
                "answer":          q.get("mark_scheme") or q.get("answer") or "",
                "marks":           int(q.get("marks", 1)),
                "marking_notes":   q.get("mark_scheme") or None,
            })

    total_marks   = content.get("total_marks") or sum(q["marks"] for q in questions)
    now           = _now()
    answer_key_id = str(uuid.uuid4())

    upsert("answer_keys", answer_key_id, {
        "id":                  answer_key_id,
        "class_id":            class_id,
        "teacher_id":          DEMO_TEACHER_ID,
        "title":               title,
        "subject":             "Mathematics",
        "education_level":     "form_2",
        "questions":           questions,
        "total_marks":         total_marks,
        "open_for_submission": False,
        "generated":           True,
        "ai_generated":        True,
        "status":              "draft",
        "source":              f"demo_assistant_{content_type}",
        "created_at":          now,
        "updated_at":          now,
    })

    logger.info("[demo/teacher/assistant/export] created %s class=%s", answer_key_id, class_id)
    return jsonify({
        "answer_key_id": answer_key_id,
        "title":         title,
        "class_id":      class_id,
        "status":        "draft",
        "questions":     len(questions),
        "total_marks":   total_marks,
    }), 201


# ── Demo submission seed data ─────────────────────────────────────────────────

_DEMO_SUBMISSION_DETAILS = [
    {
        "submission_id": "sub-s1",
        "student_name": "Tendai Moyo",
        "submitted_at": "2026-04-13T08:00:00Z",
        "score": 7, "max_score": 10, "percentage": 70.0,
        "status": "graded", "feedback": "", "approved": False, "manually_edited": False,
        "verdicts": [
            {"question_number": 1, "verdict": "correct",   "awarded_marks": 2, "max_marks": 2, "student_answer": "2x = 11−5, 2x = 6, x = 3",        "feedback": "Full working shown — correct"},
            {"question_number": 2, "verdict": "correct",   "awarded_marks": 2, "max_marks": 2, "student_answer": "15/100 × 200 = 30",                "feedback": "Correct method and answer"},
            {"question_number": 3, "verdict": "partial",   "awarded_marks": 1, "max_marks": 2, "student_answer": "8 + 5 = 13",                       "feedback": "Used perimeter instead of area formula"},
            {"question_number": 4, "verdict": "correct",   "awarded_marks": 2, "max_marks": 2, "student_answer": "6x+12−2x+2 = 4x+14",              "feedback": "Correct expansion"},
            {"question_number": 5, "verdict": "incorrect", "awarded_marks": 0, "max_marks": 2, "student_answer": "3 out of 7",                       "feedback": "Wrong total — should be 10 marbles"},
        ],
    },
    {
        "submission_id": "sub-s2",
        "student_name": "Chipo Dube",
        "submitted_at": "2026-04-13T08:14:00Z",
        "score": 6, "max_score": 10, "percentage": 60.0,
        "status": "graded", "feedback": "", "approved": False, "manually_edited": False,
        "verdicts": [
            {"question_number": 1, "verdict": "correct",   "awarded_marks": 2, "max_marks": 2, "student_answer": "x = 3",                            "feedback": "Correct"},
            {"question_number": 2, "verdict": "partial",   "awarded_marks": 1, "max_marks": 2, "student_answer": "0.15 × 200 = 30",                  "feedback": "Method mark awarded; accuracy mark lost on write-up"},
            {"question_number": 3, "verdict": "incorrect", "awarded_marks": 0, "max_marks": 2, "student_answer": "8 + 5 = 13",                       "feedback": "Added instead of multiplying"},
            {"question_number": 4, "verdict": "correct",   "awarded_marks": 2, "max_marks": 2, "student_answer": "4x + 14",                          "feedback": "Correct"},
            {"question_number": 5, "verdict": "partial",   "awarded_marks": 1, "max_marks": 2, "student_answer": "3 to 10",                          "feedback": "Ratio stated correctly; fractional form not given"},
        ],
    },
    {
        "submission_id": "sub-s3",
        "student_name": "Takudzwa Ncube",
        "submitted_at": "2026-04-13T09:01:00Z",
        "score": 4, "max_score": 10, "percentage": 40.0,
        "status": "graded", "feedback": "", "approved": False, "manually_edited": False,
        "verdicts": [
            {"question_number": 1, "verdict": "correct",   "awarded_marks": 2, "max_marks": 2, "student_answer": "x = 3",                            "feedback": "Correct"},
            {"question_number": 2, "verdict": "incorrect", "awarded_marks": 0, "max_marks": 2, "student_answer": "0.15%",                             "feedback": "Incorrect — percentage symbol misapplied"},
            {"question_number": 3, "verdict": "partial",   "awarded_marks": 1, "max_marks": 2, "student_answer": "8 × 5 = 45",                       "feedback": "Correct formula, arithmetic error"},
            {"question_number": 4, "verdict": "incorrect", "awarded_marks": 0, "max_marks": 2, "student_answer": "4x + 10",                          "feedback": "Sign error in expansion of −2(x−1)"},
            {"question_number": 5, "verdict": "partial",   "awarded_marks": 1, "max_marks": 2, "student_answer": "0.3",                              "feedback": "Equivalent decimal accepted for partial credit"},
        ],
    },
]

_DEMO_SUBS_BY_ID: dict[str, dict] = {s["submission_id"]: s for s in _DEMO_SUBMISSION_DETAILS}

# Quick lookup: question_number → question doc (for enriching verdict responses)
_Q_BY_NUM: dict[int, dict] = {q["question_number"]: q for q in _DEMO_QUESTIONS}


def _enrich_verdicts(verdicts: list[dict]) -> list[dict]:
    """
    Annotate each verdict dict with question_text, correct_answer, and marks_awarded
    (alias for awarded_marks) so the web/mobile clients can render a full table.
    Passes through any extra fields already present.
    """
    enriched = []
    for v in verdicts:
        qnum = v.get("question_number", 0)
        q = _Q_BY_NUM.get(qnum, {})
        enriched.append({
            **v,
            "question_text":   v.get("question_text")   or q.get("question_text", ""),
            "correct_answer":  v.get("correct_answer")  or q.get("answer", ""),
            "marks_awarded":   v.get("marks_awarded")   or v.get("awarded_marks", 0),
        })
    return enriched


def _pass_fail(score: float, max_score: float) -> str:
    """Return 'pass' if score/max_score >= 0.5, else 'fail'. Returns '' if max_score is 0."""
    if not max_score:
        return ""
    return "pass" if (score / max_score) >= 0.5 else "fail"

# ── Demo analytics seed data ──────────────────────────────────────────────────

_DEMO_CLASS_ANALYTICS = {
    "class_id": DEMO_CLASS_ID,
    "class_name": "Form 2A",
    "education_level": "form_2",
    "subject": "Mathematics",
    "class_average": 57,
    "highest_score": 70,
    "lowest_score": 40,
    "submitted": 3,
    "total_students": 3,
    "submission_rate": "3 of 3 students submitted",
    "students": [
        {"student_id": "demo-student-1", "name": "Tendai Moyo",    "latest_score": 70, "average_score": 70, "submission_count": 1, "trend": "stable"},
        {"student_id": "demo-student-2", "name": "Chipo Dube",     "latest_score": 60, "average_score": 60, "submission_count": 1, "trend": "up"},
        {"student_id": "demo-student-3", "name": "Takudzwa Ncube", "latest_score": 40, "average_score": 40, "submission_count": 1, "trend": "down"},
    ],
}

_DEMO_STUDENT_ANALYTICS: dict[str, dict] = {
    "demo-student-1": {
        "student_id": "demo-student-1", "name": "Tendai Moyo",
        "class_average": 57, "average_score": 69,
        "score_trend": [
            {"homework_title": "Ch.3 Quiz", "score_pct": 65},
            {"homework_title": "Ch.4 Test", "score_pct": 72},
            {"homework_title": "Ch.5 Test", "score_pct": 70},
        ],
        "weak_topics": ["Probability", "Area formulas"],
    },
    "demo-student-2": {
        "student_id": "demo-student-2", "name": "Chipo Dube",
        "class_average": 57, "average_score": 55,
        "score_trend": [
            {"homework_title": "Ch.3 Quiz", "score_pct": 50},
            {"homework_title": "Ch.4 Test", "score_pct": 55},
            {"homework_title": "Ch.5 Test", "score_pct": 60},
        ],
        "weak_topics": ["Area and perimeter", "Percentages"],
    },
    "demo-student-3": {
        "student_id": "demo-student-3", "name": "Takudzwa Ncube",
        "class_average": 57, "average_score": 48,
        "score_trend": [
            {"homework_title": "Ch.3 Quiz", "score_pct": 55},
            {"homework_title": "Ch.4 Test", "score_pct": 48},
            {"homework_title": "Ch.5 Test", "score_pct": 40},
        ],
        "weak_topics": ["Algebra", "Probability", "Percentages"],
    },
}

_DEMO_STUDY_SUGGESTIONS: dict[str, str] = {
    "Probability":       "Before I explain probability rules, what do you think the word 'probability' means in everyday language? Can you give me an example from your own life where you'd estimate a chance?",
    "Area formulas":     "Let's think about area. If you had a piece of paper that is 8 cm wide and 5 cm long, how would you figure out how much paper there is in total? What operation connects length and width?",
    "Area and perimeter":"Great topic to revisit! What's the difference between going around the edge of a shape vs covering the inside of it? Which one do you think 'area' refers to?",
    "Percentages":       "Percentages are just fractions out of 100. If I said '30 out of 100 students passed', what percentage would that be? Now what if only 30 out of 200 passed?",
    "Algebra":           "Algebra is about finding missing values. If I told you that a number plus 5 equals 11, how would you find that number? What operation would you do on both sides?",
}


# ── GET /api/demo/analytics/class/<class_id> ─────────────────────────────────

@demo_bp.get("/demo/analytics/class/<class_id>")
def demo_class_analytics(class_id: str):
    """Return pre-canned class analytics for the demo class."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403
    return jsonify(_DEMO_CLASS_ANALYTICS), 200


# ── GET /api/demo/analytics/student/<student_id> ──────────────────────────────

@demo_bp.get("/demo/analytics/student/<student_id>")
def demo_student_analytics(student_id: str):
    """Return pre-canned per-student analytics."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403
    data = _DEMO_STUDENT_ANALYTICS.get(student_id)
    if not data:
        return jsonify({"error": "Student not found"}), 404
    return jsonify(data), 200


# ── POST /api/demo/study-suggestions ─────────────────────────────────────────

@demo_bp.post("/demo/study-suggestions")
def demo_study_suggestions():
    """Return Socratic-method study suggestions for a student's weak topics."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403
    body = request.get_json(silent=True) or {}
    weak_topics: list = body.get("weak_topics", [])
    if not weak_topics:
        return jsonify({"error": "weak_topics list is required"}), 400

    suggestions = []
    for topic in weak_topics:
        matched = next(
            (sug for key, sug in _DEMO_STUDY_SUGGESTIONS.items()
             if key.lower() in topic.lower() or topic.lower() in key.lower()),
            None,
        )
        suggestions.append({
            "topic": topic,
            "suggestion": matched or (
                f"Before I explain {topic}, what do you already know about it? "
                "Can you describe it in your own words?"
            ),
        })

    return jsonify({
        "suggestions": suggestions,
        "style": "socratic",
        "message": "These suggestions guide the student to discover answers, not receive them directly.",
    }), 200


# ── GET /api/demo/submissions/<submission_id> ─────────────────────────────────

@demo_bp.get("/demo/submissions/<submission_id>")
def demo_get_submission(submission_id: str):
    """Return pre-canned submission detail for a demo student."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    # Check Firestore first (may have been approved/overridden)
    stored = get_doc("demo_submissions", submission_id)
    if stored:
        doc = stored
    else:
        sub = _DEMO_SUBS_BY_ID.get(submission_id)
        if not sub:
            return jsonify({"error": "Submission not found"}), 404
        doc = sub

    # Enrich verdicts with question_text, correct_answer, marks_awarded
    enriched_verdicts = _enrich_verdicts(doc.get("verdicts", []))
    score     = doc.get("score", 0)
    max_score = doc.get("max_score", 0)

    return jsonify({
        **doc,
        "verdicts":  enriched_verdicts,
        "pass_fail": _pass_fail(score, max_score),
    }), 200


# ── Annotation helper ─────────────────────────────────────────────────────────

_DEMO_MARKED_BUCKET = "neriah-demo-marked"

def _make_demo_notebook_image(num_questions: int = 5) -> bytes:
    """
    Generate a simple ruled-notebook placeholder image.
    White background, light-gray horizontal rules, red left margin line,
    question numbers on the left — simulating a student exercise book page.
    """
    W, H = 600, 800
    img = PILImage.new("RGB", (W, H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Ruled lines
    for y in range(60, H - 10, 30):
        draw.line([(0, y), (W, y)], fill=(210, 220, 230), width=1)

    # Red margin line
    draw.line([(60, 0), (60, H)], fill=(220, 50, 50), width=2)

    # Question number labels
    row_h = (H - 80) // max(num_questions, 1)
    for i in range(num_questions):
        y = 70 + i * row_h
        draw.text((8, y), f"Q{i + 1}.", fill=(80, 80, 80))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    return buf.getvalue()


def _annotate_and_upload(submission_id: str, verdicts: list[dict]) -> str:
    """
    Annotate a demo exercise-book image with ticks/crosses/scores and upload
    the result to GCS.  Returns the public URL, or an empty string on any failure.
    """
    try:
        from shared.annotator import annotate_image        # noqa: PLC0415
        from shared.gcs_client import upload_bytes         # noqa: PLC0415

        image_bytes = _make_demo_notebook_image(len(verdicts))
        annotated   = annotate_image(image_bytes, verdicts)

        blob_name = f"{submission_id}_annotated.jpg"
        url = upload_bytes(
            _DEMO_MARKED_BUCKET,
            blob_name,
            annotated,
            content_type="image/jpeg",
            public=True,
        )
        logger.info("[demo] Annotated image uploaded → %s", url)
        return url
    except Exception:
        logger.exception("[demo] Annotation/upload failed — returning empty string")
        return ""


# ── PUT /api/demo/submissions/<submission_id>/approve ─────────────────────────

@demo_bp.put("/demo/submissions/<submission_id>/approve")
def demo_approve_submission(submission_id: str):
    """Approve a demo submission, optionally with overridden verdicts and feedback."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    sub = _DEMO_SUBS_BY_ID.get(submission_id)
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    body = request.get_json(silent=True) or {}
    now = _now()

    # Validate feedback length
    feedback_text: str = body.get("feedback", "") or ""
    if len(feedback_text) > 500:
        return jsonify({"error": "Feedback must be 500 characters or less"}), 400

    updated: dict = {
        **sub,
        "approved": True,
        "status": "approved",
        "approved_at": now,
        "feedback": feedback_text,
    }

    if body.get("overridden_verdicts"):
        updated["verdicts"] = body["overridden_verdicts"]
        updated["manually_edited"] = True
        updated["score"] = sum(v.get("awarded_marks", 0) for v in updated["verdicts"])
        updated["percentage"] = round(updated["score"] / updated["max_score"] * 100, 1)

    # ── Generate annotated image ───────────────────────────────────────────────
    annotated_url = _annotate_and_upload(submission_id, updated["verdicts"])
    updated["annotated_image_url"] = annotated_url

    score     = updated.get("score", 0)
    max_score = updated.get("max_score", 0)

    upsert("demo_submissions", submission_id, updated)
    logger.info("[demo] Approved submission %s (manually_edited=%s, image=%s)",
                submission_id, updated.get("manually_edited"), bool(annotated_url))
    return jsonify({
        "status":               "approved",
        "submission_id":        submission_id,
        "annotated_image_url":  annotated_url,
        "score":                score,
        "max_score":            max_score,
        "pass_fail":            _pass_fail(score, max_score),
    }), 200


# ── Helpers ───────────────────────────────────────────────────────────────────

def _gen_join_code(length: int = 6) -> str:
    """Generate a random alphanumeric join code (uppercase letters + digits)."""
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=length))


# ── GET /api/demo/classes ─────────────────────────────────────────────────────

@demo_bp.get("/demo/classes")
def demo_list_classes():
    """
    Return a list of classes for the demo teacher.
    Reads from Firestore first (picks up newly created classes),
    then falls back to the seed data if Firestore is empty.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    teacher_id = request.args.get("teacher_id", DEMO_TEACHER_ID)

    # Read from Firestore — returns any classes created during the demo session
    fs_classes = query("classes", "teacher_id", "==", teacher_id)

    if not fs_classes:
        # Fall back to the static seed class so the demo always shows something
        fs_classes = [{
            "id":              DEMO_CLASS_ID,
            "name":            "Form 2A",
            "subject":         "Mathematics",
            "education_level": "Form 2",
            "description":     "",
            "teacher_id":      DEMO_TEACHER_ID,
            "join_code":       "ABC123",
            "student_count":   3,
            "homework_count":  1,
            "created_at":      _now(),
        }]

    # Normalise and return
    result = []
    for cls in fs_classes:
        result.append({
            "id":              cls.get("id", str(uuid.uuid4())),
            "name":            cls.get("name", ""),
            "subject":         cls.get("subject", ""),
            "education_level": cls.get("education_level", ""),
            "description":     cls.get("description", ""),
            "teacher_id":      cls.get("teacher_id", teacher_id),
            "join_code":       cls.get("join_code", ""),
            "student_count":   cls.get("student_count", 0),
            "homework_count":  cls.get("homework_count", 0),
            "created_at":      cls.get("created_at", _now()),
        })

    return jsonify({"classes": result}), 200


# ── POST /api/demo/classes ────────────────────────────────────────────────────

@demo_bp.post("/demo/classes")
def demo_create_class():
    """
    Create a new class in the demo.
    Body: { name, subject, education_level, description?, teacher_id? }
    Returns the created class document with a generated join_code.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}

    name = (body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name is required"}), 400

    education_level = (body.get("education_level") or "").strip()
    if not education_level:
        return jsonify({"error": "education_level is required"}), 400

    teacher_id  = (body.get("teacher_id") or DEMO_TEACHER_ID).strip()
    subject     = (body.get("subject") or "").strip()
    description = (body.get("description") or "").strip()

    # Generate a unique join code (retry up to 5 times on collision)
    join_code = _gen_join_code()
    for _ in range(4):
        existing = query("classes", "join_code", "==", join_code)
        if not existing:
            break
        join_code = _gen_join_code()

    class_id = str(uuid.uuid4())
    now = _now()

    class_doc = {
        "id":              class_id,
        "name":            name,
        "subject":         subject,
        "education_level": education_level,
        "description":     description,
        "teacher_id":      teacher_id,
        "join_code":       join_code,
        "student_count":   0,
        "homework_count":  0,
        "created_at":      now,
        "updated_at":      now,
    }
    upsert("classes", class_id, class_doc)

    logger.info("[demo] Created class %r (%s) with join_code=%s", name, education_level, join_code)
    return jsonify(class_doc), 201


# ── POST /api/demo/students/batch ─────────────────────────────────────────────

@demo_bp.post("/demo/students/batch")
def demo_students_batch():
    """
    Batch-create students in a demo class (mirrors POST /api/students/batch).

    Body: { class_id: str, students: [{ first_name, surname, phone?, register_number? }] }
    Returns: { created: int, students: [...] }
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body     = request.get_json(silent=True) or {}
    class_id = (body.get("class_id") or "").strip()
    raw      = body.get("students") or []

    if not class_id:
        return jsonify({"error": "class_id is required"}), 400
    if not isinstance(raw, list) or len(raw) == 0:
        return jsonify({"error": "students list is required and must not be empty"}), 400
    if len(raw) > 100:
        return jsonify({"error": "Maximum 100 students per batch"}), 400

    now      = _now()
    created  = []
    for s in raw:
        first_name = (s.get("first_name") or s.get("name") or "").strip()
        surname    = (s.get("surname")    or "").strip()
        if not first_name:
            continue
        student_id = str(uuid.uuid4())
        doc = {
            "id":              student_id,
            "class_id":        class_id,
            "teacher_id":      DEMO_TEACHER_ID,
            "first_name":      first_name,
            "surname":         surname,
            "phone":           (s.get("phone") or "").strip() or None,
            "register_number": (s.get("register_number") or "").strip() or None,
            "role":            "student",
            "token_version":   0,
            "created_at":      now,
        }
        upsert("students", student_id, doc)
        created.append(doc)

    # Bump the class student_count
    try:
        cls_doc = get_doc("classes", class_id)
        if cls_doc:
            upsert("classes", class_id, {
                "student_count": cls_doc.get("student_count", 0) + len(created),
                "updated_at":    now,
            })
    except Exception:
        pass

    logger.info("[demo] Batch created %d students in class %s", len(created), class_id)
    return jsonify({"created": len(created), "students": created}), 201


# ── Demo OTP auth ─────────────────────────────────────────────────────────────
# These endpoints replace the real auth pipeline for the demo.
# Any 6-digit code is accepted by /demo/auth/verify-otp (NERIAH_ENV=demo only).
# Channel is derived from the phone prefix: +263 (Zimbabwe) → whatsapp, all others → sms.

# Canonical list of Zimbabwean schools used in web demo school picker.
# Shared here so /demo/auth/register can validate or store the school name.
ZW_SCHOOLS = [
    "Harare High School", "Prince Edward School", "St Georges College",
    "Allan Wilson High School", "Goromonzi High School", "Churchill High School",
    "Borrowdale College", "St Johns College", "Chisipite Senior School",
    "Dominican Convent High School", "Arundel School", "Gateway High School",
    "Hellenic Academy", "Hillside Teachers College", "Morgan High School",
    "Mutare Boys High School", "Mutare Girls High School", "Bulawayo High School",
    "Milton High School", "Townsend High School", "Gifford High School",
    "Petra High School", "Marist Brothers Dete", "Regina Mundi High School",
    "St Ignatius College", "Peterhouse Boys School", "Falcon College",
    "Eagle School", "Guinea Fowl School", "Whitestone School",
]

# Valid education-level tokens accepted by the demo registration endpoint.
_VALID_EDUCATION_LEVELS = {
    "grade_1", "grade_2", "grade_3", "grade_4", "grade_5", "grade_6", "grade_7",
    "form_1", "form_2", "form_3", "form_4", "form_5", "form_6",
    "a_level", "tertiary", "college", "university",
}


@demo_bp.post("/demo/auth/register")
def demo_auth_register():
    """
    Create a demo teacher account.

    Body: { first_name, surname, phone, school, education_level? }
    - school: any non-empty string (listed or custom).
    - education_level: optional; must be one of _VALID_EDUCATION_LEVELS if provided.

    Returns 200: { teacher_id, token, user: { id, first_name, surname, phone, school, role } }
    Returns 400 for missing required fields or invalid education_level.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}

    first_name      = (body.get("first_name") or "").strip()
    surname         = (body.get("surname")    or "").strip()
    phone           = (body.get("phone")      or "").strip()
    school          = (body.get("school")     or "").strip()
    education_level = (body.get("education_level") or "").strip()

    if not first_name:
        return jsonify({"error": "first_name is required"}), 400
    if not surname:
        return jsonify({"error": "surname is required"}), 400
    if not phone:
        return jsonify({"error": "phone is required"}), 400
    if not school:
        return jsonify({"error": "school is required"}), 400
    if education_level and education_level not in _VALID_EDUCATION_LEVELS:
        return jsonify({
            "error": f"Invalid education_level '{education_level}'. "
                     f"Valid options: {', '.join(sorted(_VALID_EDUCATION_LEVELS))}"
        }), 400

    teacher_id = str(uuid.uuid4())
    now        = _now()
    token      = create_jwt(teacher_id, "teacher", 0)

    teacher_doc = {
        "id":              teacher_id,
        "first_name":      first_name,
        "surname":         surname,
        "phone":           phone,
        "school":          school,
        "education_level": education_level or None,
        "role":            "teacher",
        "created_at":      now,
        "updated_at":      now,
    }
    upsert("teachers", teacher_id, teacher_doc)

    logger.info(
        "[demo] Registered teacher %s %s (school=%r, level=%r)",
        first_name, surname, school, education_level or "—",
    )
    return jsonify({
        "teacher_id": teacher_id,
        "token":      token,
        "user":       {
            "id":        teacher_id,
            "first_name": first_name,
            "surname":    surname,
            "phone":      phone,
            "school":     school,
            "role":       "teacher",
        },
    }), 200


def _demo_channel(phone: str) -> str:
    """Return 'whatsapp' for Zimbabwean numbers, 'sms' for everything else."""
    return "whatsapp" if phone.startswith("+263") else "sms"


@demo_bp.post("/demo/auth/send-otp")
def demo_auth_send_otp():
    """
    Simulate sending an OTP for the demo.
    Body: { phone }
    Returns: { verification_id, channel: 'whatsapp' | 'sms' }
    No real OTP is sent — any 6-digit code passes /demo/auth/verify-otp.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    if not phone:
        return jsonify({"error": "phone is required"}), 400

    verification_id = f"demo-otp-{uuid.uuid4().hex[:12]}"
    channel = _demo_channel(phone)

    # Store a stub so resend can look it up
    upsert("demo_otp_sessions", verification_id, {
        "phone":           phone,
        "channel":         channel,
        "created_at":      _now(),
    })

    logger.info("[demo] send-otp phone=%s channel=%s vid=%s", phone, channel, verification_id)
    return jsonify({"verification_id": verification_id, "channel": channel}), 200


@demo_bp.post("/demo/auth/resend-otp")
def demo_auth_resend_otp():
    """
    Simulate resending an OTP for the demo.
    Body: { phone?, channel? }
    Returns: { verification_id, channel }
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    phone = (body.get("phone") or "").strip()
    channel = (body.get("channel") or ("" if not phone else _demo_channel(phone))).strip()
    if not channel:
        channel = "sms"

    verification_id = f"demo-otp-{uuid.uuid4().hex[:12]}"
    if phone:
        upsert("demo_otp_sessions", verification_id, {
            "phone":      phone,
            "channel":    channel,
            "created_at": _now(),
        })

    logger.info("[demo] resend-otp channel=%s new_vid=%s", channel, verification_id)
    return jsonify({"verification_id": verification_id, "channel": channel}), 200


@demo_bp.post("/demo/auth/verify-otp")
def demo_auth_verify_otp():
    """
    Accept any 6-digit code in demo mode.
    Body: { code: str, verification_id?: str }
    Returns 200 { success: true } for any 6-digit code; 400 otherwise.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    code = (body.get("code") or "").strip()

    if not code or not code.isdigit() or len(code) != 6:
        return jsonify({"error": "code must be exactly 6 digits"}), 400

    logger.info("[demo] verify-otp accepted (demo bypass)")
    return jsonify({"success": True}), 200


# ── POST /api/demo/approve ────────────────────────────────────────────────────

@demo_bp.post("/demo/approve")
def demo_approve():
    """Approve a mark document by ID."""
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    mark_id = (body.get("mark_id") or "").strip()
    if not mark_id:
        return jsonify({"error": "mark_id is required"}), 400

    upsert("marks", mark_id, {"approved": True, "updated_at": _now()})
    return jsonify({"status": "approved", "mark_id": mark_id}), 200


# ── PIN management (demo) ─────────────────────────────────────────────────────
# PINs are stored as bcrypt hashes in the `demo_pins` Firestore collection.
# Document ID = user_id. Never store plaintext.

_PIN_COLLECTION = "demo_pins"


def _get_pin_doc(user_id: str) -> dict | None:
    return get_doc(_PIN_COLLECTION, user_id)


def _validate_pin_digits(pin: str) -> str | None:
    """Return an error string if pin is not exactly 4 digits, else None."""
    if not pin or not pin.isdigit() or len(pin) != 4:
        return "pin must be exactly 4 digits"
    return None


# ── POST /api/demo/pin/setup ──────────────────────────────────────────────────

@demo_bp.post("/demo/pin/setup")
def demo_pin_setup():
    """
    Create or replace the demo user's PIN.
    Body: { user_id, pin }
    Returns: { success: true, pin_active: true }
    PIN is stored as bcrypt hash — never plaintext.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    user_id = (body.get("user_id") or DEMO_TEACHER_ID).strip()
    pin     = (body.get("pin") or "").strip()

    err = _validate_pin_digits(pin)
    if err:
        return jsonify({"error": err}), 400

    pin_hash = hash_pin(pin)
    upsert(_PIN_COLLECTION, user_id, {
        "user_id":    user_id,
        "pin_hash":   pin_hash,
        "created_at": _now(),
        "updated_at": _now(),
    })
    logger.info("[demo] PIN set for user %s", user_id)
    return jsonify({"success": True, "pin_active": True}), 200


# ── POST /api/demo/pin/verify ─────────────────────────────────────────────────

@demo_bp.post("/demo/pin/verify")
def demo_pin_verify():
    """
    Verify the demo user's PIN.
    Body: { user_id, pin }
    Returns 200 { valid: true } on match, 401 { valid: false } on mismatch or missing PIN.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    user_id = (body.get("user_id") or DEMO_TEACHER_ID).strip()
    pin     = (body.get("pin") or "").strip()

    err = _validate_pin_digits(pin)
    if err:
        return jsonify({"error": err}), 400

    doc = _get_pin_doc(user_id)
    if not doc:
        return jsonify({"valid": False, "error": "No PIN set"}), 401

    if verify_pin(pin, doc["pin_hash"]):
        return jsonify({"valid": True}), 200

    return jsonify({"valid": False}), 401


# ── POST /api/demo/pin/change ─────────────────────────────────────────────────

@demo_bp.post("/demo/pin/change")
def demo_pin_change():
    """
    Change the demo user's PIN.
    Body: { user_id, current_pin, new_pin }
    Returns 200 { success: true } on success, 401 if current_pin is wrong.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    user_id     = (body.get("user_id")      or DEMO_TEACHER_ID).strip()
    current_pin = (body.get("current_pin")  or "").strip()
    new_pin     = (body.get("new_pin")      or "").strip()

    for label, val in [("current_pin", current_pin), ("new_pin", new_pin)]:
        err = _validate_pin_digits(val)
        if err:
            return jsonify({"error": f"{label}: {err}"}), 400

    doc = _get_pin_doc(user_id)
    if not doc:
        return jsonify({"error": "No PIN set — use /demo/pin/setup first"}), 404

    if not verify_pin(current_pin, doc["pin_hash"]):
        return jsonify({"error": "Incorrect current PIN"}), 401

    new_hash = hash_pin(new_pin)
    upsert(_PIN_COLLECTION, user_id, {
        **doc,
        "pin_hash":   new_hash,
        "updated_at": _now(),
    })
    logger.info("[demo] PIN changed for user %s", user_id)
    return jsonify({"success": True}), 200


# ── GET /api/demo/homeworks ──────────────────────────────────────────────────

@demo_bp.get("/demo/homeworks")
def demo_list_homeworks():
    """
    List all homework assignments for a class with submission/graded/pending counts.
    Query params: class_id (optional, defaults to DEMO_CLASS_ID)
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    class_id = request.args.get("class_id", DEMO_CLASS_ID).strip() or DEMO_CLASS_ID

    # Fetch all answer keys for the class
    homeworks = query("answer_keys", [("class_id", "==", class_id)], order_by="created_at")

    # Seed the demo homework if Firestore is empty
    if not homeworks:
        now = _now()
        homeworks = [{
            "id": DEMO_HW_ID, "class_id": class_id,
            "teacher_id": DEMO_TEACHER_ID,
            "title": "Maths Chapter 5 Test",
            "education_level": "form_2", "subject": "Mathematics",
            "questions": _DEMO_QUESTIONS,
            "open_for_submission": True, "ai_generated": True,
            "status": "active",
            "created_at": now, "due_date": None,
        }]

    # Enrich with submission/graded/pending counts
    all_subs = query("student_submissions", [("class_id", "==", class_id)])
    sub_counts: dict = {}
    for sub in all_subs:
        ak_id = sub.get("answer_key_id", "")
        if not ak_id:
            continue
        if ak_id not in sub_counts:
            sub_counts[ak_id] = {"submission_count": 0, "graded_count": 0, "pending_count": 0}
        sub_counts[ak_id]["submission_count"] += 1
        status = sub.get("status", "")
        if status in ("graded", "approved") or sub.get("approved"):
            sub_counts[ak_id]["graded_count"] += 1
        else:
            sub_counts[ak_id]["pending_count"] += 1

    now_iso = _now()
    result = []
    for hw in homeworks:
        counts = sub_counts.get(hw["id"], {"submission_count": 0, "graded_count": 0, "pending_count": 0})
        due = hw.get("due_date")
        is_graded = (
            counts["graded_count"] > 0
            or (due and due < now_iso)
        )
        result.append({
            "id": hw.get("id"),
            "title": hw.get("title", ""),
            "subject": hw.get("subject", ""),
            "education_level": hw.get("education_level", ""),
            "due_date": due,
            "created_at": hw.get("created_at", now_iso),
            "open_for_submission": hw.get("open_for_submission", False),
            "total_marks": hw.get("total_marks", sum(q.get("marks", 0) for q in hw.get("questions", []))),
            "questions_count": len(hw.get("questions", [])),
            "ai_generated": hw.get("ai_generated", False),
            "submission_count": counts["submission_count"],
            "graded_count": counts["graded_count"],
            "pending_count": counts["pending_count"],
            "status": "graded" if is_graded else "pending",
        })

    # Sort newest first
    result.sort(key=lambda h: h.get("created_at", ""), reverse=True)

    graded_total = sum(1 for h in result if h["status"] == "graded")
    pending_total = len(result) - graded_total

    logger.info("[demo] list_homeworks class=%s → %d homeworks", class_id, len(result))
    return jsonify({
        "homeworks": result,
        "graded_total": graded_total,
        "pending_total": pending_total,
    }), 200


# ── GET /api/demo/homework/<hw_id> ───────────────────────────────────────────

@demo_bp.get("/demo/homework/<hw_id>")
def demo_get_homework(hw_id: str):
    """
    Return full homework detail for the HomeworkDetailScreen.
    Reads from Firestore first; falls back to the seeded demo homework.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    stored = get_doc("answer_keys", hw_id)
    if stored:
        doc = stored
    else:
        doc = {
            "id": DEMO_HW_ID, "class_id": DEMO_CLASS_ID,
            "teacher_id": DEMO_TEACHER_ID,
            "title": "Maths Chapter 5 Test",
            "education_level": "form_2", "subject": "Mathematics",
            "questions": _DEMO_QUESTIONS,
            "open_for_submission": True,
            "status": "active", "ai_generated": True,
            "created_at": "2026-04-13T07:00:00Z",
            "due_date": "2026-04-20T23:59:00Z",
        }

    total_marks = sum(q.get("marks", 0) for q in doc.get("questions", []))
    return jsonify({
        "id":               doc.get("id", hw_id),
        "title":            doc.get("title", ""),
        "subject":          doc.get("subject", ""),
        "education_level":  doc.get("education_level", ""),
        "question_count":   len(doc.get("questions", [])),
        "total_marks":      doc.get("total_marks", total_marks),
        "questions":        doc.get("questions", []),
        "ai_generated":     doc.get("ai_generated", False),
        "open_for_submission": doc.get("open_for_submission", True),
        "created_at":       doc.get("created_at", _now()),
        "due_date":         doc.get("due_date"),
        "answer_key_id":    doc.get("id", hw_id),
        "submission_count": len(_DEMO_SUBMISSION_DETAILS),
    }), 200


# ── PATCH /api/demo/homework/<hw_id>/questions ────────────────────────────────

@demo_bp.patch("/demo/homework/<hw_id>/questions")
def demo_patch_homework_questions(hw_id: str):
    """
    Update the questions list for a homework entry.
    Body: { questions: [ { question_number, question_text, answer, marks } ] }
    Returns 200 with the updated homework document.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    questions = body.get("questions")
    if not isinstance(questions, list):
        return jsonify({"error": "questions must be a list"}), 400

    now = _now()
    # Normalise each question to the stored format
    normalised = []
    for i, q in enumerate(questions):
        normalised.append({
            "question_number": q.get("question_number", i + 1),
            "question_text":   q.get("question_text", q.get("text", "")),
            "answer":          q.get("answer", q.get("correct_answer", "")),
            "marks":           max(1, int(q.get("marks", q.get("max_marks", 1)))),
            "marking_notes":   q.get("marking_notes"),
        })

    total_marks = sum(q["marks"] for q in normalised)

    existing = get_doc("answer_keys", hw_id) or {
        "id": hw_id, "class_id": DEMO_CLASS_ID, "teacher_id": DEMO_TEACHER_ID,
        "title": "Maths Chapter 5 Test",
        "education_level": "form_2", "subject": "Mathematics",
        "open_for_submission": True, "ai_generated": True,
    }

    updated = {
        **existing,
        "questions":    normalised,
        "total_marks":  total_marks,
        "updated_at":   now,
    }
    upsert("answer_keys", hw_id, updated)

    logger.info("[demo] Updated %d questions for homework %s", len(normalised), hw_id)
    return jsonify({**updated, "question_count": len(normalised)}), 200


# ── PATCH /api/demo/homework/<hw_id>/toggle-submissions ───────────────────────

@demo_bp.patch("/demo/homework/<hw_id>/toggle-submissions")
def demo_toggle_homework_submissions(hw_id: str):
    """
    Toggle whether a homework is accepting submissions.
    Body: { open: bool }  — if omitted, flips the current value.
    Returns: { open_for_submission: bool }
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    existing = get_doc("answer_keys", hw_id)
    current_open = existing.get("open_for_submission", True) if existing else True

    if "open" in body:
        new_open = bool(body["open"])
    else:
        new_open = not current_open

    upsert("answer_keys", hw_id, {"open_for_submission": new_open, "updated_at": _now()})
    logger.info("[demo] homework %s open_for_submission → %s", hw_id, new_open)
    return jsonify({"open_for_submission": new_open}), 200


# ── POST /api/demo/homework/<hw_id>/grade-all ─────────────────────────────────

@demo_bp.post("/demo/homework/<hw_id>/grade-all")
def demo_grade_all(hw_id: str):
    """
    Trigger grade-all for a homework. Returns pre-canned grade results
    for the 3 demo students without running real AI.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    now = _now()
    results = []
    for sub in _DEMO_SUBMISSION_DETAILS:
        results.append({
            "submission_id": sub["submission_id"],
            "student_name":  sub["student_name"],
            "score":         sub["score"],
            "max_score":     sub["max_score"],
            "percentage":    sub["percentage"],
            "status":        "graded",
        })

    logger.info("[demo] grade-all for homework %s — %d results", hw_id, len(results))
    return jsonify({
        "graded": len(results),
        "results": results,
    }), 200


# ── GET /api/demo/homework/<hw_id>/submissions ────────────────────────────────

@demo_bp.get("/demo/homework/<hw_id>/submissions")
def demo_homework_submissions(hw_id: str):
    """
    Return submissions for a homework, sorted ascending by submitted_at (earliest first).
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    subs = sorted(_DEMO_SUBMISSION_DETAILS, key=lambda s: s["submitted_at"])
    return jsonify({"submissions": subs}), 200


# ── POST /api/demo/submissions/student ───────────────────────────────────────

@demo_bp.post("/demo/submissions/student")
def demo_student_submission_create():
    """
    Accept a student's demo submission (image, PDF, or text).
    Stores metadata in Firestore; returns a submission_id for polling.
    Body: { homework_id, answer_key_id, file_data?, media_type?, file_name? }
    Returns 201 { submission_id, status: "received" }
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    homework_id    = (body.get("homework_id") or DEMO_HW_ID).strip()
    answer_key_id  = (body.get("answer_key_id") or "demo-key").strip()
    file_data      = body.get("file_data") or ""
    media_type     = (body.get("media_type") or "image/jpeg").strip()
    file_name      = (body.get("file_name") or "submission.jpg").strip()

    if not homework_id:
        return jsonify({"error": "homework_id is required"}), 400

    # Validate: must be image, PDF, or Word — no executable types
    allowed_prefixes = ("image/", "application/pdf",
                        "application/vnd.openxmlformats",
                        "application/msword", "text/")
    if not any(media_type.startswith(p) for p in allowed_prefixes):
        return jsonify({"error": "Unsupported file type"}), 400

    import uuid
    submission_id = f"sub-{uuid.uuid4().hex[:8]}"
    doc = {
        "submission_id": submission_id,
        "homework_id":   homework_id,
        "answer_key_id": answer_key_id,
        "media_type":    media_type,
        "file_name":     file_name,
        "status":        "received",
        "submitted_at":  datetime.utcnow().isoformat() + "Z",
        # Store a stub — file_data is not persisted in the demo
        "has_file":      bool(file_data),
    }
    upsert("demo_student_submissions", submission_id, doc)
    logger.info("[demo] student submission received: %s  hw=%s", submission_id, homework_id)
    return jsonify({"submission_id": submission_id, "status": "received"}), 201


# ── POST /api/demo/pin/remove ─────────────────────────────────────────────────

@demo_bp.post("/demo/pin/remove")
def demo_pin_remove():
    """
    Remove the demo user's PIN after verifying it.
    Body: { user_id, pin }
    Returns 200 { success: true, pin_active: false } on success.
    """
    if _guard():
        return jsonify({"error": "Not available in production"}), 403

    body = request.get_json(silent=True) or {}
    user_id = (body.get("user_id") or DEMO_TEACHER_ID).strip()
    pin     = (body.get("pin") or "").strip()

    err = _validate_pin_digits(pin)
    if err:
        return jsonify({"error": err}), 400

    doc = _get_pin_doc(user_id)
    if not doc:
        return jsonify({"error": "No PIN set"}), 404

    if not verify_pin(pin, doc["pin_hash"]):
        return jsonify({"error": "Incorrect PIN"}), 401

    delete_doc(_PIN_COLLECTION, user_id)
    logger.info("[demo] PIN removed for user %s", user_id)
    return jsonify({"success": True, "pin_active": False}), 200
