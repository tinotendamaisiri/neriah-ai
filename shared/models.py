from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uid() -> str:
    return str(uuid.uuid4())


# ─── Enumerations ─────────────────────────────────────────────────────────────

class EducationLevel(str, Enum):
    GRADE_1 = "Grade 1"
    GRADE_2 = "Grade 2"
    GRADE_3 = "Grade 3"
    GRADE_4 = "Grade 4"
    GRADE_5 = "Grade 5"
    GRADE_6 = "Grade 6"
    GRADE_7 = "Grade 7"
    FORM_1 = "Form 1"
    FORM_2 = "Form 2"
    FORM_3 = "Form 3"
    FORM_4 = "Form 4"
    FORM_5 = "Form 5 (A-Level)"
    FORM_6 = "Form 6 (A-Level)"
    COLLEGE = "College/University"


class MarkSource(str, Enum):
    TEACHER_SCAN = "teacher_scan"
    STUDENT_SUBMISSION = "student_submission"


class WhatsAppState(str, Enum):
    IDLE = "IDLE"
    CLASS_SETUP = "CLASS_SETUP"
    AWAITING_REGISTER = "AWAITING_REGISTER"
    AWAITING_ANSWER_KEY = "AWAITING_ANSWER_KEY"
    MARKING_ACTIVE = "MARKING_ACTIVE"
    ERROR = "ERROR"
    # Student self-registration flow
    STUDENT_ONBOARDING_SCHOOL = "STUDENT_ONBOARDING_SCHOOL"
    STUDENT_ONBOARDING_CLASS = "STUDENT_ONBOARDING_CLASS"
    STUDENT_ONBOARDING_NAME = "STUDENT_ONBOARDING_NAME"
    STUDENT_ONBOARDING_CONFIRM = "STUDENT_ONBOARDING_CONFIRM"


# ─── Domain models ────────────────────────────────────────────────────────────

class Teacher(BaseModel):
    id: str = Field(default_factory=_uid)
    phone: str
    name: str
    title: Optional[str] = None
    school_name: Optional[str] = None
    school_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: _now().isoformat())
    token_version: int = 0
    pin_hash: Optional[str] = None
    pin_attempts: int = 0
    pin_locked: bool = False
    role: str = "teacher"


class Student(BaseModel):
    id: str = Field(default_factory=_uid)
    class_id: str
    first_name: str
    surname: str
    register_number: Optional[str] = None
    phone: Optional[str] = None
    created_at: str = Field(default_factory=lambda: _now().isoformat())
    role: str = "student"
    token_version: int = 0


class Class(BaseModel):
    id: str = Field(default_factory=_uid)
    teacher_id: str
    name: str
    education_level: str
    curriculum: str = "zimsec"
    join_code: str = Field(default_factory=lambda: str(uuid.uuid4())[:6].upper())
    student_count: int = 0
    created_at: str = Field(default_factory=lambda: _now().isoformat())


class AnswerKeyQuestion(BaseModel):
    question_number: int
    question_text: str
    answer: str
    marks: float
    marking_notes: Optional[str] = None


class AnswerKey(BaseModel):
    id: str = Field(default_factory=_uid)
    class_id: str
    teacher_id: str
    title: str
    education_level: str = ""
    subject: Optional[str] = None
    questions: list[AnswerKeyQuestion] = []
    total_marks: float = 0.0
    open_for_submission: bool = False
    generated: bool = False
    status: Optional[str] = None
    due_date: Optional[str] = None
    created_at: str = Field(default_factory=lambda: _now().isoformat())


class GradingVerdict(BaseModel):
    question_number: int
    student_answer: str
    expected_answer: str
    verdict: str  # "correct" | "incorrect" | "partial"
    awarded_marks: float
    max_marks: float
    feedback: Optional[str] = None


class Mark(BaseModel):
    id: str = Field(default_factory=_uid)
    student_id: str
    class_id: str
    answer_key_id: str
    teacher_id: str
    score: float
    max_score: float
    percentage: float
    verdicts: list[GradingVerdict] = []
    marked_image_url: Optional[str] = None
    source: str = MarkSource.TEACHER_SCAN
    approved: bool = True
    timestamp: str = Field(default_factory=lambda: _now().isoformat())


class Session(BaseModel):
    """WhatsApp conversation state."""
    id: str  # == phone
    phone: str
    state: str = WhatsAppState.IDLE
    context: dict = {}
    updated_at: str = Field(default_factory=lambda: _now().isoformat())


class OTPVerification(BaseModel):
    id: str  # == phone
    phone: str
    otp_hash: str  # SHA-256 hex
    attempts: int = 0
    created_at: str = Field(default_factory=lambda: _now().isoformat())


# ─── Tertiary models ──────────────────────────────────────────────────────────

class RubricCriterion(BaseModel):
    id: str
    name: str
    description: str
    marks: float
    levels: dict[str, str] = {}  # {"Distinction": "...", "Merit": "...", ...}


class Rubric(BaseModel):
    id: str = Field(default_factory=_uid)
    class_id: str
    teacher_id: str
    title: str
    education_level: str
    total_marks: float = 100.0
    criteria: list[RubricCriterion] = []
    created_at: str = Field(default_factory=lambda: _now().isoformat())


class Submission(BaseModel):
    id: str = Field(default_factory=_uid)
    student_id: str
    class_id: str
    teacher_id: str
    rubric_id: str
    file_url: str
    extracted_text: Optional[str] = None
    verdicts: list[dict] = []
    score: float = 0.0
    max_score: float = 100.0
    approved: bool = False
    submitted_at: str = Field(default_factory=lambda: _now().isoformat())


# ─── Response helpers ─────────────────────────────────────────────────────────

class ImageQualityResult(BaseModel):
    pass_check: bool = Field(alias="pass")
    reason: str
    suggestion: str

    model_config = {"populate_by_name": True}
