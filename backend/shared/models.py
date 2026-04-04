# shared/models.py
# Pydantic v2 models for all Neriah domain objects.
# These are the canonical data shapes — used for Cosmos DB documents, API request/response bodies,
# and inter-function data passing.

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class EducationLevel(str, Enum):
    GRADE_1 = "grade_1"
    GRADE_2 = "grade_2"
    GRADE_3 = "grade_3"
    GRADE_4 = "grade_4"
    GRADE_5 = "grade_5"
    GRADE_6 = "grade_6"
    GRADE_7 = "grade_7"
    FORM_1 = "form_1"
    FORM_2 = "form_2"
    FORM_3 = "form_3"
    FORM_4 = "form_4"
    FORM_5 = "form_5"
    FORM_6 = "form_6"
    TERTIARY = "tertiary"


class SubscriptionStatus(str, Enum):
    ACTIVE = "active"
    TRIAL = "trial"
    EXPIRED = "expired"
    SUSPENDED = "suspended"


class GradingVerdictEnum(str, Enum):
    CORRECT = "correct"
    INCORRECT = "incorrect"
    PARTIAL = "partial"


class WhatsAppState(str, Enum):
    IDLE = "IDLE"
    CLASS_SETUP = "CLASS_SETUP"
    AWAITING_REGISTER = "AWAITING_REGISTER"
    AWAITING_ANSWER_KEY = "AWAITING_ANSWER_KEY"
    MARKING_ACTIVE = "MARKING_ACTIVE"
    ERROR = "ERROR"


# ── Core domain models ────────────────────────────────────────────────────────

class School(BaseModel):
    """Cosmos container: schools | partition key: /id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    city: str
    province: str
    type: str                               # "primary" | "secondary" | "tertiary"


class Teacher(BaseModel):
    """Cosmos container: teachers | partition key: /phone"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    phone: str                              # E.164 format, e.g. +263771234567 — also the partition key
    # UPDATED: split from single `name` field into first_name + surname
    first_name: str
    surname: str
    email: Optional[str] = None             # lecturer/teacher email for draft feedback and reports
    subscription_status: SubscriptionStatus = SubscriptionStatus.TRIAL
    education_levels_active: list[EducationLevel] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # New fields
    school: Optional[str] = None            # school or institution display name
    school_id: Optional[str] = None         # FK → School.id — None for manually-entered schools
    push_token: Optional[str] = None        # Expo push notification token
    role: str = "teacher"                   # always "teacher" for this model
    # Session integrity
    token_version: int = 1                  # incremented on account recovery to invalidate old JWTs
    # Optional PIN lock
    pin_hash: Optional[str] = None          # bcrypt hash of 4-digit PIN — None if PIN not set
    pin_locked: bool = False                # True after 5 consecutive wrong PIN attempts


class Class(BaseModel):
    """Cosmos container: classes | partition key: /teacher_id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    teacher_id: str                         # FK → Teacher.id
    name: str
    education_level: EducationLevel
    student_ids: list[str] = []             # FK list → Student.id
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # New fields
    join_code: Optional[str] = None         # 6-char alphanumeric, e.g. "A7B3K2" — auto-generated on create
    subject: Optional[str] = None           # e.g. "Mathematics", "English"
    grade: Optional[str] = None             # human-readable label, e.g. "Grade 7", "Form 2"
    share_analytics: bool = False           # whether students can see class analytics
    share_rank: bool = False                # whether students can see their rank in the class


class Student(BaseModel):
    """Cosmos container: students | partition key: /class_id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    class_id: str                           # FK → Class.id — also the partition key
    # UPDATED: split from single `name` field into first_name + surname
    first_name: str
    surname: str
    # UPDATED: phone is now Optional — not all students have a phone number
    phone: Optional[str] = None             # E.164 format — primary unique identifier e.g. +263771234567
    register_number: Optional[str] = None   # optional class register number for teacher reference
    # New fields
    push_token: Optional[str] = None        # Expo push notification token
    role: str = "student"                   # always "student" for this model
    # Session integrity
    token_version: int = 1                  # incremented on account recovery to invalidate old JWTs
    # Optional PIN lock
    pin_hash: Optional[str] = None          # bcrypt hash of 4-digit PIN — None if PIN not set
    pin_locked: bool = False                # True after 5 consecutive wrong PIN attempts


