"""
shared/student_matcher.py — resolve an inbound email submission to the
right student record (or create one).

Pipeline used by functions/email_poller.py:

  parse_subject(subject, body_fallback)  → SubjectFields | None
  match_student(fields, sender_email)    → MatchResult

A submission is deemed routable when we have all three of (school, class,
student_name) AND can fuzzy-match the school + class. Student name
matching is NOT required — when no student matches in the resolved
class, we auto-enrol the sender as a new Student in that class
(per product policy: "if a student submits to a class they're not in,
they get auto-added").

Matching is intentionally cheap and ordered:

  1. If a Student already exists with this email AND is in some class,
     short-circuit straight there. (Second + emails from the same
     address skip every fuzzy step entirely.)
  2. Exact (case-insensitive) school name match.
  3. Fuzzy school name match via difflib (cutoff 0.85, mirrors the
     existing whatsapp.py:_fuzzy_match_school threshold tuned for
     SADC school name typos like "St Marys" vs "St Mary's").
  4. Filter classes by school_id, then exact + fuzzy class name match.
  5. Filter students by class_id, then exact + fuzzy student name match.
  6. No student match → auto-enrol.

Returns a MatchResult tagged with `status` so the caller can branch:

  MATCHED         single confident student → grade against any answer key
                  in this class
  AUTO_ENROLLED   sender wasn't in the class, we created the Student
  AMBIGUOUS_*     two+ candidates within the cutoff band — caller should
                  send a format-error reply asking for more detail
  NOT_FOUND       school or class couldn't be resolved at all
"""

from __future__ import annotations

import difflib
import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import Optional

from shared.firestore_client import get_doc, query, query_single, upsert
from shared.models import Student

logger = logging.getLogger(__name__)


# ─── Subject parsing ──────────────────────────────────────────────────────────

# Order matters: we try the most specific format first, then more
# permissive fallbacks. The pipe-delimited form is what's printed on the
# class slip — students who follow it get zero ambiguity.
_PIPE_RE = re.compile(
    r"name\s*[:\-]\s*(?P<name>[^|]+?)\s*\|\s*"
    r"class\s*[:\-]\s*(?P<class_name>[^|]+?)\s*\|\s*"
    r"school\s*[:\-]\s*(?P<school>.+)",
    re.IGNORECASE,
)
# Hyphen / em-dash / comma fallback: "John Smith - Form 4A - St Mary's"
_HYPHEN_RE = re.compile(
    r"^\s*(?P<name>[^\-,–—]+?)\s*[\-,–—]\s*(?P<class_name>[^\-,–—]+?)\s*[\-,–—]\s*(?P<school>.+?)\s*$",
)


@dataclass
class SubjectFields:
    student_name: str
    class_name: str
    school_name: str


def parse_subject(subject: str, body_fallback: str = "") -> Optional[SubjectFields]:
    """Try the subject first; if no fields parsed, sweep the first ~500
    chars of the body. Returns None when neither yields all three fields."""
    for source in (subject, body_fallback[:500]):
        if not source:
            continue
        m = _PIPE_RE.search(source)
        if not m:
            m = _HYPHEN_RE.match(source)
        if not m:
            continue
        return SubjectFields(
            student_name=m.group("name").strip(),
            class_name=m.group("class_name").strip(),
            school_name=m.group("school").strip().rstrip(".,;"),
        )
    return None


# ─── Match results ────────────────────────────────────────────────────────────

class MatchStatus(str, Enum):
    MATCHED = "matched"
    AUTO_ENROLLED = "auto_enrolled"
    AMBIGUOUS_SCHOOL = "ambiguous_school"
    AMBIGUOUS_CLASS = "ambiguous_class"
    NOT_FOUND_SCHOOL = "not_found_school"
    NOT_FOUND_CLASS = "not_found_class"


@dataclass
class MatchResult:
    status: MatchStatus
    student: Optional[dict] = None
    class_doc: Optional[dict] = None
    school: Optional[dict] = None
    # Human-readable detail for format-error reply emails (e.g. "no
    # school named 'St Marys' was found; closest matches: …").
    reason: str = ""


# ─── Fuzzy helpers ────────────────────────────────────────────────────────────

_SCHOOL_FUZZY_CUTOFF = 0.85
_CLASS_FUZZY_CUTOFF = 0.80
_STUDENT_FUZZY_CUTOFF = 0.85


def _fuzzy_pick(needle: str, haystack: list[dict], key: str, cutoff: float) -> list[dict]:
    """Return docs whose `key` field fuzzy-matches `needle` above cutoff.
    Combines exact case-insensitive containment + difflib ratio.
    """
    if not needle or not haystack:
        return []
    needle_l = needle.lower().strip()
    names = [(d.get(key, "") or "").strip() for d in haystack]
    # Exact case-insensitive match wins outright.
    exact = [d for d, n in zip(haystack, names) if n.lower() == needle_l]
    if exact:
        return exact
    # Substring match (e.g. "St Mary" inside "St Mary's High School").
    contains = [d for d, n in zip(haystack, names) if needle_l in n.lower()]
    if contains:
        return contains
    # Fall back to difflib ratio.
    close_names = set(difflib.get_close_matches(needle, names, n=5, cutoff=cutoff))
    return [d for d, n in zip(haystack, names) if n in close_names]


# ─── Matching ─────────────────────────────────────────────────────────────────

