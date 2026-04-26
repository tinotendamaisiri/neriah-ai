"""
tests/test_email_submission.py

Coverage for the email-submission channel introduced for the Zoho IMAP
poller. All Firestore + IMAP + Gemma + Resend calls are mocked — no
network or cloud required.

Layers tested:
  1. shared.email_parser     — MIME parsing edge cases
  2. shared.student_matcher  — subject parsing + fuzzy match + auto-enrol
  3. functions.email_poller  — full _process_message pipeline
  4. functions.submissions   — channel-aware approval dispatcher

Run:
    pytest tests/test_email_submission.py -v
"""

from __future__ import annotations

import os
from email.message import EmailMessage
from unittest.mock import MagicMock, patch

import pytest

# Same env-var dance as the rest of the test suite.
os.environ.setdefault("APP_JWT_SECRET", "test-jwt-secret-at-least-32-chars-ok")
os.environ.setdefault("GCS_BUCKET_SCANS", "neriah-test-scans")
os.environ.setdefault("GCS_BUCKET_MARKED", "neriah-test-marked")
os.environ.setdefault("GCS_BUCKET_SUBMISSIONS", "neriah-test-submissions")
os.environ.setdefault("WHATSAPP_VERIFY_TOKEN", "test-verify-token")
os.environ.setdefault("WHATSAPP_ACCESS_TOKEN", "test-access-token")
os.environ.setdefault("WHATSAPP_PHONE_NUMBER_ID", "test-phone-id")
os.environ.setdefault("NERIAH_ENV", "demo")


# ─── shared.email_parser ──────────────────────────────────────────────────────

from shared.email_parser import parse_rfc822  # noqa: E402


def _build_email(
    *,
    sender: str = "alice@example.com",
    subject: str = "Name: Alice Mukamuri | Class: Form 4A | School: St Marys",
    body: str = "Here is my homework.",
    attachments: list[tuple[str, bytes, str]] | None = None,
) -> bytes:
    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = "mark@neriah.ai"
    msg["Subject"] = subject
    msg.set_content(body)
    for filename, payload, ct in attachments or []:
        maintype, subtype = ct.split("/", 1)
        msg.add_attachment(payload, maintype=maintype, subtype=subtype, filename=filename)
    return msg.as_bytes()


def test_parser_extracts_sender_subject_body():
    raw = _build_email(body="Hello from class")
    parsed = parse_rfc822(raw)
    assert parsed.sender == "alice@example.com"
    assert "Form 4A" in parsed.subject
    assert "Hello from class" in parsed.body_text
    assert parsed.has_usable_attachment is False


def test_parser_keeps_image_and_pdf_attachments():
    raw = _build_email(attachments=[
        ("page.jpg", b"\xff\xd8jpegbytes", "image/jpeg"),
        ("doc.pdf", b"%PDF-1.4 fakepdf", "application/pdf"),
    ])
    parsed = parse_rfc822(raw)
    assert len(parsed.usable_attachments) == 2
    cts = [a[2] for a in parsed.usable_attachments]
    assert "image/jpeg" in cts
    assert "application/pdf" in cts


