"""
tests/test_teacher_daily_flow.py

Unit tests for the core teacher daily use flow.
All Firestore, GCS, and Gemma 4 calls are mocked — no network or cloud required.

Run:
    pytest tests/test_teacher_daily_flow.py -v
"""

from __future__ import annotations

import io
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

# ── Constants ──────────────────────────────────────────────────────────────────

TEACHER_ID    = "test-teacher-001"
CLASS_ID      = "test-class-001"
HOMEWORK_ID   = "test-homework-001"
STUDENT_ID    = "test-student-001"
SUBMISSION_ID = "test-sub-001"
SUB_NOIMG_ID  = "test-sub-noimg"
MARK_ID       = "test-mark-001"

# ── Firestore fixtures ─────────────────────────────────────────────────────────

_CLASS = {
    "id": CLASS_ID,
    "teacher_id": TEACHER_ID,
    "name": "Grade 4A",
    "education_level": "grade_4",
}

_HOMEWORK_NO_QUESTIONS = {
    "id": HOMEWORK_ID,
    "class_id": CLASS_ID,
    "teacher_id": TEACHER_ID,
    "title": "Week 3 Maths",
    "education_level": "grade_4",
    "subject": "Mathematics",
    "questions": [],
    "total_marks": 0,
    "open_for_submission": False,
    "generated": False,
    "status": "pending_setup",
}

_HOMEWORK_WITH_QUESTIONS = {
    **_HOMEWORK_NO_QUESTIONS,
    "questions": [
        {"question_number": 1, "question_text": "2+2=?", "answer": "4", "marks": 1},
        {"question_number": 2, "question_text": "Capital of Zimbabwe?", "answer": "Harare", "marks": 1},
    ],
    "total_marks": 2,
    "generated": True,
    "status": "active",
}

_HOMEWORK_OPEN = {
    **_HOMEWORK_WITH_QUESTIONS,
    "open_for_submission": True,
}

_HOMEWORK_CLOSED = {
    **_HOMEWORK_WITH_QUESTIONS,
    "open_for_submission": False,
}

_SUBMISSION_PENDING = {
    "id": SUBMISSION_ID,
    "submission_id": SUBMISSION_ID,
    "student_id": STUDENT_ID,
    "answer_key_id": HOMEWORK_ID,
    "class_id": CLASS_ID,
    "status": "pending",
    "image_urls": ["gs://neriah-test-submissions/s001/page1.jpg"],
    "submitted_at": "2026-04-12T10:00:00Z",
}

_SUBMISSION_NO_IMAGES = {
    **_SUBMISSION_PENDING,
    "id": SUB_NOIMG_ID,
    "submission_id": SUB_NOIMG_ID,
    "image_urls": [],
}

_SUBMISSION_GRADED = {
    **_SUBMISSION_PENDING,
    "status": "graded",
    "mark_id": MARK_ID,
    "score": 1.5,
    "max_score": 2.0,
    "percentage": 75.0,
}

_MARK = {
    "id": MARK_ID,
    "student_id": STUDENT_ID,
    "answer_key_id": HOMEWORK_ID,
    "class_id": CLASS_ID,
    "teacher_id": TEACHER_ID,
    "score": 1.5,
    "max_score": 2.0,
    "percentage": 75.0,
    "approved": False,
    "source": "student_submission",
    "verdicts": [
        {"question_number": 1, "verdict": "correct", "awarded_marks": 1, "max_marks": 1,
         "student_answer": "4", "expected_answer": "4", "feedback": None},
        {"question_number": 2, "verdict": "partial", "awarded_marks": 0.5, "max_marks": 1,
         "student_answer": "harare", "expected_answer": "Harare", "feedback": None},
    ],
}

_TEACHER_DOC = {
    "id": TEACHER_ID,
    "phone": "+263771234567",
    "name": "Test Teacher",
    "role": "teacher",
    "token_version": 1,
}

_FAKE_VERDICTS = [
    {"question_number": 1, "student_answer": "4", "expected_answer": "4",
     "verdict": "correct", "awarded_marks": 1.0, "max_marks": 1.0, "feedback": None},
    {"question_number": 2, "student_answer": "Harare", "expected_answer": "Harare",
     "verdict": "correct", "awarded_marks": 1.0, "max_marks": 1.0, "feedback": None},
]