class Question(BaseModel):
    """A single question within an AnswerKey."""
    number: int                             # 1-indexed question number
    correct_answer: str
    max_marks: float = 1.0
    marking_notes: Optional[str] = None     # e.g. "accept any two of the following"


class AnswerKey(BaseModel):
    """Cosmos container: answer_keys | partition key: /class_id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    class_id: str                           # FK → Class.id
    subject: str
    questions: list[Question] = []
    generated: bool = False                 # True if auto-generated by GPT-4o-mini
    created_at: datetime = Field(default_factory=datetime.utcnow)
    # New fields
    title: Optional[str] = None             # human-readable assignment name, e.g. "Term 1 Math Test"
    teacher_id: Optional[str] = None        # denormalised FK → Teacher.id for faster queries
    education_level: Optional[EducationLevel] = None
    total_marks: Optional[float] = None     # computed from questions or set manually
    open_for_submission: bool = False       # whether students can submit against this answer key
    due_date: Optional[datetime] = None     # optional submission deadline shown to teacher and students
    status: Optional[str] = None           # None/"ready" = normal; "pending_setup" = auto-created, no scheme yet


class Mark(BaseModel):
    """Cosmos container: marks | partition key: /student_id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    student_id: str                         # FK → Student.id — also the partition key
    answer_key_id: str                      # FK → AnswerKey.id
    teacher_id: str                         # FK → Teacher.id — denormalised for analytics queries
    score: float
    max_score: float
    marked_image_url: Optional[str] = None  # SAS URL to annotated image — None if annotation failed
    raw_ocr_text: str                       # Full OCR text, stored for debugging / re-grading
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    # New fields
    class_id: Optional[str] = None          # denormalised FK → Class.id for queries
    source: str = "teacher_scan"            # "teacher_scan" | "student_submission" | "whatsapp" | "email"
    verdicts: list = []                     # stores the list of GradingVerdict dicts
    percentage: Optional[float] = None      # score / max_score * 100
    approved: bool = False                  # whether teacher has explicitly approved this mark
    feedback: Optional[str] = None          # teacher's optional text feedback
    file_type: str = "image"               # "image" | "pdf" | "docx"


# ── WhatsApp session ──────────────────────────────────────────────────────────

class SessionContext(BaseModel):
    """Embedded context object inside a WhatsApp session document."""
    class_id: Optional[str] = None
    answer_key_id: Optional[str] = None
    current_student_id: Optional[str] = None
    setup_step: Optional[str] = None        # tracks sub-step within a multi-turn flow


class Session(BaseModel):
    """Cosmos container: sessions | partition key: /phone | TTL: 86400s"""
    id: str                                 # same as phone — one session doc per teacher
    phone: str
    state: WhatsAppState = WhatsAppState.IDLE
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    context: SessionContext = Field(default_factory=SessionContext)
    ttl: int = 86400                        # Cosmos TTL in seconds — auto-deleted after 24 h of inactivity


# ── OCR / pipeline intermediate models ───────────────────────────────────────

class WordBound(BaseModel):
    """Bounding box for a single word returned by Azure Document Intelligence."""
    text: str
    x: float                                # left edge, pixels
    y: float                                # top edge, pixels
    width: float
    height: float


class BoundingBox(BaseModel):
    """Full OCR bounding box output for one document page."""
    page: int = 1
    words: list[WordBound] = []


class AnswerRegion(BaseModel):
    """Grouped bounding box for one question's answer region.
    Produced by ocr_client after clustering WordBounds by question proximity."""
    question_number: int
    words: list[WordBound] = []
    x: float
    y: float
    width: float
    height: float
    page: int = 1


class GradingVerdict(BaseModel):
    """Per-question grading result from GPT-4o-mini."""
    question_number: int
    verdict: GradingVerdictEnum
    awarded_marks: float
    max_marks: float = 1.0                  # max marks for this question, sourced from AnswerKey
    feedback: Optional[str] = None          # optional explanation — shown in App, not WhatsApp


# ── Tertiary assessment models ────────────────────────────────────────────────

class RubricCriterion(BaseModel):
    """A single grading criterion within a rubric."""
    number: int
    name: str
    description: str
    max_marks: float
    band_descriptors: dict[str, str] = {}   # {"distinction": "...", "merit": "...", "pass": "...", "fail": "..."}