def test_parser_drops_unsupported_attachment_types():
    raw = _build_email(attachments=[
        ("notes.docx", b"docxbytes", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("page.jpg", b"jpeg", "image/jpeg"),
    ])
    parsed = parse_rfc822(raw)
    assert len(parsed.usable_attachments) == 1
    assert parsed.usable_attachments[0][2] == "image/jpeg"
    assert any("docx" in name or "wordprocessing" in ct for name, ct, _ in parsed.skipped_attachments)


def test_parser_drops_oversized_attachments():
    huge = b"x" * (11 * 1024 * 1024)  # 11 MB > 10 MB limit
    raw = _build_email(attachments=[("big.jpg", huge, "image/jpeg")])
    parsed = parse_rfc822(raw)
    assert parsed.usable_attachments == []
    assert parsed.skipped_attachments
    assert "too large" in parsed.skipped_attachments[0][2]


def test_parser_handles_empty_body_gracefully():
    raw = _build_email(body="")
    parsed = parse_rfc822(raw)
    assert parsed.sender == "alice@example.com"


# ─── shared.student_matcher ───────────────────────────────────────────────────

from shared.student_matcher import (  # noqa: E402
    MatchStatus,
    match_student,
    parse_subject,
)


def test_subject_parses_pipe_delimited_format():
    fields = parse_subject("Name: Alice Mukamuri | Class: Form 4A | School: St Marys")
    assert fields is not None
    assert fields.student_name == "Alice Mukamuri"
    assert fields.class_name == "Form 4A"
    assert fields.school_name == "St Marys"


def test_subject_parses_hyphen_fallback():
    fields = parse_subject("Alice Mukamuri - Form 4A - St Marys")
    assert fields is not None
    assert fields.student_name == "Alice Mukamuri"
    assert fields.class_name == "Form 4A"


def test_subject_falls_back_to_body():
    fields = parse_subject("homework", "Name: Bob | Class: Form 1B | School: Highlands")
    assert fields is not None
    assert fields.student_name == "Bob"


def test_subject_returns_none_when_unparseable():
    assert parse_subject("just a subject", "no body fields either") is None


def _patch_matcher_firestore(*, schools, classes, students, existing_by_email=None):
    """Bundle the four Firestore patches the matcher needs."""
    existing_by_email = existing_by_email or {}

    def fake_query(collection, filters):
        if collection == "schools":
            return schools
        if collection == "classes":
            for f in filters:
                if f[0] == "school_id" and f[1] == "==":
                    return [c for c in classes if c.get("school_id") == f[2]]
            return classes
        if collection == "students":
            for f in filters:
                if f[0] == "class_id" and f[1] == "==":
                    return [s for s in students if s.get("class_id") == f[2]]
            return students
        return []

    def fake_query_single(collection, filters):
        if collection == "students":
            for f in filters:
                if f[0] == "email" and f[1] == "==":
                    return existing_by_email.get(f[2])
        return None

    return [
        patch("shared.student_matcher.query", side_effect=fake_query),
        patch("shared.student_matcher.query_single", side_effect=fake_query_single),
        patch("shared.student_matcher.get_doc", return_value=None),
        patch("shared.student_matcher.upsert"),
    ]


def test_matcher_routes_to_existing_student_by_name():
    schools = [{"id": "school-1", "name": "St Marys"}]
    classes = [{"id": "class-1", "name": "Form 4A", "school_id": "school-1"}]
    students = [{"id": "stu-1", "first_name": "Alice", "surname": "Mukamuri", "class_id": "class-1"}]

    with patch("shared.student_matcher.query") as q, \
         patch("shared.student_matcher.query_single", return_value=None), \
         patch("shared.student_matcher.get_doc", return_value=None), \
         patch("shared.student_matcher.upsert") as up:
        q.side_effect = lambda c, f: {
            "schools": schools,
            "classes": classes,
            "students": students,
        }.get(c, [])

        from shared.student_matcher import SubjectFields
        result = match_student(
            SubjectFields(
                student_name="Alice Mukamuri",
                class_name="Form 4A",
                school_name="St Marys",
            ),
            sender_email="alice@example.com",
        )
        assert result.status == MatchStatus.MATCHED
        assert result.student["id"] == "stu-1"
        # Email backfill should have fired because the matched student
        # didn't have one stored yet.
        up.assert_called()


def test_matcher_auto_enrols_when_no_student_in_class():
    schools = [{"id": "school-1", "name": "St Marys"}]
    classes = [{"id": "class-1", "name": "Form 4A", "school_id": "school-1"}]

    with patch("shared.student_matcher.query") as q, \
         patch("shared.student_matcher.query_single", return_value=None), \
         patch("shared.student_matcher.get_doc", return_value=None), \
         patch("shared.student_matcher.upsert") as up:
        q.side_effect = lambda c, f: {
            "schools": schools,
            "classes": classes,
            "students": [],
        }.get(c, [])

        from shared.student_matcher import SubjectFields
        result = match_student(
            SubjectFields(
                student_name="Charlie Banda",
                class_name="Form 4A",
                school_name="St Marys",
            ),
            sender_email="charlie@example.com",
        )
        assert result.status == MatchStatus.AUTO_ENROLLED
        assert result.student["first_name"] == "Charlie"
        assert result.student["surname"] == "Banda"
        assert result.student["email"] == "charlie@example.com"
        assert result.student["class_id"] == "class-1"
        up.assert_called_once()


def test_matcher_returns_not_found_when_school_unknown():
    with patch("shared.student_matcher.query") as q, \
         patch("shared.student_matcher.query_single", return_value=None):
        q.side_effect = lambda c, f: {
            "schools": [{"id": "school-1", "name": "Highlands High"}],
        }.get(c, [])

        from shared.student_matcher import SubjectFields
        result = match_student(
            SubjectFields(
                student_name="Alice",
                class_name="Form 4A",
                school_name="Atlantis Academy",
            ),
            sender_email="alice@example.com",
        )
        assert result.status == MatchStatus.NOT_FOUND_SCHOOL


# ─── functions.submissions dispatcher (channel-aware) ─────────────────────────

def test_dispatcher_skips_secondary_channels_when_mark_missing():
    from functions.submissions import _dispatch_student_reply_secondary_channels

    with patch("functions.submissions.get_doc", return_value=None):
        # Should not raise even though there's nothing to dispatch on.
        _dispatch_student_reply_secondary_channels(
            student_id="stu-1", mark_id=None, hw={}, sub={},
        )


def test_dispatcher_routes_email_source_to_resend():
    """Email-source mark + student with email + downloadable annotated
    blob → send_grade_reply is invoked exactly once."""
    from functions import submissions as subs_mod

    mark = {
        "id": "m1",
        "source": "email_submission",
        "annotated_urls": ["signed-url-page-0"],
        "page_count": 1,
        "verdicts": [{"question_number": 1, "verdict": "correct", "awarded_marks": 2, "max_marks": 2}],
        "percentage": 100.0,
    }
    student = {
        "id": "stu-1",
        "first_name": "Alice",
        "surname": "Mukamuri",
        "email": "alice@example.com",
    }

    def fake_get_doc(coll, doc_id):
        return {"marks": mark, "students": student}.get(coll)

    with patch("functions.submissions.get_doc", side_effect=fake_get_doc), \
         patch("shared.gcs_client.download_bytes", return_value=b"jpegbytes") as dl, \
         patch("shared.email_client.send_grade_reply", return_value=True) as send:
        subs_mod._dispatch_student_reply_secondary_channels(
            student_id="stu-1",
            mark_id="m1",
            hw={"title": "Algebra Q1-Q3"},
            sub={"score": 2, "max_score": 2},
        )
    dl.assert_called_once()
    send.assert_called_once()
    kwargs = send.call_args.kwargs
    assert kwargs["student_email"] == "alice@example.com"
    assert kwargs["student_name"] == "Alice Mukamuri"
    assert kwargs["score"] == 2


def test_dispatcher_routes_whatsapp_source_to_send_image():
    from functions import submissions as subs_mod

    mark = {
        "id": "m2",
        "source": "student_whatsapp",
        "annotated_urls": ["signed-url-0"],
        "marked_image_url": "signed-url-0",
        "percentage": 75.0,
    }
    student = {"id": "stu-2", "phone": "+263777111222"}

    def fake_get_doc(coll, doc_id):
        return {"marks": mark, "students": student}.get(coll)

    with patch("functions.submissions.get_doc", side_effect=fake_get_doc), \
         patch("shared.whatsapp_client.send_image") as wa:
        subs_mod._dispatch_student_reply_secondary_channels(
            student_id="stu-2",
            mark_id="m2",
            hw={"title": "Geography"},
            sub={"score": 3, "max_score": 4},
        )
    wa.assert_called_once()
    args = wa.call_args.args
    assert args[0] == "+263777111222"
    assert args[1] == "signed-url-0"


def test_dispatcher_does_not_send_resend_for_whatsapp_source():
    """Belt-and-braces: a WhatsApp mark must not trigger an email."""
    from functions import submissions as subs_mod

    mark = {"id": "m3", "source": "student_whatsapp"}
    student = {"id": "stu-3", "phone": "+263777", "email": "shouldnt-fire@example.com"}

    def fake_get_doc(coll, doc_id):
        return {"marks": mark, "students": student}.get(coll)

    with patch("functions.submissions.get_doc", side_effect=fake_get_doc), \
         patch("shared.whatsapp_client.send_image"), \
         patch("shared.email_client.send_grade_reply") as send:
        subs_mod._dispatch_student_reply_secondary_channels(
            student_id="stu-3",
            mark_id="m3",
            hw={},
            sub={"score": 0, "max_score": 1},
        )
    send.assert_not_called()


# ─── functions.email_poller — _process_message happy path ─────────────────────

def test_process_message_rejects_when_no_attachment():
    from functions.email_poller import _process_message, FAILED_FOLDER
    from shared.email_parser import ParsedEmail

    parsed = ParsedEmail(
        sender="x@example.com",
        subject="hello",
        body_text="",
        usable_attachments=[],
    )
    with patch("functions.email_poller.send_format_error") as sfe:
        dest = _process_message(parsed)
    assert dest == FAILED_FOLDER
    sfe.assert_called_once()


def test_process_message_rejects_when_subject_unparseable():
    from functions.email_poller import _process_message, FAILED_FOLDER
    from shared.email_parser import ParsedEmail

    parsed = ParsedEmail(
        sender="x@example.com",
        subject="just hi",
        body_text="",
        usable_attachments=[("p.jpg", b"jpeg", "image/jpeg")],
    )
    with patch("functions.email_poller.send_format_error") as sfe:
        dest = _process_message(parsed)
    assert dest == FAILED_FOLDER
    sfe.assert_called_once()
