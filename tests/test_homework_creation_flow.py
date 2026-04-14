"""
tests/test_homework_creation_flow.py

Regression tests for the complete Add Homework flow.
All Firestore, GCS, and Gemma calls are mocked — no network or cloud required.

Run:
    python -m pytest tests/test_homework_creation_flow.py -v
"""

from __future__ import annotations

import base64
import io
import json
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image

from tests.registry import feature_test

# ── Constants ──────────────────────────────────────────────────────────────────

TEACHER_ID  = "hw-teacher-001"
CLASS_ID    = "hw-class-001"
HOMEWORK_ID = "hw-key-001"
STUDENT_ID  = "hw-student-001"

# ── Firestore fixtures ─────────────────────────────────────────────────────────

_CLASS = {
    "id": CLASS_ID,
    "teacher_id": TEACHER_ID,
    "name": "Form 2B",
    "education_level": "Form 2",
}

_HOMEWORK_DRAFT = {
    "id": HOMEWORK_ID,
    "class_id": CLASS_ID,
    "teacher_id": TEACHER_ID,
    "title": "Chapter 5 Test",
    "education_level": "Form 2",
    "subject": "Mathematics",
    "questions": [
        {"question_number": 1, "question_text": "Solve 2x+5=11",
         "answer": "x=3", "marks": 2, "marking_notes": None},
        {"question_number": 2, "question_text": "15% of 200",
         "answer": "30", "marks": 2, "marking_notes": None},
    ],
    "total_marks": 4,
    "open_for_submission": False,
    "generated": True,
    "status": "draft",
    "due_date": None,
}

_HOMEWORK_ACTIVE = {
    **_HOMEWORK_DRAFT,
    "status": "active",
    "open_for_submission": True,
}

_GEMMA_QUESTIONS = [
    {"question_number": 1, "question_text": "Solve 2x+5=11", "answer": "x=3",
     "marks": 2, "marking_notes": None},
    {"question_number": 2, "question_text": "15% of 200", "answer": "30",
     "marks": 2, "marking_notes": None},
]

_GEMMA_IMAGE_OUT = {
    "title": "Chapter 5 Test",
    "total_marks": 4,
    "questions": _GEMMA_QUESTIONS,
}

_GEMMA_TEXT_OUT = (_GEMMA_QUESTIONS, None)   # (questions_list, raw_error)

# ── Helpers ────────────────────────────────────────────────────────────────────

def _jpeg() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (10, 10), (255, 255, 255)).save(buf, format="JPEG")
    return buf.getvalue()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def _mock_pdf_cm(text: str = "1. Solve 2x+5=11\n2. 15% of 200"):
    """Return a MagicMock context manager simulating pdfplumber.open()."""
    page = MagicMock()
    page.extract_text.return_value = text
    pdf_cm = MagicMock()
    pdf_cm.__enter__ = MagicMock(return_value=pdf_cm)
    pdf_cm.__exit__ = MagicMock(return_value=False)
    pdf_cm.pages = [page]
    return pdf_cm


def _mock_docx(text: str = "1. Solve 2x+5=11\n2. 15% of 200"):
    """Return a MagicMock simulating a python-docx Document."""
    para = MagicMock()
    para.text = text
    doc = MagicMock()
    doc.paragraphs = [para]
    return doc


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
    """Skip token_version Firestore check inside require_role()."""
    with patch("shared.firestore_client.get_doc", return_value=None):
        yield


# ── Common patch helper ────────────────────────────────────────────────────────

def _base_patches(saved: dict, image_out=None, text_out=None) -> list:
    """
    Standard set of patches for POST /api/homework/generate-scheme tests.

    saved      — dict populated by captured upsert() calls
    image_out  — mock return for generate_marking_scheme_from_image (image path)
    text_out   — mock return for generate_scheme_from_text (PDF/Word/text paths)
    """
    patches = [
        # Ownership check + class education_level lookup
        patch(
            "functions.answer_keys.get_doc",
            side_effect=lambda c, d: _CLASS if (c, d) == ("classes", CLASS_ID) else None,
        ),
        # Capture Firestore writes
        patch(
            "functions.answer_keys.upsert",
            side_effect=lambda c, _id, data: saved.update({_id: data}),
        ),
        # get_user_context is imported directly into answer_keys — patch it there
        patch("functions.answer_keys.get_user_context", return_value={}),
    ]
    if image_out is not None:
        patches.append(patch(
            "functions.answer_keys.generate_marking_scheme_from_image",
            return_value=image_out,
        ))
    if text_out is not None:
        patches.append(patch(
            "functions.answer_keys.generate_scheme_from_text",
            return_value=text_out,
        ))
    return patches


