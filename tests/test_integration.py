"""
Integration test — POST /api/mark (real HTTP + real Gemma 4).

What this test does:
  1. Patches Cloud Storage (upload_bytes → fake URL) and Firestore
     (get_doc / upsert → in-memory fixtures) so the test is self-contained.
  2. Starts the full Flask app on http://127.0.0.1:8080 in a background thread
     using werkzeug's make_server — same process, real HTTP stack.
  3. Generates a synthetic 640×900 JPEG exercise-book page with Pillow.
  4. Mints a valid teacher JWT with the test APP_JWT_SECRET.
  5. Sends a real multipart/form-data POST to /api/mark.
  6. Lets Gemma 4 (Ollama) run the full quality-gate + grading pipeline.
  7. Asserts HTTP 200 and the complete JSON response structure.

Run:
    INFERENCE_BACKEND=ollama pytest tests/test_integration.py -v -s
"""

from __future__ import annotations

import io
import json
import threading
import time
from unittest.mock import patch

import pytest
import requests
from PIL import Image, ImageDraw, ImageFont

# ─── Test fixture data ────────────────────────────────────────────────────────

TEACHER_ID    = "integ-teacher-001"
CLASS_ID      = "integ-class-001"
STUDENT_ID    = "integ-student-001"
ANSWER_KEY_ID = "integ-answer-key-001"

_ANSWER_KEY = {
    "id":              ANSWER_KEY_ID,
    "class_id":        CLASS_ID,
    "teacher_id":      TEACHER_ID,
    "title":           "Grade 4 Integration Test",
    "education_level": "Grade 4",
    "total_marks":     3,
    "questions": [
        {
            "question_number": 1,
            "question_text":   "What is 2 + 2?",
            "answer":          "4",
            "marks":           1,
        },
        {
            "question_number": 2,
            "question_text":   "What is the capital city of Zimbabwe?",
            "answer":          "Harare",
            "marks":           1,
        },
        {
            "question_number": 3,
            "question_text":   "What is 10 minus 3?",
            "answer":          "7",
            "marks":           1,
        },
    ],
}

_STUDENT = {
    "id":              STUDENT_ID,
    "class_id":        CLASS_ID,
    "first_name":      "Tendai",
    "surname":         "Moyo",
    "register_number": "001",
}

_CLASS = {
    "id":              CLASS_ID,
    "teacher_id":      TEACHER_ID,
    "name":            "Grade 4A",
    "education_level": "Grade 4",
}


# ─── Firestore stub ───────────────────────────────────────────────────────────

def _fake_get_doc(collection: str, doc_id: str):
    if collection == "answer_keys" and doc_id == ANSWER_KEY_ID:
        return _ANSWER_KEY
    if collection == "students"    and doc_id == STUDENT_ID:
        return _STUDENT
    if collection == "classes"     and doc_id == CLASS_ID:
        return _CLASS
    return None


# ─── Synthetic exercise-book image ───────────────────────────────────────────