def match_student(fields: SubjectFields, sender_email: str) -> MatchResult:
    """Resolve a SubjectFields + sender to a (student, class, school).

    Performs auto-enrolment when school + class match but no student
    name matches in the class roster.
    """
    sender_email_norm = (sender_email or "").strip().lower()

    # 1. Email shortcut. If we've seen this address before, the matched
    #    Student is canonical — skip everything else. The caller still
    #    has to resolve the *class* though, since a student may be in
    #    multiple classes; we use the SubjectFields.class_name to pick
    #    which one the submission is for, and only fall back to the
    #    student's primary class_id when the subject class doesn't
    #    match any of theirs.
    if sender_email_norm:
        existing = query_single("students", [("email", "==", sender_email_norm)])
        if existing:
            class_doc = _resolve_class_for_returning_student(existing, fields.class_name)
            if class_doc:
                school = get_doc("schools", class_doc.get("school_id", "")) if class_doc.get("school_id") else None
                return MatchResult(
                    status=MatchStatus.MATCHED,
                    student=existing,
                    class_doc=class_doc,
                    school=school,
                )
            # Email known but the class name in this submission doesn't
            # match any of theirs — fall through to the full resolve so
            # we can auto-enrol them in the new class too.

    # 2 + 3. School resolve.
    schools = query("schools", []) or []
    school_matches = _fuzzy_pick(fields.school_name, schools, "name", _SCHOOL_FUZZY_CUTOFF)
    if not school_matches:
        return MatchResult(
            status=MatchStatus.NOT_FOUND_SCHOOL,
            reason=f"We couldn't find a school called '{fields.school_name}' in our records.",
        )
    if len(school_matches) > 1:
        names = ", ".join(s.get("name", "") for s in school_matches[:3])
        return MatchResult(
            status=MatchStatus.AMBIGUOUS_SCHOOL,
            reason=f"Multiple schools matched '{fields.school_name}': {names}. Please use the exact school name.",
        )
    school = school_matches[0]

    # 4. Class resolve, scoped to that school.
    classes = query("classes", [("school_id", "==", school["id"])]) or []
    class_matches = _fuzzy_pick(fields.class_name, classes, "name", _CLASS_FUZZY_CUTOFF)
    if not class_matches:
        return MatchResult(
            status=MatchStatus.NOT_FOUND_CLASS,
            school=school,
            reason=f"We couldn't find a class called '{fields.class_name}' at {school.get('name','')}.",
        )
    if len(class_matches) > 1:
        names = ", ".join(c.get("name", "") for c in class_matches[:3])
        return MatchResult(
            status=MatchStatus.AMBIGUOUS_CLASS,
            school=school,
            reason=f"Multiple classes matched '{fields.class_name}' at {school.get('name','')}: {names}.",
        )
    class_doc = class_matches[0]

    # 5. Student name resolve, scoped to that class.
    students = query("students", [("class_id", "==", class_doc["id"])]) or []
    # Match against either first_name+surname or full name string.
    name_haystack: list[dict] = []
    for s in students:
        full = f"{s.get('first_name','')} {s.get('surname','')}".strip()
        name_haystack.append({**s, "_full": full})
    student_matches = _fuzzy_pick(fields.student_name, name_haystack, "_full", _STUDENT_FUZZY_CUTOFF)
    if len(student_matches) == 1:
        student = student_matches[0]
        # Backfill email on first match-by-name from this address so
        # the next submission takes the email shortcut.
        if sender_email_norm and not student.get("email"):
            student = {**student, "email": sender_email_norm}
            student.pop("_full", None)
            upsert("students", student["id"], student)
        return MatchResult(
            status=MatchStatus.MATCHED,
            student={k: v for k, v in student.items() if k != "_full"},
            class_doc=class_doc,
            school=school,
        )

    # 6. No (or ambiguous) student match → auto-enrol the sender. We
    #    intentionally do this even on AMBIGUOUS to honour the policy
    #    "if a student submits to a class they're not in, they get
    #    auto-added"; the teacher resolves any duplicate later from
    #    the roster.
    new_student = _auto_enrol(fields.student_name, sender_email_norm, class_doc)
    return MatchResult(
        status=MatchStatus.AUTO_ENROLLED,
        student=new_student,
        class_doc=class_doc,
        school=school,
    )


def _resolve_class_for_returning_student(student: dict, requested_class_name: str) -> Optional[dict]:
    """For a known-by-email student, pick the class their submission
    targets. Prefers an exact class-name match against any of their
    enrolments; falls back to their primary class_id."""
    class_ids = student.get("class_ids") or []
    if student.get("class_id") and student["class_id"] not in class_ids:
        class_ids = [student["class_id"], *class_ids]

    candidates: list[dict] = []
    for cid in class_ids:
        c = get_doc("classes", cid)
        if c:
            candidates.append(c)

    if not candidates:
        return None

    matches = _fuzzy_pick(requested_class_name, candidates, "name", _CLASS_FUZZY_CUTOFF)
    if matches:
        return matches[0]
    # Class name in subject doesn't match any of their enrolments.
    return None


def _auto_enrol(student_name: str, sender_email: str, class_doc: dict) -> dict:
    """Create a new Student in `class_doc` and return the dict."""
    parts = student_name.strip().split(None, 1)
    first_name = parts[0] if parts else "Student"
    surname = parts[1] if len(parts) > 1 else ""
    student = Student(
        class_id=class_doc["id"],
        class_ids=[class_doc["id"]],
        first_name=first_name,
        surname=surname,
        email=sender_email or None,
    )
    doc = student.model_dump()
    upsert("students", student.id, doc)
    logger.info(
        "student_matcher: auto-enrolled %s %s into class %s (%s)",
        first_name, surname, class_doc.get("name", ""), class_doc["id"],
    )
    return doc