def _enter_all(stack: ExitStack, patches: list) -> None:
    for p in patches:
        stack.enter_context(p)


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 1 — Homework Creation (five input methods)
# ══════════════════════════════════════════════════════════════════════════════

class TestHomeworkCreation:
    """POST /api/homework/generate-scheme with each supported input type."""

    def _post(self, client, auth_headers, body: dict):
        return client.post(
            "/api/homework/generate-scheme",
            headers=auth_headers,
            json=body,
        )

    def _assert_created(self, resp) -> dict:
        assert resp.status_code == 201, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body["teacher_id"] == TEACHER_ID
        assert body["class_id"] == CLASS_ID
        assert body["title"] == "Chapter 5 Test"
        assert body["subject"] == "Mathematics"
        assert body["generated"] is True
        assert len(body["questions"]) > 0
        assert body["total_marks"] > 0
        return body

    # ── tests ─────────────────────────────────────────────────────────────────

    @feature_test("homework_creation_image")
    def test_create_homework_image(self, client, auth_headers):
        """JPEG image → multimodal Gemma call → questions returned."""
        saved: dict = {}
        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, image_out=_GEMMA_IMAGE_OUT))

            resp = self._post(client, auth_headers, {
                "class_id": CLASS_ID,
                "title": "Chapter 5 Test",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "file_data": _b64(_jpeg()),
                "media_type": "image/jpeg",
            })

        body = self._assert_created(resp)
        assert len(body["questions"]) == len(_GEMMA_QUESTIONS)

    @feature_test("homework_creation_camera")
    def test_create_homework_camera(self, client, auth_headers):
        """Camera produces a JPEG — same multimodal path as gallery image upload."""
        saved: dict = {}
        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, image_out=_GEMMA_IMAGE_OUT))

            resp = self._post(client, auth_headers, {
                "class_id": CLASS_ID,
                "title": "Chapter 5 Test",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "file_data": _b64(_jpeg()),
                "media_type": "image/jpeg",
            })

        body = self._assert_created(resp)
        assert len(body["questions"]) > 0

    @feature_test("homework_creation_pdf")
    def test_create_homework_pdf(self, client, auth_headers):
        """PDF → pdfplumber extracts text → generate_scheme_from_text called."""
        saved: dict = {}
        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, text_out=_GEMMA_TEXT_OUT))
            stack.enter_context(patch("pdfplumber.open", return_value=_mock_pdf_cm()))

            resp = self._post(client, auth_headers, {
                "class_id": CLASS_ID,
                "title": "Chapter 5 Test",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "file_data": _b64(b"%PDF-1.4 fake pdf bytes"),
                "media_type": "application/pdf",
            })

        body = self._assert_created(resp)
        assert len(body["questions"]) > 0

    @feature_test("homework_creation_word")
    def test_create_homework_word(self, client, auth_headers):
        """DOCX → python-docx extracts text → generate_scheme_from_text called."""
        saved: dict = {}
        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, text_out=_GEMMA_TEXT_OUT))
            stack.enter_context(patch("docx.Document", return_value=_mock_docx()))

            resp = self._post(client, auth_headers, {
                "class_id": CLASS_ID,
                "title": "Chapter 5 Test",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "file_data": _b64(b"PK\x03\x04fake-docx-bytes"),
                "media_type": "application/vnd.openxmlformats-officedocument"
                              ".wordprocessingml.document",
            })

        body = self._assert_created(resp)
        assert len(body["questions"]) > 0

    @feature_test("homework_creation_text")
    def test_create_homework_text(self, client, auth_headers):
        """Plain text body → passed directly to generate_scheme_from_text."""
        saved: dict = {}
        text_mock = MagicMock(return_value=_GEMMA_TEXT_OUT)

        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved))
            stack.enter_context(
                patch("functions.answer_keys.generate_scheme_from_text", text_mock)
            )

            resp = self._post(client, auth_headers, {
                "class_id": CLASS_ID,
                "title": "Chapter 5 Test",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "text": "1. Solve 2x+5=11\n2. 15% of 200",
            })

        body = self._assert_created(resp)
        text_mock.assert_called_once()
        # The first positional arg is the question paper text
        assert "Solve 2x+5=11" in text_mock.call_args.args[0]

    @feature_test("homework_creation_validation_missing_title")
    def test_create_homework_missing_title_returns_400(self, client, auth_headers):
        """Request without title → 400."""
        with ExitStack() as stack:
            _enter_all(stack, _base_patches({}))
            resp = self._post(client, auth_headers, {
                "class_id": CLASS_ID,
                "subject": "Mathematics",
                "text": "Some question",
            })
        assert resp.status_code == 400

    @feature_test("homework_creation_auth_required")
    def test_create_homework_no_auth_returns_401(self, client):
        """No Authorization header → 401."""
        resp = client.post(
            "/api/homework/generate-scheme",
            json={"class_id": CLASS_ID, "title": "Test"},
        )
        assert resp.status_code == 401


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 2 — Marking Scheme Validation
# ══════════════════════════════════════════════════════════════════════════════

