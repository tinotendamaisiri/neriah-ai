"""
tests/test_multi_page_grading.py

Regression tests for the multi-page /mark endpoint contract (1-5 pages per
submission), the grade_submission_strict_multi Gemma wrapper, and the
annotate_pages per-page annotation pipeline.

All Vertex/GCS/Firestore calls are mocked. No network.
"""

from __future__ import annotations

import io
import json
from unittest.mock import MagicMock, patch

import pytest
from PIL import Image


# ─── App / client fixtures ────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def app():
    from main import app as flask_app
    flask_app.config["TESTING"] = True
    return flask_app


@pytest.fixture(scope="module")
def client(app):
    return app.test_client()


@pytest.fixture(autouse=True)
def bypass_token_version_check():
    """Skip the Firestore token_version check inside require_role()."""
    with patch("shared.firestore_client.get_doc", return_value=None):
        yield


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _tiny_jpeg_bytes(label: str = "p") -> bytes:
    """Generate a minimal valid JPEG in-memory. Tests don't need real content —
    Gemma is mocked — but multipart handlers want actual bytes."""
    img = Image.new("RGB", (20, 20), color=(200, 200, 200))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=50)
    return buf.getvalue()


# Reusable fixtures for the /mark endpoint — match the existing test patterns
# in tests/test_homework_creation_flow.py that mock functions.auth.upsert etc.
TEACHER_ID = "mp-teacher-001"
STUDENT_ID = "mp-student-001"
CLASS_ID = "mp-class-001"
ANSWER_KEY_ID = "mp-key-001"


def _teacher_headers():
    # Match existing test pattern — create_jwt directly.
    from shared.auth import create_jwt
    token = create_jwt(TEACHER_ID, "teacher", 0)
    return {"Authorization": f"Bearer {token}"}


def _canonical_answer_key():
    return {
        "id": ANSWER_KEY_ID,
        "teacher_id": TEACHER_ID,
        "class_id": CLASS_ID,
        "title": "Multi-page Test",
        "subject": "Maths",
        "education_level": "Form 2",
        "total_marks": 10.0,
        "questions": [
            {"number": 1, "correct_answer": "42", "marks": 5, "marking_notes": ""},
            {"number": 2, "correct_answer": "100", "marks": 5, "marking_notes": ""},
        ],
    }


def _canonical_student():
    return {"id": STUDENT_ID, "class_id": CLASS_ID, "first_name": "A", "surname": "B"}


def _canonical_class():
    return {"id": CLASS_ID, "teacher_id": TEACHER_ID, "education_level": "Form 2"}


def _fake_verdicts_from_gemma(page_count: int):
    """Gemma would normally emit this — we stub it."""
    return [
        {
            "question_number": 1,
            "page_index": 0,
            "student_answer": "42",
            "expected_answer": "42",
            "verdict": "correct",
            "awarded_marks": 5,
            "max_marks": 5,
            "feedback": None,
        },
        {
            "question_number": 2,
            # if multi-page, put Q2 on the last page; else 0
            "page_index": max(page_count - 1, 0),
            "student_answer": "100",
            "expected_answer": "100",
            "verdict": "correct",
            "awarded_marks": 5,
            "max_marks": 5,
            "feedback": None,
        },
    ]


# Each test wires its own get_doc so answer_key / student / class lookups
# resolve. Duplicate-submission query must return empty.
def _make_fake_get_doc():
    def fake(collection, doc_id):
        if collection == "answer_keys" and doc_id == ANSWER_KEY_ID:
            return _canonical_answer_key()
        if collection == "students" and doc_id == STUDENT_ID:
            return _canonical_student()
        if collection == "classes" and doc_id == CLASS_ID:
            return _canonical_class()
        if collection == "mark_usage":
            return None
        return None
    return fake


def _post_mark(client, pages_data: list[tuple[str, bytes]], form: dict):
    """pages_data = [(field_name, bytes), ...]. form = extra multipart fields."""
    from io import BytesIO
    files = {field: (BytesIO(b), f"{field}.jpg") for field, b in pages_data}
    # flask test client multipart: data dict mixing files + strings
    data = {**form}
    for field, (bio, name) in files.items():
        data[field] = (bio, name)
    return client.post(
        "/api/mark",
        data=data,
        content_type="multipart/form-data",
        headers=_teacher_headers(),
    )


