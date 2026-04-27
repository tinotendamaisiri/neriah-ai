"""
shared/role_invariants.py — runtime enforcement of role-based foreign
key invariants.

Firestore has no native foreign-key constraints, so the invariants

  - Mark.student_id   ∈ students (never teachers)
  - Mark.teacher_id   ∈ teachers (never students)
  - AnswerKey.teacher_id ∈ teachers (never students)

are enforced at write time by these helpers. Every place that
constructs a Mark or an AnswerKey calls assert_is_student /
assert_is_teacher with the relevant ID before persisting; on a
mismatch, the helper raises RoleInvariantError, the write is
refused, and the request returns a 4xx error.

Why this matters: bugs that mix up role IDs (e.g. a JWT subject for
a student being passed where a teacher_id is expected) silently
corrupt the analytics, the teacher's roster, and the student's
result page. Once a Mark has the wrong student_id, no downstream
code catches it. We catch it at the write boundary.

Implementation notes:
  - One get_doc per invariant call. Cheap (Firestore single-doc reads
    are ~5 ms) and fires only on writes, which are uncommon in this
    workload compared to reads.
  - The helpers raise; callers are expected to translate the
    exception to a user-facing 4xx. Never silently swallow.

Public API:
    assert_is_student(student_id)
    assert_is_teacher(user_id)
"""

from __future__ import annotations

import logging

from shared.firestore_client import get_doc

logger = logging.getLogger(__name__)


class RoleInvariantError(ValueError):
    """Raised when an ID is being used in the wrong role context."""

    def __init__(self, message: str, *, expected: str, actual: str | None = None, doc_id: str = ""):
        super().__init__(message)
        self.expected = expected
        self.actual = actual
        self.doc_id = doc_id


def assert_is_student(student_id: str) -> None:
    """Verify `student_id` exists in the `students` collection. Raises
    RoleInvariantError when it's missing OR when it instead resolves
    to a `teachers` doc — i.e. the caller mixed up role IDs.
    """
    if not student_id:
        raise RoleInvariantError(
            "student_id is required",
            expected="student",
            doc_id=student_id,
        )
    if get_doc("students", student_id):
        return
    # Not in students. Check teachers — the most useful diagnostic
    # comes from telling the caller they crossed roles, not just
    # "not found".
    if get_doc("teachers", student_id):
        raise RoleInvariantError(
            f"id {student_id!r} resolves to a teacher; refusing to attach a Mark to a teacher account",
            expected="student",
            actual="teacher",
            doc_id=student_id,
        )
    raise RoleInvariantError(
        f"student_id {student_id!r} not found in students collection",
        expected="student",
        actual=None,
        doc_id=student_id,
    )


def assert_is_teacher(user_id: str) -> None:
    """Verify `user_id` exists in the `teachers` collection. Raises
    RoleInvariantError when it's missing OR when it instead resolves
    to a `students` doc — protects AnswerKey.teacher_id and
    Mark.teacher_id from being assigned to a student account.
    """
    if not user_id:
        raise RoleInvariantError(
            "teacher_id is required",
            expected="teacher",
            doc_id=user_id,
        )
    if get_doc("teachers", user_id):
        return
    if get_doc("students", user_id):
        raise RoleInvariantError(
            f"id {user_id!r} resolves to a student; refusing to credit homework or grading to a student account",
            expected="teacher",
            actual="student",
            doc_id=user_id,
        )
    raise RoleInvariantError(
        f"teacher_id {user_id!r} not found in teachers collection",
        expected="teacher",
        actual=None,
        doc_id=user_id,
    )