class TestMarkingSchemeValidation:

    def _create_via_text(self, client, auth_headers, questions: list,
                         extra_body: dict | None = None):
        """POST generate-scheme with mocked generate_scheme_from_text returning `questions`."""
        saved: dict = {}
        text_mock = MagicMock(return_value=(questions, None))

        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved))
            stack.enter_context(
                patch("functions.answer_keys.generate_scheme_from_text", text_mock)
            )
            body = {
                "class_id": CLASS_ID,
                "title": "Test Homework",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "text": "1. Solve 2x+5=11",
            }
            if extra_body:
                body.update(extra_body)

            resp = client.post(
                "/api/homework/generate-scheme",
                headers=auth_headers,
                json=body,
            )
        return resp, text_mock

    # ── tests ─────────────────────────────────────────────────────────────────

    @feature_test("marking_scheme_required_fields")
    def test_marking_scheme_fields(self, client, auth_headers):
        """Every question has a number, text/answer, and marks > 0;
        response total_marks equals the sum of per-question marks."""
        questions = [
            {"question_number": i, "question_text": f"Q{i}",
             "answer": f"A{i}", "marks": i, "marking_notes": None}
            for i in range(1, 4)
        ]
        resp, _ = self._create_via_text(client, auth_headers, questions)

        assert resp.status_code == 201, resp.get_data(as_text=True)
        body = resp.get_json()

        for q in body["questions"]:
            assert q.get("question_text") or q.get("answer"), "missing text/answer"
            assert q.get("marks", 0) > 0, f"marks must be > 0, got {q.get('marks')}"

        q_sum = sum(q["marks"] for q in questions)
        assert body["total_marks"] == pytest.approx(q_sum)

    @feature_test("marking_scheme_max_10_questions")
    def test_marking_scheme_max_questions(self, client, auth_headers):
        """Gemma returns 20 questions; endpoint hard-caps the list at 10."""
        twenty_questions = [
            {"question_number": i, "question_text": f"Q{i}",
             "answer": f"A{i}", "marks": 1, "marking_notes": None}
            for i in range(1, 21)
        ]
        resp, _ = self._create_via_text(client, auth_headers, twenty_questions)

        assert resp.status_code == 201, resp.get_data(as_text=True)
        n = len(resp.get_json()["questions"])
        assert n <= 10, f"Expected ≤ 10 questions, got {n}"

    @feature_test("marking_scheme_teacher_total_marks_response")
    def test_marking_scheme_teacher_total_marks_in_response(self, client, auth_headers):
        """teacher_total_marks=20 → response total_marks equals 20."""
        # AI questions sum to 6
        questions = [
            {"question_number": i, "question_text": f"Q{i}",
             "answer": f"A{i}", "marks": 2, "marking_notes": None}
            for i in range(1, 4)
        ]
        resp, _ = self._create_via_text(
            client, auth_headers, questions, extra_body={"teacher_total_marks": 20}
        )

        assert resp.status_code == 201, resp.get_data(as_text=True)
        assert resp.get_json()["total_marks"] == 20

    @feature_test("marking_scheme_teacher_total_marks_prompt_injection")
    def test_marking_scheme_teacher_total_marks_in_prompt(self):
        """
        Unit — generate_scheme_from_text with max_total_marks=20 injects
        the constraint into the Gemma prompt.
        """
        from shared.gemma_client import generate_scheme_from_text

        captured: list[str] = []

        def fake_generate(prompt, *args, **kwargs):
            captured.append(prompt)
            return json.dumps({
                "questions": [
                    {"question_number": 1, "question_text": "Q1",
                     "correct_answer": "A1", "marks": 10},
                ]
            })

        with patch("shared.gemma_client._generate", side_effect=fake_generate):
            generate_scheme_from_text(
                "1. Solve 2x+5=11",
                "Form 2",
                subject="Maths",
                max_total_marks=20,
            )

        assert captured, "Gemma was never called"
        assert "20" in captured[0], "teacher_total_marks value missing from prompt"
        assert "total marks" in captured[0].lower(), (
            "'total marks' phrase missing from prompt"
        )

    @feature_test("marking_scheme_json_fence_stripping")
    def test_marking_scheme_json_fence_stripping(self):
        """
        Unit — generate_scheme_from_text strips ```json fences from Gemma output.
        """
        from shared.gemma_client import generate_scheme_from_text

        fenced = (
            "```json\n"
            '{"questions": [{"question_number": 1, "question_text": "Q1", '
            '"correct_answer": "x=3", "marks": 2}]}\n'
            "```"
        )

        with patch("shared.gemma_client._generate", return_value=fenced):
            questions, err = generate_scheme_from_text("1. Solve", "Form 2")

        assert err is None, f"Expected no error, got: {err!r}"
        assert questions is not None and len(questions) == 1
        assert questions[0]["marks"] == 2

    @feature_test("marking_scheme_truncated_json_repair")
    def test_marking_scheme_truncated_json_repair(self):
        """
        Unit — generate_marking_scheme_from_image uses _parse_json which
        repairs truncated JSON by locating the last complete object.

        The truncated response ends mid-object so the last } belongs to the
        first (complete) question.  _parse_json appends ]} to close the array
        and root object, yielding at least that one question.
        """
        from shared.gemma_client import generate_marking_scheme_from_image

        # Two questions in the array; the second one is cut off before closing }
        truncated = (
            '{"title": "Test", "total_marks": 4, "questions": ['
            '{"number": 1, "question_text": "Q1", '
            '"correct_answer": "A1", "max_marks": 2, "marking_notes": null}, '
            '{"number": 2, "question_text": "Q2 is cut'  # truncated — no closing }
        )

        with patch("shared.gemma_client._generate", return_value=truncated):
            result = generate_marking_scheme_from_image(
                _jpeg(), "Form 2", "Maths"
            )

        assert "error" not in result, f"Unexpected error: {result.get('error')}"
        assert "questions" in result
        assert len(result["questions"]) >= 1


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 3 — Confirm & Save
# ══════════════════════════════════════════════════════════════════════════════

