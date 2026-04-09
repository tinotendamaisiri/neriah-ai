"""
Seed the demo Firestore database with baseline data.

Usage (run from repo root):

    NERIAH_ENV=demo FIRESTORE_DATABASE=demo \
    GCS_BUCKET_SCANS=neriah-demo-scans \
    GCS_BUCKET_MARKED=neriah-demo-marked \
    GCS_BUCKET_SUBMISSIONS=neriah-demo-submissions \
    APP_JWT_SECRET=<demo_secret> \
    WHATSAPP_VERIFY_TOKEN=x WHATSAPP_ACCESS_TOKEN=x WHATSAPP_PHONE_NUMBER_ID=x \
    python scripts/seed_demo.py

The script is idempotent — running it twice is safe (Firestore upserts).
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure repo root is on sys.path so shared/ imports work
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# ── Validate environment ──────────────────────────────────────────────────────

if os.getenv("NERIAH_ENV") != "demo":
    print("ERROR: NERIAH_ENV must be 'demo' before running this script.", file=sys.stderr)
    print("  Set: export NERIAH_ENV=demo FIRESTORE_DATABASE=demo", file=sys.stderr)
    sys.exit(1)

# ── Imports (after path setup) ────────────────────────────────────────────────

from shared.firestore_client import upsert  # noqa: E402

# ── Constants (must match functions/demo.py) ──────────────────────────────────

DEMO_TEACHER_ID = "demo-teacher-1"
DEMO_STUDENT_ID = "demo-student-1"
DEMO_CLASS_ID   = "demo-class-1"
DEMO_SCHOOL_ID  = "demo-school-1"
DEMO_HW_ID      = "demo-homework-1"

_DEMO_QUESTIONS = [
    {"question_number": 1, "question_text": "Solve for x: 2x + 5 = 11",          "answer": "x = 3",   "marks": 2},
    {"question_number": 2, "question_text": "What is 15% of 200?",                "answer": "30",      "marks": 2},
    {"question_number": 3, "question_text": "Area of rectangle 8cm × 5cm",        "answer": "40 cm²",  "marks": 2},
    {"question_number": 4, "question_text": "Simplify 3(2x+4) − 2(x−1)",         "answer": "4x + 14", "marks": 2},
    {"question_number": 5, "question_text": "Probability of red (3 red, 7 blue)", "answer": "3/10",    "marks": 2},
]

# ── Seed ──────────────────────────────────────────────────────────────────────

def seed() -> None:
    now = datetime.now(timezone.utc).isoformat()

    upsert("schools", DEMO_SCHOOL_ID, {
        "id": DEMO_SCHOOL_ID, "name": "Greendale Primary School",
        "city": "Harare", "country": "Zimbabwe",
        "subscription_active": True, "created_at": now,
    })
    print(f"  school:     {DEMO_SCHOOL_ID}")

    upsert("teachers", DEMO_TEACHER_ID, {
        "id": DEMO_TEACHER_ID, "phone": "+1234567890",
        "name": "Mr. Maisiri", "title": "Mr",
        "school_id": DEMO_SCHOOL_ID, "school_name": "Greendale Primary School",
        "role": "teacher", "token_version": 0, "created_at": now,
    })
    print(f"  teacher:    {DEMO_TEACHER_ID}")

    upsert("classes", DEMO_CLASS_ID, {
        "id": DEMO_CLASS_ID, "name": "Form 2A", "subject": "Mathematics",
        "curriculum": "ZIMSEC", "education_level": "form_2",
        "teacher_id": DEMO_TEACHER_ID, "school_id": DEMO_SCHOOL_ID,
        "student_count": 1, "created_at": now,
    })
    print(f"  class:      {DEMO_CLASS_ID}")

    upsert("students", DEMO_STUDENT_ID, {
        "id": DEMO_STUDENT_ID, "name": "Tendai Moyo",
        "phone": "+0987654321", "role": "student",
        "school_id": DEMO_SCHOOL_ID, "class_id": DEMO_CLASS_ID,
        "token_version": 0, "created_at": now,
    })
    print(f"  student:    {DEMO_STUDENT_ID}")

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
    print(f"  answer_key: {DEMO_HW_ID}")

    print("\nDemo seed complete.")


if __name__ == "__main__":
    print("Seeding demo Firestore database…\n")
    seed()