def _make_exercise_book_image() -> bytes:
    """Generate a 640×900 JPEG that mimics a student's exercise-book page."""
    width, height = 640, 900
    img  = Image.new("RGB", (width, height), color=(252, 250, 245))
    draw = ImageDraw.Draw(img)

    try:
        font_title  = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
        font_label  = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
        font_answer = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
    except OSError:
        try:
            font_title  = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 24)
            font_label  = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 18)
            font_answer = ImageFont.truetype(
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
        except OSError:
            font_title = font_label = font_answer = ImageFont.load_default()

    ink   = (20,  20,  20)
    pen   = (30,  30, 180)   # student answers in blue
    rules = (180, 180, 180)

    for y in range(60, height, 36):
        draw.line([(30, y), (width - 30, y)], fill=rules, width=1)

    draw.text((30, 15), "Grade 4 General Knowledge Quiz",        font=font_title,  fill=ink)
    draw.text((30, 62), "Name: Tendai Moyo    Date: 3 Apr 2026", font=font_label,  fill=ink)

    questions = [
        ("1.", "What is 2 + 2?",                       "4"),
        ("2.", "What is the capital city of Zimbabwe?", "Harare"),
        ("3.", "What is 10 minus 3?",                  "7"),
    ]
    y = 115
    for num, question, answer in questions:
        draw.text((30, y),      f"{num} {question}", font=font_label,  fill=ink)
        draw.text((60, y + 30), f"Answer: {answer}", font=font_answer, fill=pen)
        y += 90

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


# ─── Server + JWT fixture ─────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def live_server():
    """
    Start the Flask app on 127.0.0.1:8080 in a background thread.
    Patches:
      - functions.mark.get_doc   → returns in-memory fixtures
      - functions.mark.upsert    → no-op (avoid Firestore write)
      - functions.mark.upload_bytes → returns a fake GCS URL
    Yields {"base_url": ..., "token": ...} then shuts the server down.
    """
    from shared.auth import create_jwt

    token = create_jwt(TEACHER_ID, "teacher", 1)

    _patches = [
        patch("functions.mark.get_doc",      side_effect=_fake_get_doc),
        patch("functions.mark.upsert",        return_value=None),
        patch("functions.mark.upload_bytes",  return_value="http://fake-gcs.local/marked/integ-test.jpg"),
    ]
    for p in _patches:
        p.start()

    # Import app after patches are active so any cached references are patched
    from main import app
    from werkzeug.serving import make_server

    srv = make_server("127.0.0.1", 8080, app)
    t   = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    time.sleep(0.3)   # let werkzeug finish binding

    yield {"base_url": "http://127.0.0.1:8080", "token": token}

    srv.shutdown()
    for p in _patches:
        p.stop()


# ─── Shared HTTP response (Gemma 4 called once for all tests) ─────────────────

@pytest.fixture(scope="module")
def mark_response(live_server):
    """Send one real multipart POST; share the response across all assertions."""
    image_bytes = _make_exercise_book_image()

    resp = requests.post(
        f"{live_server['base_url']}/api/mark",
        headers={"Authorization": f"Bearer {live_server['token']}"},
        files={"page_0": ("exercise_book.jpg", image_bytes, "image/jpeg")},
        data={
            "student_id":    STUDENT_ID,
            "answer_key_id": ANSWER_KEY_ID,
            "page_count":    "1",
        },
        timeout=120,
    )
    return resp


# ─── Tests ────────────────────────────────────────────────────────────────────

def test_http_200(mark_response):
    assert mark_response.status_code == 200, (
        f"Expected HTTP 200, got {mark_response.status_code}.\n"
        f"Body: {mark_response.text[:500]}"
    )


def test_response_is_json(mark_response):
    data = mark_response.json()
    assert isinstance(data, dict), f"Expected JSON object, got {type(data)}"


def test_top_level_fields(mark_response):
    data = mark_response.json()
    required = {"mark_id", "score", "max_score", "percentage", "marked_image_url", "verdicts"}
    missing  = required - data.keys()
    assert not missing, f"Response missing top-level fields: {missing}"


def test_verdicts_non_empty(mark_response):
    data = mark_response.json()
    assert len(data["verdicts"]) > 0, "verdicts list must not be empty"


def test_verdict_keys(mark_response):
    data     = mark_response.json()
    required = {
        "question_number", "student_answer", "expected_answer",
        "verdict", "awarded_marks", "max_marks",
    }
    for i, v in enumerate(data["verdicts"]):
        missing = required - v.keys()
        assert not missing, f"verdict[{i}] missing keys: {missing}"


def test_verdict_values(mark_response):
    data    = mark_response.json()
    allowed = {"correct", "incorrect", "partial"}
    for i, v in enumerate(data["verdicts"]):
        assert v["verdict"] in allowed, (
            f"verdict[{i}]['verdict'] = {v['verdict']!r} not in {allowed}"
        )


def test_score_in_range(mark_response):
    data = mark_response.json()
    assert 0 <= data["score"] <= data["max_score"], (
        f"score {data['score']} outside [0, {data['max_score']}]"
    )


def test_percentage_in_range(mark_response):
    data = mark_response.json()
    assert 0.0 <= data["percentage"] <= 100.0, (
        f"percentage {data['percentage']} outside [0, 100]"
    )


def test_marked_image_url_is_string(mark_response):
    data = mark_response.json()
    assert isinstance(data["marked_image_url"], str) and data["marked_image_url"]


def test_print_full_response(mark_response, capsys):
    """Print the complete JSON so the grading output is visible in -s mode."""
    data = mark_response.json()
    with capsys.disabled():
        print("\n── Full /api/mark response ──────────────────────────────────")
        print(json.dumps(data, indent=2))
        print(f"\nTotal: {data['score']}/{data['max_score']} ({data['percentage']}%)")
        print("─────────────────────────────────────────────────────────────")