class TestConfirmAndSave:
    """
    The confirm step = PATCH /api/homework/{id} with status='active'.
    Teachers review the draft scheme, optionally edit via PUT /api/answer-keys/{id},
    then confirm by patching status.
    """

    @feature_test("confirm_scheme_activates_homework")
    def test_confirm_scheme(self, client, auth_headers):
        """PATCH homework to status='active' confirms the draft; Firestore updated."""
        saved: dict = {}

        with patch("functions.answer_keys.get_doc",
                   return_value={**_HOMEWORK_DRAFT, "teacher_id": TEACHER_ID}), \
             patch("functions.answer_keys.upsert",
                   side_effect=lambda c, d, data: saved.update({d: data})):

            resp = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"status": "active", "open_for_submission": True},
            )

        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body["status"] == "active"
        assert body["open_for_submission"] is True
        assert HOMEWORK_ID in saved
        assert saved[HOMEWORK_ID]["status"] == "active"

    @feature_test("confirm_scheme_update_questions_via_put")
    def test_confirm_scheme_updates_questions_via_put(self, client, auth_headers):
        """PUT /api/answer-keys/{id} with edited questions saves the new list."""
        edited_questions = [
            {"question_number": 1, "question_text": "Edited Q1",
             "correct_answer": "x=3", "marks": 3, "marking_notes": None},
        ]
        saved: dict = {}

        with patch("functions.answer_keys.get_doc",
                   return_value={**_HOMEWORK_DRAFT, "teacher_id": TEACHER_ID}), \
             patch("functions.answer_keys.upsert",
                   side_effect=lambda c, d, data: saved.update({d: data})):

            resp = client.put(
                f"/api/answer-keys/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"questions": edited_questions, "status": "active"},
            )

        assert resp.status_code == 200, resp.get_data(as_text=True)
        assert resp.get_json()["status"] == "active"
        assert saved[HOMEWORK_ID]["questions"][0]["answer"] == "x=3"

    @feature_test("confirm_scheme_idempotent")
    def test_confirm_scheme_idempotent(self, client, auth_headers):
        """Confirming an already-active homework twice returns 200 both times."""
        hw = {**_HOMEWORK_ACTIVE, "teacher_id": TEACHER_ID}

        with patch("functions.answer_keys.get_doc", return_value=hw), \
             patch("functions.answer_keys.upsert"):

            resp1 = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"status": "active"},
            )
            resp2 = client.patch(
                f"/api/homework/{HOMEWORK_ID}",
                headers=auth_headers,
                json={"status": "active"},
            )

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        # Neither response introduces duplicate questions
        assert resp1.get_json()["questions"] == resp2.get_json()["questions"]


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 4 — Due Date & Auto-Close
# ══════════════════════════════════════════════════════════════════════════════