# ── Helpers ────────────────────────────────────────────────────────────────────

def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (255, 255, 255)).save(buf, format="JPEG")
    return buf.getvalue()


# ── App / JWT fixtures ─────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from main import app as flask_app
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture(scope="module")
def client(app):
    return app.test_client()


@pytest.fixture(scope="module")
def auth_headers():
    from shared.auth import create_jwt
    token = create_jwt(TEACHER_ID, "teacher", 1)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def bypass_token_version_check():
    """
    require_role() does a deferred Firestore lookup to verify token_version.
    Return None for all shared.firestore_client.get_doc calls so the check
    is skipped (doc is None → version check bypassed), letting handler-level
    patches run unobstructed.
    """
    with patch("shared.firestore_client.get_doc", return_value=None):
        yield


# ══════════════════════════════════════════════════════════════════════════════
# 1. Upload question paper photo → marking scheme generation
# ══════════════════════════════════════════════════════════════════════════════

class TestSchemeGeneration:

    def test_valid_image_generates_questions_and_marks(self, client, auth_headers):
        """Valid JPEG → Gemma extracts questions → saved to Firestore, returned in response."""
        gemma_out = {
            "questions": [
                {"question_number": 1, "answer": "4", "marks": 1},
                {"question_number": 2, "answer": "Harare", "marks": 1},
            ],
            "title": "Week 3 Maths",
        }
        fs = {}

        with patch("functions.answer_keys.get_doc", side_effect=lambda c, d:
                   _HOMEWORK_NO_QUESTIONS if (c, d) == ("answer_keys", HOMEWORK_ID)
                   else _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.upsert",
                   side_effect=lambda c, d, data: fs.update({(c, d): data})), \
             patch("functions.answer_keys.extract_answer_key_from_image",
                   return_value=gemma_out):

            resp = client.put(
                f"/api/answer-keys/{HOMEWORK_ID}",
                headers=auth_headers,
                content_type="multipart/form-data",
                data={"file": (io.BytesIO(_jpeg()), "paper.jpg")},
            )

        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert len(body["questions"]) == 2
        assert body["total_marks"] == 2
        assert body["generated"] is True

    def test_scheme_saved_against_correct_homework_id(self, client, auth_headers):
        """upsert must be called with the exact HOMEWORK_ID, not a new doc."""
        upsert_mock = MagicMock()

        with patch("functions.answer_keys.get_doc", side_effect=lambda c, d:
                   _HOMEWORK_NO_QUESTIONS if (c, d) == ("answer_keys", HOMEWORK_ID)
                   else _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.upsert", upsert_mock), \
             patch("functions.answer_keys.extract_answer_key_from_image",
                   return_value={"questions": [{"number": 1, "answer": "x", "marks": 1}]}):

            resp = client.put(
                f"/api/answer-keys/{HOMEWORK_ID}",
                headers=auth_headers,
                content_type="multipart/form-data",
                data={"file": (io.BytesIO(_jpeg()), "paper.jpg")},
            )

        assert resp.status_code == 200
        ak_calls = [c for c in upsert_mock.call_args_list if c.args[0] == "answer_keys"]
        assert all(c.args[1] == HOMEWORK_ID for c in ak_calls), (
            f"Expected upsert to HOMEWORK_ID={HOMEWORK_ID}, got: "
            f"{[c.args[1] for c in ak_calls]}"
        )

    def test_blurry_image_gemma_returns_empty_questions(self, client, auth_headers):
        """Gemma returns no questions (bad image) → empty list, no 500."""
        with patch("functions.answer_keys.get_doc", side_effect=lambda c, d:
                   _HOMEWORK_NO_QUESTIONS if (c, d) == ("answer_keys", HOMEWORK_ID)
                   else _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.upsert"), \
             patch("functions.answer_keys.extract_answer_key_from_image",
                   return_value={"questions": [], "title": None}):

            resp = client.put(
                f"/api/answer-keys/{HOMEWORK_ID}",
                headers=auth_headers,
                content_type="multipart/form-data",
                data={"file": (io.BytesIO(_jpeg()), "paper.jpg")},
            )

        assert resp.status_code == 200
        assert resp.get_json()["questions"] == []

    def test_unsupported_file_type_returns_400(self, client, auth_headers):
        """.exe file → 400 with 'Unsupported' in error."""
        with patch("functions.answer_keys.get_doc", side_effect=lambda c, d:
                   _HOMEWORK_NO_QUESTIONS if (c, d) == ("answer_keys", HOMEWORK_ID)
                   else _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.upsert"):

            resp = client.put(
                f"/api/answer-keys/{HOMEWORK_ID}",
                headers=auth_headers,
                content_type="multipart/form-data",
                data={"file": (io.BytesIO(b"binary garbage"), "malware.exe")},
            )

        assert resp.status_code == 400
        assert "Unsupported" in resp.get_json().get("error", "")

    def test_missing_image_in_generate_endpoint_returns_400(self, client, auth_headers):
        """POST /api/answer-keys/generate with no image file → 400."""
        with patch("functions.answer_keys.get_doc", side_effect=lambda c, d:
                   _CLASS if (c, d) == ("classes", CLASS_ID) else None):

            resp = client.post(
                "/api/answer-keys/generate",
                headers=auth_headers,
                content_type="multipart/form-data",
                data={"education_level": "grade_4", "class_id": CLASS_ID},
            )

        assert resp.status_code == 400
        assert "image" in resp.get_json().get("error", "").lower()

    def test_no_auth_returns_401(self, client):
        resp = client.put(
            f"/api/answer-keys/{HOMEWORK_ID}",
            content_type="multipart/form-data",
            data={"file": (io.BytesIO(_jpeg()), "paper.jpg")},
        )
        assert resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# 2. Open homework for student submissions
# ══════════════════════════════════════════════════════════════════════════════

class TestOpenHomework:

    def test_open_homework_returns_200_and_flag(self, client, auth_headers):
        """PATCH open_for_submission=True → 200, flag reflected in response."""
        with patch("functions.answer_keys.get_doc", return_value=_HOMEWORK_WITH_QUESTIONS), \
             patch("functions.answer_keys.upsert"):

            resp = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"open_for_submission": True},
            )

        assert resp.status_code == 200
        assert resp.get_json()["open_for_submission"] is True

    def test_open_writes_to_firestore(self, client, auth_headers):
        """upsert called with open_for_submission=True on the answer_keys collection."""
        upsert_mock = MagicMock()

        with patch("functions.answer_keys.get_doc", return_value=_HOMEWORK_WITH_QUESTIONS), \
             patch("functions.answer_keys.upsert", upsert_mock):

            client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"open_for_submission": True},
            )

        upsert_mock.assert_called_once_with(
            "answer_keys", HOMEWORK_ID, {"open_for_submission": True}
        )

    def test_open_without_questions_is_allowed_by_backend(self, client, auth_headers):
        """
        Backend does NOT block opening with 0 questions — the app enforces this guard.
        Document the contract: backend returns 200.
        """
        with patch("functions.answer_keys.get_doc", return_value=_HOMEWORK_NO_QUESTIONS), \
             patch("functions.answer_keys.upsert"):

            resp = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"open_for_submission": True},
            )

        assert resp.status_code == 200

    def test_open_forbidden_for_wrong_teacher(self, client):
        from shared.auth import create_jwt
        headers = {"Authorization": f"Bearer {create_jwt('wrong-teacher', 'teacher', 1)}"}

        with patch("functions.answer_keys.get_doc", return_value=_HOMEWORK_WITH_QUESTIONS):
            resp = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=headers,
                json={"open_for_submission": True},
            )

        assert resp.status_code == 403

    def test_close_homework_sets_flag_false(self, client, auth_headers):
        """Toggle back to closed — open_for_submission=False saved correctly."""
        upsert_mock = MagicMock()

        with patch("functions.answer_keys.get_doc", return_value=_HOMEWORK_OPEN), \
             patch("functions.answer_keys.upsert", upsert_mock):

            resp = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"open_for_submission": False},
            )

        assert resp.status_code == 200
        upsert_mock.assert_called_once_with(
            "answer_keys", HOMEWORK_ID, {"open_for_submission": False}
        )


