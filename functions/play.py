"""
Neriah Play — student-facing arcade-mode endpoints.

A "play lesson" is a bank of 70-100 multiple-choice questions generated from
a chunk of source content (notes, chapter excerpts, syllabus topics) the
student supplies. The student then plays the lesson in one of four arcade
formats — lane runner, stacker, blaster, or snake — with the questions
driving the gameplay.

Routes (all mounted under /api/play):

  POST   /play/lessons                         create lesson + run cloud generator
  GET    /play/lessons                         list mine + class-shared lessons
  GET    /play/lessons/<id>                    fetch full lesson (incl. questions)
  DELETE /play/lessons/<id>                    owner-only cascade delete
  PATCH  /play/lessons/<id>/sharing            toggle class-share / allow-copy
  POST   /play/lessons/<id>/expand             generate more questions (broader)
  POST   /play/lessons/<id>/append             append to source + generate more
  POST   /play/sessions                        record a play session outcome
  GET    /play/lessons/<id>/stats              best/last/total for the calling student

All routes require a student JWT. Authorisation is enforced per route:
the owner can do everything; classmates can only GET shared lessons.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import (
    delete_doc,
    get_doc,
    query,
    upsert,
)
from shared.models import PlayLesson, PlayQuestion, PlaySession
from shared.observability import instrument_route

logger = logging.getLogger(__name__)
play_bp = Blueprint("play", __name__)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _student_class_ids(student_doc: dict) -> list[str]:
    """Return the union of ``class_id`` and ``class_ids`` on a student doc.

    Older student records only had a single ``class_id``; newer multi-class
    enrolments use the plural list. We always merge so authorisation
    checks against both.
    """
    out: list[str] = []
    primary = student_doc.get("class_id")
    if primary:
        out.append(primary)
    for cid in student_doc.get("class_ids") or []:
        if cid and cid not in out:
            out.append(cid)
    return out


def _lesson_summary(lesson: dict, origin: str) -> dict:
    """Strip questions + source content for the list endpoint.

    Returning the full lesson for every list response would push tens of
    KB per student per call; the detail endpoint is the right place for it.
    """
    return {
        "id": lesson.get("id"),
        "title": lesson.get("title"),
        "subject": lesson.get("subject"),
        "grade": lesson.get("grade"),
        "owner_id": lesson.get("owner_id"),
        "question_count": lesson.get("question_count", 0),
        "is_draft": bool(lesson.get("is_draft", False)),
        "created_at": lesson.get("created_at"),
        "shared_with_class": bool(lesson.get("shared_with_class", False)),
        "allow_copying": bool(lesson.get("allow_copying", False)),
        "class_id": lesson.get("class_id"),
        "origin": origin,  # 'mine' | 'class'
    }


def _coerce_questions(raw: list | None) -> list[PlayQuestion]:
    """Defensively rebuild PlayQuestion objects from Firestore dicts.

    Firestore returns plain dicts; the generator wants typed objects so
    its embedding-dedup pre-seeding works cleanly.
    """
    out: list[PlayQuestion] = []
    for q in raw or []:
        try:
            out.append(PlayQuestion(**q))
        except Exception:
            # Skip malformed historical rows rather than crash the route.
            continue
    return out


def _can_read_lesson(lesson: dict, student_id: str, student_doc: dict) -> bool:
    """Owner can always read; classmates only when shared with their class."""
    if lesson.get("owner_id") == student_id:
        return True
    if not lesson.get("shared_with_class"):
        return False
    cid = lesson.get("class_id")
    if not cid:
        return False
    return cid in _student_class_ids(student_doc)


# ─── POST /play/lessons ───────────────────────────────────────────────────────

@play_bp.post("/play/lessons")
@instrument_route("play.lessons.create", "play")
def play_create_lesson():
    """Generate a new play lesson from supplied source content.

    Body:
        {
          "title": "Photosynthesis",
          "source_content": "...",
          "subject": "Biology",     # optional
          "grade":   "Form 3"       # optional
        }
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    source_content = (body.get("source_content") or "").strip()
    subject = body.get("subject")
    grade = body.get("grade")

    if not title:
        return jsonify({"error": "title is required"}), 400
    if len(title) > 120:
        return jsonify({"error": "title must be ≤ 120 characters"}), 400
    if not source_content:
        return jsonify({"error": "source_content is required"}), 400

    # Load student to populate class_ids if the lesson is later shared.
    student = get_doc("students", student_id) or {}

    topic_hint = " · ".join(
        part for part in (
            title,
            subject if isinstance(subject, str) else None,
            grade if isinstance(grade, str) else None,
        ) if part
    )

    from shared.play_generator import generate_lesson_questions
    try:
        questions, count, was_expanded = generate_lesson_questions(
            source_content=source_content,
            target=100,
            minimum=70,
            topic_hint=topic_hint or None,
        )
    except NotImplementedError:
        # Should never happen — backend never sets use_on_device=True.
        return jsonify({"error": "on-device generation is a client-only path"}), 400
    except Exception:
        logger.exception("[play] generation failed for student=%s", student_id)
        return jsonify({
            "error": "We couldn't build a quiz from that content right now. Please try again in a minute."
        }), 503

    if count == 0:
        return jsonify({
            "error": "We couldn't extract any questions from that content. Try adding more detail or pasting longer notes."
        }), 503

    # Auto-expand fills any gap in one pass, so the lesson is never a draft
    # at create time. The minimum threshold is kept on the model for legacy
    # rows but no longer drives a re-prompt on the student.
    lesson = PlayLesson(
        title=title,
        subject=subject if isinstance(subject, str) and subject.strip() else None,
        grade=grade if isinstance(grade, str) and grade.strip() else None,
        owner_id=student_id,
        owner_role="student",
        source_content=source_content,
        questions=questions,
        question_count=count,
        is_draft=False,
        was_expanded=was_expanded,
    )
    upsert("play_lessons", lesson.id, lesson.model_dump())

    out = lesson.model_dump()
    out["origin"] = "mine"
    # Surface primary_class_id on response so the mobile client knows
    # which class the lesson would default-share to.
    primary_class_ids = _student_class_ids(student)
    out["primary_class_id"] = primary_class_ids[0] if primary_class_ids else None
    return jsonify(out), 201