class TestDueDateAndAutoClose:

    def _create_with_due_date(self, client, auth_headers, due_date: str | None):
        """POST /api/homework/generate-scheme, optionally with a due_date."""
        saved: dict = {}
        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, text_out=_GEMMA_TEXT_OUT))
            body: dict = {
                "class_id": CLASS_ID,
                "title": "DueDate Homework",
                "subject": "Mathematics",
                "education_level": "Form 2",
                "text": "1. Solve 2x+5=11",
            }
            if due_date is not None:
                body["due_date"] = due_date

            resp = client.post(
                "/api/homework/generate-scheme",
                headers=auth_headers,
                json=body,
            )
        return resp, saved

    # ── tests ─────────────────────────────────────────────────────────────────

    @feature_test("marking_scheme_due_date")
    def test_due_date_stored(self, client, auth_headers):
        """due_date from the request is stored on the Firestore document."""
        tomorrow = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        resp, saved = self._create_with_due_date(client, auth_headers, tomorrow)

        assert resp.status_code == 201, resp.get_data(as_text=True)
        assert resp.get_json()["due_date"] == tomorrow

        hw_write = next(
            (v for v in saved.values()
             if isinstance(v, dict) and v.get("due_date") == tomorrow),
            None,
        )
        assert hw_write is not None, "Firestore write did not contain the due_date"

    @feature_test("marking_scheme_default_due_date_24h")
    def test_default_due_date_24h(self, client, auth_headers):
        """No due_date in request → server defaults to now + 24 h (±60 s)."""
        before = datetime.now(timezone.utc)
        resp, _ = self._create_with_due_date(client, auth_headers, None)
        after = datetime.now(timezone.utc)

        assert resp.status_code == 201, resp.get_data(as_text=True)
        raw = resp.get_json().get("due_date")
        assert raw, "due_date should be auto-set when omitted"

        stored = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        lower = before + timedelta(hours=24) - timedelta(seconds=60)
        upper = after  + timedelta(hours=24) + timedelta(seconds=60)
        assert lower <= stored <= upper, (
            f"Server default due_date {stored} not within 24 h ± 60 s of now"
        )

    @feature_test("marking_scheme_auto_close")
    def test_auto_close_on_due_date(self, client, auth_headers):
        """
        GET /api/answer-keys?class_id=... auto-closes homework whose due_date is past.
        open_for_submission becomes False in the response; upsert called in Firestore.
        """
        past_due = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        overdue_hw = {**_HOMEWORK_ACTIVE, "due_date": past_due}
        upsert_calls: list = []

        with patch("functions.answer_keys.get_doc",
                   side_effect=lambda c, d:
                       _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.query", return_value=[overdue_hw]), \
             patch("functions.answer_keys.upsert",
                   side_effect=lambda c, d, data: upsert_calls.append((c, d, data))):

            resp = client.get(
                f"/api/answer-keys?class_id={CLASS_ID}",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.get_json()[0]["open_for_submission"] is False

        auto_close = [
            c for c in upsert_calls
            if c[0] == "answer_keys" and c[2] == {"open_for_submission": False}
        ]
        assert auto_close, "Expected auto-close upsert in Firestore"

    @feature_test("marking_scheme_future_due_date_not_closed")
    def test_future_due_date_not_auto_closed(self, client, auth_headers):
        """Homework with a future due_date is NOT auto-closed."""
        future_due = (datetime.now(timezone.utc) + timedelta(hours=48)).isoformat()
        open_hw = {**_HOMEWORK_ACTIVE, "due_date": future_due}
        upsert_calls: list = []

        with patch("functions.answer_keys.get_doc",
                   side_effect=lambda c, d:
                       _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.query", return_value=[open_hw]), \
             patch("functions.answer_keys.upsert",
                   side_effect=lambda c, d, data: upsert_calls.append((c, d, data))):

            resp = client.get(
                f"/api/answer-keys?class_id={CLASS_ID}",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        assert resp.get_json()[0]["open_for_submission"] is True
        assert not any(
            c[0] == "answer_keys" and c[2] == {"open_for_submission": False}
            for c in upsert_calls
        ), "Should NOT have auto-closed a future homework"

    @feature_test("marking_scheme_submission_rejected_after_due_date")
    def test_submission_rejected_after_due_date(self, client, auth_headers):
        """
        After auto-close fires, open_for_submission=False in the list response.
        Any downstream submission check that reads this flag will reject the request.
        """
        past_due = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        overdue_hw = {**_HOMEWORK_ACTIVE, "due_date": past_due}

        with patch("functions.answer_keys.get_doc",
                   side_effect=lambda c, d:
                       _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.query", return_value=[overdue_hw]), \
             patch("functions.answer_keys.upsert"):

            resp = client.get(
                f"/api/answer-keys?class_id={CLASS_ID}",
                headers=auth_headers,
            )

        hw = resp.get_json()[0]
        assert hw["open_for_submission"] is False, (
            "Overdue homework must be auto-closed so submission endpoints reject requests"
        )


# ══════════════════════════════════════════════════════════════════════════════
# SUITE 5 — HomeworkDetailScreen Data Integrity
# ══════════════════════════════════════════════════════════════════════════════

class TestHomeworkDetailDataIntegrity:

    @feature_test("homework_detail_marks_display")
    def test_homework_detail_marks_display(self, client, auth_headers):
        """
        List endpoint returns questions with marks > 0 and total_marks = sum
        of per-question marks.
        """
        hw = {
            **_HOMEWORK_ACTIVE,
            "questions": [
                {"question_number": 1, "question_text": "Q1", "answer": "A1",
                 "marks": 3, "marking_notes": None},
                {"question_number": 2, "question_text": "Q2", "answer": "A2",
                 "marks": 5, "marking_notes": None},
            ],
            "total_marks": 8,
        }

        with patch("functions.answer_keys.get_doc",
                   side_effect=lambda c, d:
                       _CLASS if (c, d) == ("classes", CLASS_ID) else None), \
             patch("functions.answer_keys.query", return_value=[hw]), \
             patch("functions.answer_keys.upsert"):

            resp = client.get(
                f"/api/answer-keys?class_id={CLASS_ID}",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        hw_out = resp.get_json()[0]

        for q in hw_out["questions"]:
            assert q["marks"] > 0, f"All questions must have marks > 0, got {q['marks']}"

        q_sum = sum(q["marks"] for q in hw_out["questions"])
        assert hw_out["total_marks"] == pytest.approx(q_sum)

    @feature_test("homework_detail_ai_generated_flag")
    def test_homework_detail_ai_generated_flag(self, client, auth_headers):
        """After AI scheme generation, generated=True is in the response."""
        saved: dict = {}
        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, text_out=_GEMMA_TEXT_OUT))

            resp = client.post(
                "/api/homework/generate-scheme",
                headers=auth_headers,
                json={
                    "class_id": CLASS_ID,
                    "title": "AI Test",
                    "subject": "Mathematics",
                    "education_level": "Form 2",
                    "text": "1. Solve 2x",
                },
            )

        assert resp.status_code == 201, resp.get_data(as_text=True)
        assert resp.get_json()["generated"] is True

    @feature_test("homework_detail_submissions_ordered")
    def test_homework_detail_submissions_ordered(self, client, auth_headers):
        """
        GET /api/submissions?homework_id=... returns submissions sorted
        ascending by submitted_at (earliest first).
        """
        hw_doc = {**_HOMEWORK_ACTIVE, "teacher_id": TEACHER_ID}
        # Pre-sort as Firestore would return them (the query uses ORDER BY submitted_at ASC)
        subs = [
            {"id": "s1", "student_id": STUDENT_ID, "answer_key_id": HOMEWORK_ID,
             "class_id": CLASS_ID, "status": "graded",
             "submitted_at": "2026-04-15T08:00:00Z"},
            {"id": "s2", "student_id": STUDENT_ID, "answer_key_id": HOMEWORK_ID,
             "class_id": CLASS_ID, "status": "graded",
             "submitted_at": "2026-04-15T10:00:00Z"},
            {"id": "s3", "student_id": STUDENT_ID, "answer_key_id": HOMEWORK_ID,
             "class_id": CLASS_ID, "status": "graded",
             "submitted_at": "2026-04-15T12:00:00Z"},
        ]

        with patch("functions.submissions.get_doc",
                   side_effect=lambda c, d:
                       hw_doc if (c, d) == ("answer_keys", HOMEWORK_ID) else None), \
             patch("functions.submissions.query", return_value=subs):

            resp = client.get(
                f"/api/submissions?homework_id={HOMEWORK_ID}",
                headers=auth_headers,
            )

        assert resp.status_code == 200
        timestamps = [s["submitted_at"] for s in resp.get_json()]
        assert timestamps == sorted(timestamps), (
            f"Submissions not ascending: {timestamps}"
        )

    @feature_test("homework_firestore_required_fields")
    def test_homework_created_in_firestore_with_correct_fields(self, client, auth_headers):
        """Firestore receives all required fields when creating a homework."""
        saved: dict = {}
        due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()

        with ExitStack() as stack:
            _enter_all(stack, _base_patches(saved, text_out=_GEMMA_TEXT_OUT))

            client.post(
                "/api/homework/generate-scheme",
                headers=auth_headers,
                json={
                    "class_id": CLASS_ID,
                    "title": "Field Check",
                    "subject": "Physics",
                    "education_level": "Form 2",
                    "text": "1. Newton's first law",
                    "due_date": due,
                },
            )

        hw_write = next(
            (v for v in saved.values()
             if isinstance(v, dict) and v.get("class_id") == CLASS_ID),
            None,
        )
        assert hw_write is not None, "No homework document written to Firestore"
        assert hw_write["teacher_id"] == TEACHER_ID
        assert hw_write["class_id"] == CLASS_ID
        assert hw_write["title"] == "Field Check"
        assert hw_write["subject"] == "Physics"
        assert hw_write["generated"] is True
        assert hw_write["due_date"] == due
        assert isinstance(hw_write["questions"], list)
        assert len(hw_write["questions"]) > 0