# ══════════════════════════════════════════════════════════════════════════════
# 3. Grade All
# ══════════════════════════════════════════════════════════════════════════════

class TestGradeAll:

    def _run_grade_all(
        self,
        client,
        auth_headers,
        homework=None,
        submissions=None,
        grade_return=None,
        extra_upsert=None,
    ):
        hw = homework or _HOMEWORK_CLOSED
        subs = submissions if submissions is not None else [_SUBMISSION_PENDING]

        upsert_calls: list = []

        def capture_upsert(col, doc_id, data):
            upsert_calls.append((col, doc_id, data))
            if extra_upsert:
                extra_upsert(col, doc_id, data)

        with ExitStack() as stack:
            stack.enter_context(patch(
                "functions.answer_keys.get_doc",
                side_effect=lambda c, d:
                    hw if (c, d) == ("answer_keys", HOMEWORK_ID)
                    else _CLASS if (c, d) == ("classes", CLASS_ID)
                    else _TEACHER_DOC if (c, d) == ("teachers", TEACHER_ID)
                    else None,
            ))
            stack.enter_context(patch("functions.answer_keys.upsert", side_effect=capture_upsert))
            stack.enter_context(patch("functions.answer_keys.query", return_value=subs))
            stack.enter_context(patch(
                "functions.answer_keys._download_image_from_url", return_value=_jpeg()
            ))
            stack.enter_context(patch(
                "shared.gemma_client.grade_submission",
                return_value=grade_return or _FAKE_VERDICTS,
            ))
            stack.enter_context(patch("shared.annotator.annotate_image", return_value=_jpeg()))
            upload_mock = MagicMock()
            stack.enter_context(patch("shared.gcs_client.upload_bytes", upload_mock))
            stack.enter_context(patch(
                "shared.gcs_client.generate_signed_url",
                return_value="https://cdn.example.com/marked/out.jpg",
            ))
            stack.enter_context(patch("functions.push.send_teacher_notification"))
            stack.enter_context(patch("shared.whatsapp_client.send_text"))

            resp = client.post(
                f"/api/homework/{HOMEWORK_ID}/grade-all",
                headers=auth_headers,
            )

        return resp, upsert_calls, upload_mock

    # ── success path ───────────────────────────────────────────────────────────

    def test_grade_all_returns_200_with_counts(self, client, auth_headers):
        resp, _, _ = self._run_grade_all(client, auth_headers)
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body["graded"] == 1
        assert body["errors"] == 0
        assert len(body["results"]) == 1

    def test_grade_all_result_has_required_score_fields(self, client, auth_headers):
        """Each result must have score, max_score, percentage within valid ranges."""
        resp, _, _ = self._run_grade_all(client, auth_headers)
        result = resp.get_json()["results"][0]
        for field in ("score", "max_score", "percentage"):
            assert field in result, f"Missing field: {field}"
        assert 0 <= result["score"] <= result["max_score"]
        assert 0.0 <= result["percentage"] <= 100.0

    def test_grade_all_saves_mark_to_firestore(self, client, auth_headers):
        """A mark document is written with correct student/homework/score fields."""
        _, upsert_calls, _ = self._run_grade_all(client, auth_headers)

        mark_writes = [(c, d, data) for c, d, data in upsert_calls if c == "marks"]
        assert len(mark_writes) == 1, "Expected exactly one mark written"

        _, doc_id, data = mark_writes[0]
        assert data["student_id"] == STUDENT_ID
        assert data["answer_key_id"] == HOMEWORK_ID
        assert isinstance(data["score"], (int, float))
        assert isinstance(data["percentage"], float)
        assert data["approved"] is False, "New marks must not be auto-approved"

    def test_grade_all_uploads_annotated_image_to_gcs(self, client, auth_headers):
        """upload_bytes called once per submission to the marked bucket."""
        _, _, upload_mock = self._run_grade_all(client, auth_headers)
        upload_mock.assert_called_once()
        bucket_arg = upload_mock.call_args.args[0]
        assert "marked" in bucket_arg, f"Expected marked bucket, got: {bucket_arg}"

    def test_grade_all_empty_submissions_returns_zero(self, client, auth_headers):
        resp, _, _ = self._run_grade_all(client, auth_headers, submissions=[])
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["graded"] == 0
        assert "No pending" in body.get("message", "")

    def test_grade_all_partial_failure_graded_and_errored(self, client, auth_headers):
        """One valid + one no-image submission → graded=1, errors=1."""
        two_subs = [_SUBMISSION_PENDING, _SUBMISSION_NO_IMAGES]
        resp, upsert_calls, _ = self._run_grade_all(client, auth_headers, submissions=two_subs)

        assert resp.status_code == 200
        body = resp.get_json()
        assert body["graded"] == 1
        assert body["errors"] == 1

    def test_grade_all_failed_submission_flagged_in_firestore(self, client, auth_headers):
        """The no-image submission is written with status='error'."""
        two_subs = [_SUBMISSION_PENDING, _SUBMISSION_NO_IMAGES]
        _, upsert_calls, _ = self._run_grade_all(client, auth_headers, submissions=two_subs)

        error_writes = [
            data for col, doc_id, data in upsert_calls
            if col == "student_submissions" and data.get("status") == "error"
        ]
        assert len(error_writes) == 1

    def test_grade_all_blocked_when_open_for_submission(self, client, auth_headers):
        """grade-all requires submissions to be closed first → 400."""
        resp, _, _ = self._run_grade_all(client, auth_headers, homework=_HOMEWORK_OPEN)
        assert resp.status_code == 400
        assert "Close" in resp.get_json().get("error", "")

    def test_grade_all_blocked_without_answer_key(self, client, auth_headers):
        """Homework with no questions → 400."""
        hw_empty = {**_HOMEWORK_CLOSED, "questions": []}
        resp, _, _ = self._run_grade_all(client, auth_headers, homework=hw_empty)
        assert resp.status_code == 400
        assert "answer key" in resp.get_json().get("error", "").lower()