# ─── GET /play/lessons ────────────────────────────────────────────────────────

@play_bp.get("/play/lessons")
@instrument_route("play.lessons.list", "play")
def play_list_lessons():
    """Return the calling student's own lessons + any class-shared ones.

    Each entry is tagged ``origin: 'mine' | 'class'`` so the FE can pick a
    different card style per group. Detail (questions, source_content) is
    NOT included — the detail endpoint serves that.
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    student = get_doc("students", student_id) or {}
    class_ids = _student_class_ids(student)

    mine = query(
        "play_lessons",
        [("owner_id", "==", student_id)],
        order_by="created_at",
        direction="DESCENDING",
    )

    # Firestore "in" supports up to 30 values; classroom counts are well
    # under that, so a single query covers every class the student is in.
    shared: list[dict] = []
    if class_ids:
        try:
            shared = query(
                "play_lessons",
                [
                    ("class_id", "in", class_ids),
                    ("shared_with_class", "==", True),
                ],
                order_by="created_at",
                direction="DESCENDING",
            )
        except Exception:
            logger.exception("[play] shared lessons query failed for student=%s", student_id)
            shared = []

    out: list[dict] = []
    seen: set[str] = set()
    for lesson in mine:
        lid = lesson.get("id")
        if not lid or lid in seen:
            continue
        seen.add(lid)
        out.append(_lesson_summary(lesson, "mine"))
    for lesson in shared:
        lid = lesson.get("id")
        if not lid or lid in seen:
            continue
        # Defensive: don't double-tag a lesson the student happens to own.
        if lesson.get("owner_id") == student_id:
            continue
        seen.add(lid)
        out.append(_lesson_summary(lesson, "class"))

    out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return jsonify(out), 200


# ─── GET /play/lessons/<id> ──────────────────────────────────────────────────

@play_bp.get("/play/lessons/<lesson_id>")
@instrument_route("play.lessons.detail", "play")
def play_lesson_detail(lesson_id: str):
    """Full lesson incl. questions + source_content. Owner OR class-shared."""
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404

    student = get_doc("students", student_id) or {}
    if not _can_read_lesson(lesson, student_id, student):
        return jsonify({"error": "forbidden"}), 403

    # Tag origin so a single FE component handles both "mine" and "class".
    origin = "mine" if lesson.get("owner_id") == student_id else "class"
    lesson_out = dict(lesson)
    lesson_out["origin"] = origin
    return jsonify(lesson_out), 200


# ─── DELETE /play/lessons/<id> ───────────────────────────────────────────────

@play_bp.delete("/play/lessons/<lesson_id>")
@instrument_route("play.lessons.delete", "play")
def play_lesson_delete(lesson_id: str):
    """Owner only. Cascade-deletes every play_session attached to the
    lesson so leaderboard/stats queries can't hang on orphan rows.
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404
    if lesson.get("owner_id") != student_id:
        return jsonify({"error": "forbidden"}), 403

    # Cascade-delete every linked session. This is a best-effort sweep;
    # individual delete failures are logged but don't abort the lesson
    # deletion (which is the user-visible action).
    sessions = query("play_sessions", [("lesson_id", "==", lesson_id)])
    deleted_sessions = 0
    for s in sessions:
        sid = s.get("id")
        if not sid:
            continue
        try:
            delete_doc("play_sessions", sid)
            deleted_sessions += 1
        except Exception:
            logger.exception("[play] failed to delete session %s", sid)

    try:
        delete_doc("play_lessons", lesson_id)
    except Exception:
        logger.exception("[play] failed to delete lesson %s", lesson_id)
        return jsonify({"error": "Delete failed"}), 500

    return jsonify({
        "deleted": True,
        "lesson_id": lesson_id,
        "sessions_deleted": deleted_sessions,
    }), 200