@pytest.fixture
def mark_mocks():
    """Common patches — mock Vertex, GCS, Firestore writes. Returns the
    saved-upserts dict so tests can assert on what was written."""
    saved: dict[tuple, dict] = {}

    def fake_upsert(collection, doc_id, data):
        saved[(collection, doc_id)] = {**saved.get((collection, doc_id), {}), **data}

    def fake_query(collection, filters, **kwargs):
        # No existing marks / submissions (clean register).
        return []

    def fake_upload_bytes(bucket, blob, content, public=False):
        return None

    def fake_signed_url(bucket, blob, expiry_minutes=None):
        return f"https://storage.googleapis.com/{bucket}/{blob}?sig=fake"

    def fake_route_ai_request(*args, **kwargs):
        return "cloud"

    with patch("functions.mark.upsert", side_effect=fake_upsert), \
         patch("functions.mark.query", side_effect=fake_query), \
         patch("functions.mark.get_doc", side_effect=_make_fake_get_doc()), \
         patch("functions.mark.upload_bytes", side_effect=fake_upload_bytes), \
         patch("functions.mark.generate_signed_url", side_effect=fake_signed_url), \
         patch("functions.mark.route_ai_request", side_effect=fake_route_ai_request), \
         patch("functions.mark.check_image_quality_strict",
               return_value={"pass": True, "reason": "", "suggestion": ""}), \
         patch("functions.mark.validate_output", return_value=(True, "")), \
         patch("functions.mark.log_ai_interaction"), \
         patch("functions.mark.get_user_context", return_value={}):
        yield saved


# ─── /mark endpoint — happy paths ─────────────────────────────────────────────