# ══════════════════════════════════════════════════════════════════════════════
# 4. Approve individual grade
# ══════════════════════════════════════════════════════════════════════════════

class TestApproveGrade:

    def _approve(self, client, headers, sub=None, hw=None):
        sub = sub or _SUBMISSION_GRADED
        hw = hw or _HOMEWORK_WITH_QUESTIONS
        upsert_mock = MagicMock()

        with patch("functions.submissions.get_doc", side_effect=lambda c, d:
                   sub if (c, d) == ("student_submissions", SUBMISSION_ID)
                   else hw if (c, d) == ("answer_keys", HOMEWORK_ID) else None), \
             patch("functions.submissions.upsert", upsert_mock), \
             patch("functions.submissions.collect_training_sample"), \
             patch("functions.submissions.update_student_weaknesses"):

            resp = client.post(
                f"/api/submissions/{SUBMISSION_ID}/approve",
                headers=headers,
            )

        return resp, upsert_mock

    def test_approve_returns_200(self, client, auth_headers):
        resp, _ = self._approve(client, auth_headers)
        assert resp.status_code == 200
        assert resp.get_json()["submission_id"] == SUBMISSION_ID

    def test_approve_sets_status_approved_on_submission(self, client, auth_headers):
        """student_submissions doc updated to status='approved'."""
        _, upsert_mock = self._approve(client, auth_headers)
        sub_calls = [c for c in upsert_mock.call_args_list
                     if c.args[0] == "student_submissions"]
        assert any(c.args[2].get("status") == "approved" for c in sub_calls), (
            f"Expected status=approved. Calls: {upsert_mock.call_args_list}"
        )

    def test_approve_sets_approved_true_on_mark(self, client, auth_headers):
        """marks doc updated with approved=True."""
        _, upsert_mock = self._approve(client, auth_headers)
        mark_calls = [c for c in upsert_mock.call_args_list if c.args[0] == "marks"]
        assert any(c.args[2].get("approved") is True for c in mark_calls), (
            "Expected approved=True written to marks collection"
        )

    def test_approve_idempotent_already_approved_returns_400(self, client, auth_headers):
        """Already-approved submission → 400 (status must be 'graded')."""
        already_approved = {**_SUBMISSION_GRADED, "status": "approved"}
        resp, _ = self._approve(client, auth_headers, sub=already_approved)
        assert resp.status_code == 400

    def test_approve_pending_submission_returns_400(self, client, auth_headers):
        """Only graded submissions can be approved."""
        resp, _ = self._approve(client, auth_headers, sub=_SUBMISSION_PENDING)
        assert resp.status_code == 400

    def test_approve_forbidden_for_wrong_teacher(self, client):
        from shared.auth import create_jwt
        other_headers = {"Authorization": f"Bearer {create_jwt('other-teacher', 'teacher', 1)}"}
        resp, _ = self._approve(client, other_headers)
        assert resp.status_code == 403

    def test_approve_requires_auth(self, client):
        with patch("functions.submissions.get_doc", side_effect=lambda c, d:
                   _SUBMISSION_GRADED if (c, d) == ("student_submissions", SUBMISSION_ID)
                   else _HOMEWORK_WITH_QUESTIONS if (c, d) == ("answer_keys", HOMEWORK_ID) else None):
            resp = client.post(f"/api/submissions/{SUBMISSION_ID}/approve")
        assert resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# 5. Override individual grade