# ─── PATCH /play/lessons/<id>/sharing ────────────────────────────────────────

@play_bp.patch("/play/lessons/<lesson_id>/sharing")
@instrument_route("play.lessons.sharing", "play")
def play_lesson_sharing(lesson_id: str):
    """Owner-only toggle for class sharing + allow-copy.

    Body:
        {
          "shared_with_class": true,
          "allow_copying":     false,
          "class_id":          "cls_..."   # required when shared_with_class=true
                                            # (falls back to student's first class)
        }
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404
    if lesson.get("owner_id") != student_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    shared_with_class = bool(body.get("shared_with_class", False))
    allow_copying = bool(body.get("allow_copying", False))
    class_id: Optional[str] = body.get("class_id") or lesson.get("class_id")

    if shared_with_class:
        if not class_id:
            student = get_doc("students", student_id) or {}
            class_ids = _student_class_ids(student)
            class_id = class_ids[0] if class_ids else None
        if not class_id:
            return jsonify({
                "error": "class_id is required to share — your account is not enrolled in any class."
            }), 400

    updates = {
        "shared_with_class": shared_with_class,
        "allow_copying": allow_copying,
        "class_id": class_id if shared_with_class else None,
    }
    upsert("play_lessons", lesson_id, updates)

    merged = {**lesson, **updates}
    return jsonify({
        "lesson_id": lesson_id,
        "shared_with_class": merged["shared_with_class"],
        "allow_copying": merged["allow_copying"],
        "class_id": merged.get("class_id"),
    }), 200


# ─── POST /play/lessons/<id>/expand ──────────────────────────────────────────

@play_bp.post("/play/lessons/<lesson_id>/expand")
@instrument_route("play.lessons.expand", "play")
def play_lesson_expand(lesson_id: str):
    """Owner-only. Generate additional questions covering broader concepts
    + edge cases drawn from the same source content. Used to push a draft
    lesson over the 70-question threshold without requiring the student to
    type more notes.
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404
    if lesson.get("owner_id") != student_id:
        return jsonify({"error": "forbidden"}), 403

    current_questions = _coerce_questions(lesson.get("questions"))
    base_content = lesson.get("source_content") or ""
    expansion_hint = (
        "\n\nGenerate questions covering broader related concepts and edge cases."
    )

    topic_hint = " · ".join(
        part for part in (
            lesson.get("title"),
            lesson.get("subject"),
            lesson.get("grade"),
        ) if part
    )

    from shared.play_generator import generate_lesson_questions
    try:
        new_bank, new_count, _was_expanded = generate_lesson_questions(
            source_content=base_content + expansion_hint,
            target=100,
            minimum=70,
            existing_questions=current_questions,
            topic_hint=topic_hint or None,
        )
    except Exception:
        logger.exception("[play] expand failed for lesson=%s", lesson_id)
        return jsonify({
            "error": "Couldn't generate more questions right now. Please try again."
        }), 503

    is_draft = new_count < 70
    updates = {
        "questions": [q.model_dump() for q in new_bank],
        "question_count": new_count,
        "is_draft": is_draft,
    }
    upsert("play_lessons", lesson_id, updates)

    return jsonify({
        "lesson_id": lesson_id,
        "question_count": new_count,
        "added": max(0, new_count - len(current_questions)),
        "is_draft": is_draft,
    }), 200


# ─── POST /play/lessons/<id>/append ──────────────────────────────────────────

