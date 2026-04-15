"""
tests/test_student_lookup.py

Unit tests for the student class lookup endpoints.

Covers:
  1. Happy path — valid join code finds the class.
  2. Case-insensitive lookup — lowercase code is normalised to uppercase.
  3. Not-found — unknown join code returns a clear error message.

All Firestore calls are mocked — no network or cloud required.

Run:
    pytest tests/test_student_lookup.py -v
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

# Ensure required env vars are present before any module import
os.environ.setdefault("APP_JWT_SECRET", "test-jwt-secret-at-least-32-chars-ok")
os.environ.setdefault("GCS_BUCKET_SCANS", "neriah-test-scans")
os.environ.setdefault("GCS_BUCKET_MARKED", "neriah-test-marked")
os.environ.setdefault("GCS_BUCKET_SUBMISSIONS", "neriah-test-submissions")
os.environ.setdefault("WHATSAPP_VERIFY_TOKEN", "test-verify-token")
os.environ.setdefault("WHATSAPP_ACCESS_TOKEN", "test-access-token")
os.environ.setdefault("WHATSAPP_PHONE_NUMBER_ID", "test-phone-id")
os.environ.setdefault("NERIAH_ENV", "demo")

# ── Fixtures ───────────────────────────────────────────────────────────────────

_CLASS_DOC = {
    "id": "class-001",
    "name": "Form 2A",
    "education_level": "form_2",
    "subject": "Mathematics",
    "join_code": "NR2A01",
    "teacher_id": "teacher-001",
    "school_id": "school-001",
}

_TEACHER_DOC = {
    "id": "teacher-001",
    "name": "Mr. Maisiri",
    "first_name": "Maisiri",
    "surname": "",
    "phone": "+263771234567",
    "role": "teacher",
    "token_version": 0,
}

_SCHOOL_DOC = {
    "id": "school-001",
    "name": "Greendale Primary School",
    "city": "Harare",
}


def _make_client():
    """Return a Flask test client from the module-level app in main.py."""
    import shared.firestore_client as fsc
    fsc._db = None  # reset cached client between tests

    from main import app  # module-level Flask instance
    app.config["TESTING"] = True
    return app.test_client()


def _firestore_side_effect(collection: str, doc_id: str):
    """Mock get_doc to return the right fixture depending on collection."""
    if collection == "classes":
        return _CLASS_DOC if doc_id == "class-001" else None
    if collection == "teachers":
        return _TEACHER_DOC if doc_id == "teacher-001" else None
    if collection == "schools":
        return _SCHOOL_DOC if doc_id == "school-001" else None
    return None


# ── Test 1 — valid join code returns class details ─────────────────────────────

def test_student_lookup_finds_class_by_join_code():
    """POST /auth/student/lookup with a valid code returns 200 + class payload."""
    with (
        patch("shared.firestore_client.get_db"),
        patch("functions.auth.query_single", return_value=_CLASS_DOC) as mock_qs,
        patch("functions.auth.get_doc", side_effect=_firestore_side_effect),
    ):
        client = _make_client()
        resp = client.post(
            "/api/auth/student/lookup",
            json={"join_code": "NR2A01"},
            content_type="application/json",
        )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_json()}"
    data = resp.get_json()
    assert data["id"] == "class-001"
    assert data["name"] == "Form 2A"
    assert data["join_code"] == "NR2A01"
    # query_single must have been called with the exact uppercase code
    mock_qs.assert_called_once_with("classes", [("join_code", "==", "NR2A01")])


# ── Test 2 — lowercase code is normalised before lookup ───────────────────────

def test_student_lookup_case_insensitive():
    """
    POST /auth/student/lookup with a lowercase join code normalises to uppercase
    before querying Firestore, so the lookup still succeeds.
    """
    with (
        patch("shared.firestore_client.get_db"),
        patch("functions.auth.query_single", return_value=_CLASS_DOC) as mock_qs,
        patch("functions.auth.get_doc", side_effect=_firestore_side_effect),
    ):
        client = _make_client()
        resp = client.post(
            "/api/auth/student/lookup",
            json={"join_code": "nr2a01"},   # lowercase
            content_type="application/json",
        )

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.get_json()}"
    data = resp.get_json()
    # Normalised code returned in response
    assert data["join_code"] == "NR2A01"
    # Firestore was queried with the uppercase version
    mock_qs.assert_called_once_with("classes", [("join_code", "==", "NR2A01")])


# ── Test 3 — unknown join code returns a clear error ─────────────────────────

def test_student_lookup_returns_clear_error_for_bad_code():
    """
    POST /auth/student/lookup with an invalid join code returns 404 with a
    human-readable error message (not a generic 500 or silent empty list).
    """
    with (
        patch("shared.firestore_client.get_db"),
        patch("functions.auth.query_single", return_value=None),
        patch("functions.auth.get_doc", return_value=None),
    ):
        client = _make_client()
        resp = client.post(
            "/api/auth/student/lookup",
            json={"join_code": "XXBAD9"},
            content_type="application/json",
        )

    assert resp.status_code == 404, f"Expected 404, got {resp.status_code}: {resp.get_json()}"
    data = resp.get_json()
    assert "error" in data
    # Error must be human-readable — not a raw exception or empty string
    assert len(data["error"]) > 10, f"Error message too short: {data['error']!r}"
    assert "class" in data["error"].lower() or "code" in data["error"].lower()