# ══════════════════════════════════════════════════════════════════════════════

class TestOverrideGrade:

    def _override(self, client, headers, body: dict, sub=None):
        sub = sub or _SUBMISSION_GRADED
        upsert_mock = MagicMock()

        with patch("functions.submissions.get_doc", side_effect=lambda c, d:
                   sub if (c, d) == ("student_submissions", SUBMISSION_ID)
                   else _HOMEWORK_WITH_QUESTIONS if (c, d) == ("answer_keys", HOMEWORK_ID)
                   else None), \
             patch("functions.submissions.upsert", upsert_mock), \
             patch("functions.submissions.collect_training_sample"), \
             patch("functions.submissions.update_student_weaknesses"):

            resp = client.patch(
                f"/api/submissions/{SUBMISSION_ID}/override",
                headers=headers,
                json=body,
            )

        return resp, upsert_mock

    def test_valid_override_returns_200(self, client, auth_headers):
        resp, _ = self._override(client, auth_headers, {"score": 2.0})
        assert resp.status_code == 200
        assert resp.get_json()["score"] == 2.0

    def test_override_updates_submission_and_mark_in_firestore(self, client, auth_headers):
        """upsert called on both student_submissions and marks collections."""
        _, upsert_mock = self._override(client, auth_headers, {"score": 1.0})
        collections = {c.args[0] for c in upsert_mock.call_args_list}
        assert "student_submissions" in collections
        assert "marks" in collections

    def test_override_sets_teacher_override_flag(self, client, auth_headers):
        _, upsert_mock = self._override(client, auth_headers, {"score": 1.0})
        sub_calls = [c for c in upsert_mock.call_args_list
                     if c.args[0] == "student_submissions"]
        assert any(c.args[2].get("teacher_override") is True for c in sub_calls), (
            "Expected teacher_override=True on submission upsert"
        )

    def test_override_preserves_original_ai_score(self, client, auth_headers):
        """Original score is archived in ai_score before overriding."""
        _, upsert_mock = self._override(client, auth_headers, {"score": 0.5})
        sub_calls = [c for c in upsert_mock.call_args_list
                     if c.args[0] == "student_submissions"]
        assert any("ai_score" in c.args[2] for c in sub_calls), (
            "Expected ai_score saved on submission upsert"
        )

    def test_override_calculates_percentage_correctly(self, client, auth_headers):
        """score=1.0, max_score=2.0 → percentage=50.0."""
        resp, _ = self._override(client, auth_headers, {"score": 1.0})
        assert resp.get_json()["percentage"] == 50.0

    def test_override_negative_score_returns_400(self, client, auth_headers):
        resp, _ = self._override(client, auth_headers, {"score": -1})
        assert resp.status_code == 400

    def test_override_above_max_score_returns_400(self, client, auth_headers):
        # submission max_score = 2.0
        resp, _ = self._override(client, auth_headers, {"score": 99})
        assert resp.status_code == 400

    def test_override_missing_score_field_returns_400(self, client, auth_headers):
        resp, _ = self._override(client, auth_headers, {"feedback": "Good effort"})
        assert resp.status_code == 400

    def test_override_with_feedback_stored_on_both_docs(self, client, auth_headers):
        """Feedback string saved to both student_submissions and marks."""
        _, upsert_mock = self._override(
            client, auth_headers, {"score": 1.5, "feedback": "Check Q2 working"}
        )
        for col in ("student_submissions", "marks"):
            calls = [c for c in upsert_mock.call_args_list if c.args[0] == col]
            assert any("overall_feedback" in c.args[2] for c in calls), (
                f"Expected overall_feedback in {col} upsert"
            )

    def test_override_forbidden_for_wrong_teacher(self, client):
        from shared.auth import create_jwt
        other_headers = {"Authorization": f"Bearer {create_jwt('other-teacher', 'teacher', 1)}"}
        resp, _ = self._override(client, other_headers, {"score": 1.0})
        assert resp.status_code == 403