class TestMarkMultiPageEndpoint:
    def test_mark_endpoint_accepts_single_page(self, client, mark_mocks):
        """page_count=1, one file via page_0 field — the canonical single-page case."""
        with patch("functions.mark.grade_submission_strict_multi",
                   return_value=_fake_verdicts_from_gemma(1)):
            resp = _post_mark(
                client,
                [("page_0", _tiny_jpeg_bytes())],
                {"page_count": "1", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
            )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body["page_count"] == 1
        assert len(body["page_urls"]) == 1
        assert len(body["annotated_urls"]) == 1
        assert body["marked_image_url"] == body["annotated_urls"][0]

    def test_mark_endpoint_accepts_three_pages(self, client, mark_mocks):
        with patch("functions.mark.grade_submission_strict_multi",
                   return_value=_fake_verdicts_from_gemma(3)):
            resp = _post_mark(
                client,
                [
                    ("page_0", _tiny_jpeg_bytes()),
                    ("page_1", _tiny_jpeg_bytes()),
                    ("page_2", _tiny_jpeg_bytes()),
                ],
                {"page_count": "3", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
            )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body["page_count"] == 3
        assert len(body["page_urls"]) == 3
        assert len(body["annotated_urls"]) == 3

    def test_mark_endpoint_accepts_five_pages(self, client, mark_mocks):
        """Boundary — 5 is the max."""
        with patch("functions.mark.grade_submission_strict_multi",
                   return_value=_fake_verdicts_from_gemma(5)):
            resp = _post_mark(
                client,
                [(f"page_{i}", _tiny_jpeg_bytes()) for i in range(5)],
                {"page_count": "5", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
            )
        assert resp.status_code == 200, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body["page_count"] == 5
        assert len(body["page_urls"]) == 5

    # ── Rejection paths ──────────────────────────────────────────────────────

    def test_mark_endpoint_rejects_page_count_zero(self, client, mark_mocks):
        resp = _post_mark(
            client, [], {"page_count": "0", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
        )
        assert resp.status_code == 422, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body.get("error_code") == "IMAGE_QUALITY_REJECTED"
        assert "1 and 5" in (body.get("error") or "")

    def test_mark_endpoint_rejects_page_count_six(self, client, mark_mocks):
        resp = _post_mark(
            client,
            [(f"page_{i}", _tiny_jpeg_bytes()) for i in range(6)],
            {"page_count": "6", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
        )
        assert resp.status_code == 422, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body.get("error_code") == "IMAGE_QUALITY_REJECTED"

    def test_mark_endpoint_rejects_missing_page_field(self, client, mark_mocks):
        """page_count=3 claimed but only page_0 + page_1 sent → rejected."""
        resp = _post_mark(
            client,
            [("page_0", _tiny_jpeg_bytes()), ("page_1", _tiny_jpeg_bytes())],
            {"page_count": "3", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
        )
        assert resp.status_code == 422, resp.get_data(as_text=True)
        body = resp.get_json()
        assert body.get("error_code") == "IMAGE_QUALITY_REJECTED"
        assert "page 3" in (body.get("error") or "").lower() or "missing" in (body.get("error") or "").lower()


class TestMarkDocSchema:
    def test_mark_doc_stores_page_urls_array_and_annotated_urls_array(self, client, mark_mocks):
        with patch("functions.mark.grade_submission_strict_multi",
                   return_value=_fake_verdicts_from_gemma(2)):
            resp = _post_mark(
                client,
                [("page_0", _tiny_jpeg_bytes()), ("page_1", _tiny_jpeg_bytes())],
                {"page_count": "2", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
            )
        assert resp.status_code == 200
        mark_writes = [v for (c, _), v in mark_mocks.items() if c == "marks"]
        assert len(mark_writes) == 1
        mark_doc = mark_writes[0]
        assert mark_doc["page_count"] == 2
        assert isinstance(mark_doc["page_urls"], list) and len(mark_doc["page_urls"]) == 2
        assert isinstance(mark_doc["annotated_urls"], list) and len(mark_doc["annotated_urls"]) == 2

    def test_mark_doc_backward_compat_image_url_is_first_page(self, client, mark_mocks):
        """Legacy singular `marked_image_url` must equal annotated_urls[0]."""
        with patch("functions.mark.grade_submission_strict_multi",
                   return_value=_fake_verdicts_from_gemma(3)):
            resp = _post_mark(
                client,
                [(f"page_{i}", _tiny_jpeg_bytes()) for i in range(3)],
                {"page_count": "3", "student_id": STUDENT_ID, "answer_key_id": ANSWER_KEY_ID},
            )
        assert resp.status_code == 200
        mark_writes = [v for (c, _), v in mark_mocks.items() if c == "marks"]
        mark_doc = mark_writes[0]
        assert mark_doc["marked_image_url"] == mark_doc["annotated_urls"][0]


# ─── Gemma multi-page call ────────────────────────────────────────────────────


class TestGradeSubmissionStrictMulti:
    def test_passes_all_pages_to_gemma_as_image_url_blocks(self):
        """Mocks _vertex_chat_completions and inspects the messages payload to
        confirm one text block + N image_url blocks in one user message."""
        from shared.gemma_client import grade_submission_strict_multi
        fake_pages = [_tiny_jpeg_bytes() for _ in range(3)]
        captured = {}

        def fake_chat_completions(messages, **kwargs):
            captured["messages"] = messages
            return json.dumps(_fake_verdicts_from_gemma(3))

        with patch("shared.gemma_client._vertex_chat_completions",
                   side_effect=fake_chat_completions), \
             patch("shared.gemma_client._build_rag_context", return_value=""):
            result = grade_submission_strict_multi(
                fake_pages, _canonical_answer_key(), "Form 2", user_context={},
            )

        assert len(result) == 2  # 2 verdicts
        content = captured["messages"][0]["content"]
        # One text block + 3 image_url blocks
        text_blocks = [c for c in content if c.get("type") == "text"]
        image_blocks = [c for c in content if c.get("type") == "image_url"]
        assert len(text_blocks) == 1
        assert len(image_blocks) == 3
        # Each image_url must be a data URL with base64-encoded JPEG
        for ib in image_blocks:
            assert ib["image_url"]["url"].startswith("data:image/jpeg;base64,")

    def test_defaults_page_index_when_missing_or_out_of_range(self):
        """Gemma emits a verdict without page_index (or with a bad one) →
        clamped to 0 so annotator doesn't crash."""
        from shared.gemma_client import grade_submission_strict_multi
        fake_pages = [_tiny_jpeg_bytes() for _ in range(2)]

        sloppy_verdicts = [
            {"question_number": 1, "verdict": "correct", "awarded_marks": 5, "max_marks": 5},
            # page_index missing ↑
            {"question_number": 2, "page_index": 99,  # out of range ↓
             "verdict": "incorrect", "awarded_marks": 0, "max_marks": 5},
            {"question_number": 3, "page_index": -1,  # negative ↓
             "verdict": "partial", "awarded_marks": 2, "max_marks": 5},
        ]

        with patch("shared.gemma_client._vertex_chat_completions",
                   return_value=json.dumps(sloppy_verdicts)), \
             patch("shared.gemma_client._build_rag_context", return_value=""):
            result = grade_submission_strict_multi(
                fake_pages, _canonical_answer_key(), "Form 2", user_context={},
            )

        assert all(0 <= v["page_index"] < 2 for v in result)
        # Missing + out-of-range + negative all default to 0
        for v in result:
            assert v["page_index"] == 0 or v["page_index"] == 1


# ─── Annotator multi-page ─────────────────────────────────────────────────────


class TestAnnotatePages:
    def test_annotate_pages_returns_one_output_per_page(self):
        from shared.annotator import annotate_pages
        pages = [_tiny_jpeg_bytes() for _ in range(3)]
        verdicts = [
            {"question_number": 1, "page_index": 0, "verdict": "correct",
             "awarded_marks": 5, "max_marks": 5},
            {"question_number": 2, "page_index": 1, "verdict": "incorrect",
             "awarded_marks": 0, "max_marks": 5},
            {"question_number": 3, "page_index": 2, "verdict": "partial",
             "awarded_marks": 3, "max_marks": 5},
        ]
        out = annotate_pages(pages, verdicts)
        assert len(out) == 3
        # Each output is bytes (actual JPEG contents; we don't inspect pixels)
        assert all(isinstance(b, bytes) and len(b) > 0 for b in out)

    def test_annotate_pages_filters_by_page_index(self):
        """Verdicts for page_index=2 must not land on page 0 or 1.
        Verified indirectly: annotate_image is called per-page with only
        its own verdicts."""
        from shared import annotator
        pages = [_tiny_jpeg_bytes() for _ in range(3)]
        verdicts = [
            {"question_number": 1, "page_index": 0, "verdict": "correct",
             "awarded_marks": 5, "max_marks": 5},
            {"question_number": 2, "page_index": 2, "verdict": "correct",
             "awarded_marks": 5, "max_marks": 5},
            {"question_number": 3, "page_index": 2, "verdict": "partial",
             "awarded_marks": 3, "max_marks": 5},
        ]

        calls: list = []

        def spy_annotate_image(page_bytes, page_verdicts, *args, **kwargs):
            calls.append([v["question_number"] for v in page_verdicts])
            return page_bytes  # pass-through

        with patch.object(annotator, "annotate_image", side_effect=spy_annotate_image):
            annotator.annotate_pages(pages, verdicts)

        # Page 0 gets Q1; page 1 gets nothing; page 2 gets Q2 + Q3.
        assert calls == [[1], [], [2, 3]]

    def test_annotate_pages_defaults_missing_page_index_to_zero(self):
        """A verdict without page_index should land on page 0."""
        from shared import annotator
        pages = [_tiny_jpeg_bytes() for _ in range(2)]
        verdicts = [
            {"question_number": 1, "verdict": "correct",
             "awarded_marks": 5, "max_marks": 5},  # no page_index
            {"question_number": 2, "page_index": 1, "verdict": "correct",
             "awarded_marks": 5, "max_marks": 5},
        ]
        calls: list = []
        def spy(page_bytes, page_verdicts, *a, **k):
            calls.append([v["question_number"] for v in page_verdicts])
            return page_bytes

        with patch.object(annotator, "annotate_image", side_effect=spy):
            annotator.annotate_pages(pages, verdicts)

        # Missing page_index defaults to 0 → Q1 on page 0, Q2 on page 1.
        assert calls == [[1], [2]]
