#!/usr/bin/env python3
# scripts/seed_dev.py
# Seeds Azure Cosmos DB with sample teachers, classes, students, and answer keys for local dev.
# Run: python scripts/seed_dev.py
# Requires backend/local.settings.json to be populated with real Cosmos credentials.

import sys
import os

# Add backend/ to path so shared/ imports work
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from shared.config import settings
from shared.cosmos_client import upsert_item
from shared.models import (
    Teacher, Class, Student, AnswerKey, Question,
    EducationLevel, SubscriptionStatus,
)


def seed():
    print("Seeding Cosmos DB for dev environment...")

    # ── Teacher ───────────────────────────────────────────────────────────────
    teacher = Teacher(
        id="teacher-seed-001",
        phone="+263771234567",
        name="Mrs. Chikwanda",
        subscription_status=SubscriptionStatus.TRIAL,
        education_levels_active=[EducationLevel.GRADE_7, EducationLevel.FORM_1],
    )
    upsert_item("teachers", teacher.model_dump())
    print(f"  Teacher: {teacher.name} ({teacher.phone})")

    # ── Class ─────────────────────────────────────────────────────────────────
    cls = Class(
        id="class-seed-001",
        teacher_id=teacher.id,
        name="7B Mathematics",
        education_level=EducationLevel.GRADE_7,
    )
    upsert_item("classes", cls.model_dump())
    print(f"  Class: {cls.name}")

    # ── Students ──────────────────────────────────────────────────────────────
    student_names = [
        ("Tendai Moyo", "01"),
        ("Rudo Chikwanda", "02"),
        ("Tinashe Maposa", "03"),
        ("Simbai Ncube", "04"),
        ("Farai Mutasa", "05"),
    ]
    students = []
    for name, reg in student_names:
        student = Student(
            class_id=cls.id,
            name=name,
            register_number=reg,
        )
        upsert_item("students", student.model_dump())
        students.append(student)
        cls.student_ids.append(student.id)

    # Update class with student IDs
    upsert_item("classes", cls.model_dump())
    print(f"  Students: {len(students)} created")

    # ── Answer Key ────────────────────────────────────────────────────────────
    answer_key = AnswerKey(
        id="answerkey-seed-001",
        class_id=cls.id,
        subject="Mathematics",
        generated=False,
        questions=[
            Question(number=1, correct_answer="42", max_marks=2, marking_notes="Accept 42 or forty-two"),
            Question(number=2, correct_answer="Paris", max_marks=1),
            Question(number=3, correct_answer="H2O", max_marks=1, marking_notes="Must include subscript 2"),
            Question(number=4, correct_answer="64", max_marks=2),
            Question(number=5, correct_answer="photosynthesis", max_marks=2, marking_notes="Accept 'photo synthesis' as partial"),
        ],
    )
    upsert_item("answer_keys", answer_key.model_dump())
    print(f"  Answer key: {answer_key.subject} ({len(answer_key.questions)} questions)")

    print("\nSeed complete.")
    print(f"  Teacher phone: {teacher.phone}")
    print(f"  Class ID: {cls.id}")
    print(f"  Answer key ID: {answer_key.id}")


if __name__ == "__main__":
    # TODO: add --reset flag to delete all seeded documents before re-seeding
    seed()