# ══════════════════════════════════════════════════════════════════════════════
# 6. Close submissions
# ══════════════════════════════════════════════════════════════════════════════

class TestCloseSubmissions:

    def _close(self, client, headers, pending_subs=None, hw=None):
        hw = hw or _HOMEWORK_OPEN
        pending_subs = pending_subs if pending_subs is not None else []
        upsert_calls: list = []
        trigger_mock = MagicMock()

        with patch("functions.answer_keys.get_doc", side_effect=lambda c, d:
                   hw if (c, d) == ("answer_keys", HOMEWORK_ID) else None), \
             patch("functions.answer_keys.upsert",
                   side_effect=lambda *a: upsert_calls.append(a)), \
             patch("functions.answer_keys.query", return_value=pending_subs), \
             patch("functions.answer_keys._trigger_batch_grading_job", trigger_mock):

            resp = client.post(
                f"/api/answer-keys/{HOMEWORK_ID}/close",
                headers=headers,
            )

        return resp, upsert_calls, trigger_mock

    def test_close_returns_200(self, client, auth_headers):
        resp, _, _ = self._close(client, auth_headers)
        assert resp.status_code == 200, resp.get_data(as_text=True)

    def test_close_sets_open_for_submission_false(self, client, auth_headers):
        """open_for_submission=False written to answer_keys in Firestore."""
        _, upsert_calls, _ = self._close(client, auth_headers)
        ak_writes = [(c, d, data) for c, d, data in upsert_calls if c == "answer_keys"]
        assert any(data.get("open_for_submission") is False for _, _, data in ak_writes), (
            "Expected open_for_submission=False written to answer_keys"
        )

    def test_close_triggers_batch_job_when_pending(self, client, auth_headers):
        """Pending submissions → Cloud Run job triggered with correct homework_id."""
        _, _, trigger_mock = self._close(client, auth_headers, pending_subs=[_SUBMISSION_PENDING])
        trigger_mock.assert_called_once_with(HOMEWORK_ID)

    def test_close_no_batch_job_when_no_pending(self, client, auth_headers):
        """No pending submissions → batch job NOT triggered."""
        _, _, trigger_mock = self._close(client, auth_headers, pending_subs=[])
        trigger_mock.assert_not_called()

    def test_close_returns_pending_count(self, client, auth_headers):
        """Response includes the number of pending submissions found."""
        two_pending = [_SUBMISSION_PENDING, _SUBMISSION_PENDING]
        resp, _, _ = self._close(client, auth_headers, pending_subs=two_pending)
        assert resp.get_json()["pending_count"] == 2

    def test_close_zero_pending_message(self, client, auth_headers):
        resp, _, _ = self._close(client, auth_headers, pending_subs=[])
        assert resp.status_code == 200
        assert resp.get_json()["pending_count"] == 0

    def test_close_forbidden_for_wrong_teacher(self, client):
        from shared.auth import create_jwt
        other = {"Authorization": f"Bearer {create_jwt('other-teacher', 'teacher', 1)}"}
        resp, _, _ = self._close(client, other)
        assert resp.status_code == 403

    def test_close_requires_auth(self, client):
        with patch("functions.answer_keys.get_doc", return_value=_HOMEWORK_OPEN), \
             patch("functions.answer_keys.upsert"), \
             patch("functions.answer_keys.query", return_value=[]), \
             patch("functions.answer_keys._trigger_batch_grading_job"):
            resp = client.post(f"/api/answer-keys/{HOMEWORK_ID}/close")
        assert resp.status_code == 401