@play_bp.post("/play/lessons/<lesson_id>/append")
@instrument_route("play.lessons.append", "play")
def play_lesson_append(lesson_id: str):
    """Owner-only. Append additional source content and generate more
    questions covering the combined body. Lets students grow a lesson as
    they cover more of a chapter.

    Body:  {"additional_content": "..."}
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404
    if lesson.get("owner_id") != student_id:
        return jsonify({"error": "forbidden"}), 403

    body = request.get_json(silent=True) or {}
    additional_content = (body.get("additional_content") or "").strip()
    if not additional_content:
        return jsonify({"error": "additional_content is required"}), 400

    base_content = lesson.get("source_content") or ""
    combined = (base_content + "\n\n" + additional_content).strip()

    current_questions = _coerce_questions(lesson.get("questions"))

    topic_hint = " · ".join(
        part for part in (
            lesson.get("title"),
            lesson.get("subject"),
            lesson.get("grade"),
        ) if part
    )

    from shared.play_generator import generate_lesson_questions
    try:
        new_bank, new_count, _was_expanded = generate_lesson_questions(
            source_content=combined,
            target=100,
            minimum=70,
            existing_questions=current_questions,
            topic_hint=topic_hint or None,
        )
    except Exception:
        logger.exception("[play] append failed for lesson=%s", lesson_id)
        return jsonify({
            "error": "Couldn't add more questions right now. Please try again."
        }), 503

    is_draft = new_count < 70
    updates = {
        "source_content": combined,
        "questions": [q.model_dump() for q in new_bank],
        "question_count": new_count,
        "is_draft": is_draft,
    }
    upsert("play_lessons", lesson_id, updates)

    return jsonify({
        "lesson_id": lesson_id,
        "question_count": new_count,
        "added": max(0, new_count - len(current_questions)),
        "is_draft": is_draft,
    }), 200


# ─── POST /play/sessions ─────────────────────────────────────────────────────

@play_bp.post("/play/sessions")
@instrument_route("play.sessions.create", "play")
def play_session_create():
    """Record a play session. Server stamps id + player_id; lesson access
    is verified before the row is written."""
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    body = request.get_json(silent=True) or {}
    lesson_id = (body.get("lesson_id") or "").strip()
    if not lesson_id:
        return jsonify({"error": "lesson_id is required"}), 400

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404

    student = get_doc("students", student_id) or {}
    if not _can_read_lesson(lesson, student_id, student):
        return jsonify({"error": "forbidden"}), 403

    session_id = f"play_{uuid.uuid4().hex[:12]}"
    try:
        session = PlaySession(
            id=session_id,
            lesson_id=lesson_id,
            player_id=student_id,
            game_format=body.get("game_format") or "",
            started_at=body.get("started_at") or _now_iso(),
            ended_at=body.get("ended_at") or _now_iso(),
            duration_seconds=int(body.get("duration_seconds") or 0),
            final_score=int(body.get("final_score") or 0),
            questions_attempted=int(body.get("questions_attempted") or 0),
            questions_correct=int(body.get("questions_correct") or 0),
            end_reason=body.get("end_reason") or "",
        )
    except (TypeError, ValueError) as exc:
        return jsonify({"error": f"invalid session payload: {exc}"}), 400

    upsert("play_sessions", session.id, session.model_dump())
    return jsonify(session.model_dump()), 201


# ─── GET /play/lessons/<id>/stats ────────────────────────────────────────────

@play_bp.get("/play/lessons/<lesson_id>/stats")
@instrument_route("play.lessons.stats", "play")
def play_lesson_stats(lesson_id: str):
    """Return the calling student's best/last/total for the lesson."""
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    lesson = get_doc("play_lessons", lesson_id)
    if not lesson:
        return jsonify({"error": "Lesson not found"}), 404

    student = get_doc("students", student_id) or {}
    if not _can_read_lesson(lesson, student_id, student):
        return jsonify({"error": "forbidden"}), 403

    sessions = query(
        "play_sessions",
        [("player_id", "==", student_id), ("lesson_id", "==", lesson_id)],
        order_by="started_at",
        direction="DESCENDING",
    )

    best_score = 0
    last_played: Optional[str] = None
    for s in sessions:
        try:
            score = int(s.get("final_score") or 0)
        except (TypeError, ValueError):
            score = 0
        if score > best_score:
            best_score = score
        ts = s.get("started_at")
        if ts and (last_played is None or ts > last_played):
            last_played = ts

    return jsonify({
        "lesson_id": lesson_id,
        "best_score": best_score,
        "last_played": last_played,
        "total_sessions": len(sessions),
    }), 200
