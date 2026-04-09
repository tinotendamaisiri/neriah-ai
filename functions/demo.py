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
import uuid
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from shared.auth import create_jwt
from shared.config import is_demo, settings
from shared.firestore_client import delete_doc, get_db, query, upsert

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

    # Re-seed
    seeded = _seed()

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