class Rubric(BaseModel):
    """Cosmos container: rubrics | partition key: /class_id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    class_id: str                           # FK → Class.id
    teacher_id: str                         # FK → Teacher.id
    assignment_name: str
    assignment_brief: Optional[str] = None
    criteria: list[RubricCriterion] = []
    generated: bool = False                 # True if auto-generated by GPT-4o
    created_at: datetime = Field(default_factory=datetime.utcnow)


class CriterionVerdict(BaseModel):
    """Per-criterion grading result from GPT-4o for a document submission."""
    criterion_number: int
    criterion_name: str
    awarded_marks: float
    max_marks: float
    feedback: str                           # detailed feedback for this criterion
    band: str                               # "distinction" | "merit" | "pass" | "fail"


class SubmissionStatus(str, Enum):
    RECEIVED    = "received"
    GRADING     = "grading"
    DRAFT       = "draft"                   # graded, awaiting lecturer approval
    APPROVED    = "approved"                # lecturer approved, not yet sent to student
    RELEASED    = "released"                # feedback sent to student
    FAILED      = "failed"                  # pipeline error


class Submission(BaseModel):
    """Cosmos container: submissions | partition key: /student_id"""
    id: str = Field(default_factory=lambda: str(uuid4()))
    student_id: str                         # FK → Student.id
    class_id: str                           # FK → Class.id
    teacher_id: str                         # FK → Teacher.id
    rubric_id: str                          # FK → Rubric.id
    assignment_name: str
    submission_code: str                    # e.g. NER-2026-BCOM1-ACCT101-A2
    document_url: str                       # original submission in Blob Storage
    document_type: str                      # "pdf" | "pdf_scanned" | "docx" | "image" | "mixed"
    extracted_text: str = ""                # full extracted text stored for re-grading
    feedback_pdf_url: Optional[str] = None
    verdicts: list[CriterionVerdict] = []
    total_score: float = 0.0
    max_score: float = 0.0
    plagiarism_flag: bool = False
    status: SubmissionStatus = SubmissionStatus.RECEIVED
    student_email: Optional[str] = None     # email address to send feedback to
    submitted_at: datetime = Field(default_factory=datetime.utcnow)
    graded_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    released_at: Optional[datetime] = None


class SubmissionCode(BaseModel):
    """Submission code record linking a code to a class and rubric."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    code: str                               # e.g. NER-2026-BCOM1-ACCT101-A2
    class_id: str
    teacher_id: str
    rubric_id: str
    assignment_name: str
    active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)


# ── Quality gate ──────────────────────────────────────────────────────────────

class ImageQualityResult(BaseModel):
    """Result of the GPT-4o-mini image quality pre-flight check (WhatsApp only)."""
    pass_check: bool                        # True = image is good enough for OCR
    reason: str                             # machine-readable reason code
    suggestion: str                         # human-readable message sent to teacher via WhatsApp


# ── Auth ──────────────────────────────────────────────────────────────────────

class OTPVerification(BaseModel):
    """Cosmos container: otp_verifications | partition key: /phone | TTL: 600s

    Stores a pending OTP verification for teacher registration or login.
    The raw OTP is NEVER stored — only a SHA-256 hash.
    Auto-deleted by Cosmos TTL after 10 minutes.
    """
    id: str = Field(default_factory=lambda: str(uuid4()))   # verification_id returned to client
    phone: str                              # E.164 format — partition key
    otp_code: str                           # SHA-256 hash of the 6-digit OTP — never store raw
    role: str                               # "teacher" or "student"
    purpose: str                            # "register", "login", "activate", "student_register", or "account_recovery"
    pending_data: Optional[dict[str, Any]] = None  # for register: {first_name, surname, school, education_level}
                                                   # for login: {user_id, class_id?}
    channel_preference: str = "whatsapp"     # "whatsapp" or "sms" — what the user requested
    channel_used: Optional[str] = None      # "whatsapp", "sms", or "log" — what actually delivered
    # OTP ownership — determines how /api/auth/verify validates the code
    otp_method: str = "self"               # "self" = hash in otp_code field; "verify" = Twilio Verify API
    verify_sid: Optional[str] = None        # Twilio Verify Service SID — set when otp_method == "verify"
    attempts: int = 0                       # failed verification attempts — locked after 3
    created_at: datetime = Field(default_factory=datetime.utcnow)
    expires_at: datetime                    # created_at + 5 minutes
    verified: bool = False
    ttl: int = 600                          # Cosmos TTL seconds — auto-deleted after 10 minutes
