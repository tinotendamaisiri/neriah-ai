"""
Tests for the new ``approved_count`` field on homework list responses.

approved_count counts only submissions explicitly approved by the teacher
(approved=True OR status='approved'). It drives the homework "Graded"
badge in the mobile UI — the badge fires only when every submission has
been teacher-approved, never on AI-graded-but-unreviewed submissions.

graded_count keeps its existing inclusive semantics (AI-graded or
teacher-approved) for backwards compatibility.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest


CLASS_ID = "cls1"
TEACHER_ID = "tch1"


def _hw(hw_id: str, title: str = "HW") -> dict:
    return {
        "id": hw_id, "class_id": CLASS_ID, "teacher_id": TEACHER_ID,
        "title": title, "subject": "Mathematics", "education_level": "Form 2",
        "due_date": None, "created_at": "2026-04-01T07:00:00Z",
        "open_for_submission": True, "status": "active",
        "questions": [], "total_marks": 10,
    }


def _sub(hw_id: str, idx: int, status: str = "pending", approved: bool = False) -> dict:
    return {
        "id": f"sub-{hw_id}-{idx}", "answer_key_id": hw_id,
        "class_id": CLASS_ID, "student_id": f"stu{idx}",
        "status": status, "approved": approved,
        "submitted_at": "2026-04-10T08:00:00Z",
    }


@pytest.fixture
def app_client(monkeypatch):
    """Test client with stubbed auth + Firestore."""
    from flask import Flask
    from functions.answer_keys import answer_keys_bp

    app = Flask(__name__)
    app.register_blueprint(answer_keys_bp, url_prefix="/api")

    monkeypatch.setattr(
        "functions.answer_keys.require_role",
        lambda req, role: (TEACHER_ID, None),
    )
    return app.test_client()


def _patch_doc(monkeypatch, hw_list: list[dict], subs: list[dict]):
    def fake_query(collection, filters=None, **kwargs):
        if collection == "answer_keys":
            return list(hw_list)
        if collection == "student_submissions":
            return list(subs)
        return []

    def fake_get_doc(collection, doc_id):
        if collection == "classes" and doc_id == CLASS_ID:
            return {"id": CLASS_ID, "teacher_id": TEACHER_ID, "name": "Form 2A"}
        return None

    monkeypatch.setattr("functions.answer_keys.query", fake_query)
    monkeypatch.setattr("functions.answer_keys.get_doc", fake_get_doc)
    monkeypatch.setattr("functions.answer_keys.upsert", lambda *a, **kw: None)


# ── approved_count is exposed alongside graded_count ──────────────────────────

def test_response_includes_approved_count_field(app_client, monkeypatch):
    hw = _hw("hw1")
    _patch_doc(monkeypatch, [hw], subs=[])

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    assert rv.status_code == 200
    item = rv.get_json()[0]
    assert "approved_count" in item
    assert item["approved_count"] == 0


# ── Counting semantics ────────────────────────────────────────────────────────

def test_ai_graded_unapproved_counts_as_graded_not_approved(app_client, monkeypatch):
    """status='graded' (AI run, awaiting teacher review) → graded_count yes, approved_count no."""
    hw = _hw("hw1")
    subs = [_sub("hw1", 1, status="graded", approved=False)]
    _patch_doc(monkeypatch, [hw], subs=subs)

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["submission_count"] == 1
    assert item["graded_count"]    == 1   # backwards compat
    assert item["approved_count"]  == 0   # NOT approved by teacher
    assert item["pending_count"]   == 0


def test_teacher_approved_counts_in_both(app_client, monkeypatch):
    hw = _hw("hw1")
    subs = [_sub("hw1", 1, status="approved", approved=True)]
    _patch_doc(monkeypatch, [hw], subs=subs)

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["graded_count"]   == 1
    assert item["approved_count"] == 1


def test_approved_flag_alone_counts_as_approved(app_client, monkeypatch):
    """approved=True with status='graded' should still count toward approved_count."""
    hw = _hw("hw1")
    subs = [_sub("hw1", 1, status="graded", approved=True)]
    _patch_doc(monkeypatch, [hw], subs=subs)

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["approved_count"] == 1


def test_pending_submission_counts_neither(app_client, monkeypatch):
    hw = _hw("hw1")
    subs = [_sub("hw1", 1, status="pending", approved=False)]
    _patch_doc(monkeypatch, [hw], subs=subs)

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["submission_count"] == 1
    assert item["graded_count"]    == 0
    assert item["approved_count"]  == 0
    assert item["pending_count"]   == 1


# ── The "all approved" scenario the mobile badge reads ────────────────────────

def test_all_approved_reads_as_fully_approved(app_client, monkeypatch):
    """3 submissions, all approved → approved_count == submission_count → mobile shows Graded."""
    hw = _hw("hw1")
    subs = [
        _sub("hw1", 1, status="approved", approved=True),
        _sub("hw1", 2, status="approved", approved=True),
        _sub("hw1", 3, status="approved", approved=True),
    ]
    _patch_doc(monkeypatch, [hw], subs=subs)

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["submission_count"] == 3
    assert item["approved_count"]  == 3
    # The mobile rule: approved_count >= submission_count > 0 → Graded
    assert item["approved_count"] >= item["submission_count"] > 0


def test_partial_approval_reads_as_pending(app_client, monkeypatch):
    """2 of 3 approved → mobile rule still says pending."""
    hw = _hw("hw1")
    subs = [
        _sub("hw1", 1, status="approved", approved=True),
        _sub("hw1", 2, status="approved", approved=True),
        _sub("hw1", 3, status="graded",   approved=False),  # AI graded, not approved
    ]
    _patch_doc(monkeypatch, [hw], subs=subs)

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["submission_count"] == 3
    assert item["graded_count"]    == 3   # all AI-graded (loose definition)
    assert item["approved_count"]  == 2   # only 2 teacher-approved
    # Mobile rule: 2 < 3 → still pending
    assert item["approved_count"] < item["submission_count"]


def test_no_submissions_pending(app_client, monkeypatch):
    """Homework with zero submissions reads as pending — past-due no longer matters."""
    hw = _hw("hw1")
    _patch_doc(monkeypatch, [hw], subs=[])

    rv = app_client.get(f"/api/answer-keys?class_id={CLASS_ID}")
    item = rv.get_json()[0]
    assert item["submission_count"] == 0
    assert item["approved_count"]  == 0
    # Mobile rule: submission_count <= 0 → always pending
