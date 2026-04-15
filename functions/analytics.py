"""Analytics endpoint — per-class and per-student stats."""

from __future__ import annotations

import logging
from collections import defaultdict

from flask import Blueprint, jsonify, request

from shared.auth import require_role
from shared.firestore_client import get_doc, query

logger = logging.getLogger(__name__)
analytics_bp = Blueprint("analytics", __name__)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _student_name(student: dict) -> str:
    if not student:
        return "Unknown"
    return f"{student.get('first_name', '')} {student.get('surname', '')}".strip()


def _trend(scores: list[float]) -> str:
    """Returns 'up', 'down', or 'stable' based on last 3 scores."""
    if len(scores) < 2:
        return "stable"
    delta = scores[-1] - scores[-2]
    if delta > 5:
        return "up"
    if delta < -5:
        return "down"
    return "stable"


def _class_analytics_data(class_id: str) -> dict:
    """
    Core analytics computation for a class. Returns a dict with has_data,
    reason, and all computed fields. Used by both the class endpoint and
    the classes-summary endpoint.
    """
    homeworks = query("answer_keys", [("class_id", "==", class_id)])
    homework_count = len(homeworks)
    logger.info("Analytics: class=%s homework_count=%d", class_id, homework_count)

    if homework_count == 0:
        return {
            "has_data": False,
            "reason": "no_homeworks",
            "homework_count": 0,
            "graded_submissions_count": 0,
            "message": "No homework has been assigned for this class yet.",
        }

    # Approved marks only (graded = approved=True in marks collection)
    all_marks = query("marks", [("class_id", "==", class_id)], order_by="timestamp")
    approved_marks = [m for m in all_marks if m.get("approved") or m.get("status") in ("approved", "graded")]
    graded_count = len(approved_marks)
    logger.info("Analytics: class=%s marks_total=%d approved=%d", class_id, len(all_marks), graded_count)

    if graded_count == 0:
        return {
            "has_data": False,
            "reason": "no_graded_submissions",
            "homework_count": homework_count,
            "graded_submissions_count": 0,
            "message": "No submissions have been graded yet. Grade student work to see analytics.",
        }

    students = query("students", [("class_id", "==", class_id)])
    student_map = {s["id"]: s for s in students}

    # Aggregate per-student from approved marks
    per_student: dict[str, list] = defaultdict(list)
    for m in approved_marks:
        sid = m.get("student_id", "")
        if sid:
            per_student[sid].append(m)

    student_data: list[dict] = []
    all_scores: list[float] = []

    for student in students:
        sid = student["id"]
        s_marks = per_student.get(sid, [])

        if s_marks:
            scores = [float(m.get("percentage", 0)) for m in s_marks]
            avg = round(sum(scores) / len(scores), 1)
            all_scores.append(avg)

            all_verdicts: list[dict] = []
            for m in s_marks:
                all_verdicts.extend(m.get("verdicts", []))
            weak = list({
                v.get("question_text", "")[:50]
                for v in all_verdicts
                if v.get("verdict") == "incorrect" and v.get("question_text")
            })[:3]

            student_data.append({
                "student_id": sid,
                "name": _student_name(student),
                "average_score": avg,
                "submission_count": len(s_marks),
                "highest_score": round(max(scores), 1),
                "lowest_score": round(min(scores), 1),
                "latest_score": round(scores[-1], 1),
                "weak_topics": weak,
                "score_trend": [round(s, 1) for s in scores[-3:]],
                "trend": _trend(scores),
            })
        else:
            student_data.append({
                "student_id": sid,
                "name": _student_name(student),
                "average_score": 0,
                "submission_count": 0,
                "highest_score": 0,
                "lowest_score": 0,
                "latest_score": 0,
                "weak_topics": [],
                "score_trend": [],
                "trend": "stable",
                "no_submissions": True,
            })

    class_average = round(sum(all_scores) / len(all_scores), 1) if all_scores else 0.0
    submitting = len([s for s in student_data if s["submission_count"] > 0])
    sorted_students = sorted(student_data, key=lambda s: s["average_score"], reverse=True)

    return {
        "has_data": True,
        "limited_data": graded_count < 3,
        "homework_count": homework_count,
        "graded_submissions_count": graded_count,
        "class_average": class_average,
        "highest_score": round(max(all_scores), 1) if all_scores else 0,
        "lowest_score": round(min(all_scores), 1) if all_scores else 0,
        "submission_rate": f"{submitting}/{len(students)}",
        "total_students": len(students),
        "students": sorted_students,
        "top_students": sorted_students[:3],
        "struggling_students": [
            s for s in sorted_students
            if s["average_score"] < 50 and not s.get("no_submissions")
        ],
    }


# ── GET /api/analytics (legacy — kept for backwards compatibility) ─────────────

@analytics_bp.get("/analytics")
def analytics():
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    class_id = request.args.get("class_id", "").strip()
    if not class_id:
        return jsonify({"error": "class_id query param is required"}), 400

    cls = get_doc("classes", class_id)
    if not cls or cls.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden or not found"}), 403

    logger.info("Analytics (legacy): teacher_id=%s class_id=%s", teacher_id, class_id)

    data = _class_analytics_data(class_id)
    data["class_id"] = class_id
    data["class_name"] = cls.get("name", "")
    data["education_level"] = cls.get("education_level", "")
    return jsonify(data), 200


# ── GET /api/analytics/classes ────────────────────────────────────────────────

@analytics_bp.get("/analytics/classes")
def analytics_classes():
    """
    Summary card data for every class owned by this teacher.
    Each card includes has_data, class_average, total_submissions so the
    AnalyticsScreen can decide whether to lock or unlock the card.
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    logger.info("Analytics/classes: teacher_id=%s", teacher_id)

    classes = query("classes", [("teacher_id", "==", teacher_id)])
    summaries = []

    for cls in classes:
        class_id = cls["id"]
        data = _class_analytics_data(class_id)

        summaries.append({
            "class_id": class_id,
            "class_name": cls.get("name", ""),
            "education_level": cls.get("education_level", ""),
            "subject": cls.get("subject"),
            "has_data": data["has_data"],
            "reason": data.get("reason"),
            "homework_count": data.get("homework_count", 0),
            "total_students": data.get("total_students", len(query("students", [("class_id", "==", class_id)]))),
            "total_submissions": data.get("graded_submissions_count", 0),
            "average_score": data.get("class_average", 0) if data["has_data"] else 0,
            "recent_trend": (
                _trend([s["average_score"] for s in data.get("students", []) if s.get("submission_count", 0) > 0])
                if data["has_data"] else "stable"
            ),
        })

    logger.info("Analytics/classes: teacher_id=%s → %d classes", teacher_id, len(summaries))
    return jsonify(summaries), 200


# ── GET /api/analytics/class/<class_id> ───────────────────────────────────────

@analytics_bp.get("/analytics/class/<class_id>")
def analytics_class(class_id: str):
    """Full class analytics breakdown with has_data flag."""
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    cls = get_doc("classes", class_id)
    if not cls or cls.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden or not found"}), 403

    logger.info("Analytics/class: teacher_id=%s class_id=%s", teacher_id, class_id)

    data = _class_analytics_data(class_id)
    data["class_id"] = class_id
    data["class_name"] = cls.get("name", "")
    data["education_level"] = cls.get("education_level", "")
    data["subject"] = cls.get("subject")
    return jsonify(data), 200


# ── GET /api/analytics/student/<student_id> ───────────────────────────────────

@analytics_bp.get("/analytics/student/<student_id>")
def analytics_student(student_id: str):
    """Per-student breakdown for a teacher."""
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    class_id = request.args.get("class_id", "").strip()

    student = get_doc("students", student_id)
    if not student:
        return jsonify({"error": "Student not found"}), 404

    # Authorise via the class
    effective_class_id = class_id or student.get("class_id", "")
    cls = get_doc("classes", effective_class_id)
    if not cls or cls.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    logger.info("Analytics/student: teacher_id=%s student_id=%s", teacher_id, student_id)

    marks = query("marks", [("student_id", "==", student_id)], order_by="timestamp")
    approved = [m for m in marks if m.get("approved") or m.get("status") in ("approved", "graded")]

    if not approved:
        return jsonify({
            "has_data": False,
            "reason": "no_graded_submissions",
            "student": {
                "id": student_id,
                "name": _student_name(student),
                "average_score": 0,
                "total_submissions": 0,
            },
            "performance_over_time": [],
            "strengths": [],
            "weaknesses": [],
            "submissions": [],
        }), 200

    scores = [float(m.get("percentage", 0)) for m in approved]
    avg = round(sum(scores) / len(scores), 1)

    all_verdicts: list[dict] = []
    for m in approved:
        all_verdicts.extend(m.get("verdicts", []))

    incorrect = [v for v in all_verdicts if v.get("verdict") == "incorrect"]
    correct   = [v for v in all_verdicts if v.get("verdict") == "correct"]

    weaknesses = list({v.get("question_text", "")[:50] for v in incorrect if v.get("question_text")})[:5]
    strengths  = list({v.get("question_text", "")[:50] for v in correct   if v.get("question_text")})[:5]

    # Batch-fetch unique answer keys to avoid N+1 queries
    unique_ak_ids = list({m.get("answer_key_id", "") for m in approved if m.get("answer_key_id")})
    ak_map: dict[str, dict] = {}
    for ak_id in unique_ak_ids:
        doc = get_doc("answer_keys", ak_id)
        if doc:
            ak_map[ak_id] = doc

    # Per-homework history
    perf_over_time = []
    submissions_out = []
    for m in approved:
        ak = ak_map.get(m.get("answer_key_id", ""), {})
        title = ak.get("title") or ak.get("subject") or "Homework"
        pct   = float(m.get("percentage", 0))
        perf_over_time.append({
            "homework_title": title,
            "date": m.get("timestamp", ""),
            "score_pct": round(pct, 1),
            "class_average": 0,   # expensive to compute here; leave 0 unless needed
        })
        submissions_out.append({
            "id": m.get("id", ""),
            "homework_title": title,
            "date": m.get("timestamp", ""),
            "score": m.get("score", 0),
            "max_score": m.get("max_score", 0),
        })

    return jsonify({
        "has_data": True,
        "student": {
            "id": student_id,
            "name": _student_name(student),
            "register_number": student.get("register_number"),
            "average_score": avg,
            "total_submissions": len(approved),
            "first_submission_date": approved[0].get("timestamp") if approved else None,
        },
        "performance_over_time": perf_over_time,
        "strengths": [{"topic": s} for s in strengths],
        "weaknesses": [{"topic": w} for w in weaknesses],
        "submissions": submissions_out,
    }), 200


# ── GET /api/analytics/homework/<homework_id> ────────────────────────────────

@analytics_bp.get("/analytics/homework/<homework_id>")
def analytics_homework(homework_id: str):
    """
    Per-homework analytics: who submitted, what they scored.
    Requires teacher JWT. The homework must belong to one of the teacher's classes.
    """
    teacher_id, err = require_role(request, "teacher")
    if err:
        return jsonify({"error": err}), 401

    ak = get_doc("answer_keys", homework_id)
    if not ak:
        return jsonify({"error": "Homework not found"}), 404

    cls = get_doc("classes", ak.get("class_id", ""))
    if not cls or cls.get("teacher_id") != teacher_id:
        return jsonify({"error": "forbidden"}), 403

    logger.info("Analytics/homework: teacher_id=%s homework_id=%s", teacher_id, homework_id)

    all_marks = query("marks", [("answer_key_id", "==", homework_id)], order_by="timestamp")
    approved = [m for m in all_marks if m.get("approved") or m.get("status") in ("approved", "graded")]

    if not approved:
        return jsonify({
            "has_data": False,
            "reason": "no_graded_submissions",
            "homework_id": homework_id,
            "homework_title": ak.get("title") or ak.get("subject") or "Homework",
            "submission_count": 0,
            "students": [],
        }), 200

    scores = [float(m.get("percentage", 0)) for m in approved]
    average_score = round(sum(scores) / len(scores), 1)
    highest_score = round(max(scores), 1)
    lowest_score  = round(min(scores), 1)

    # Build per-student list
    students_out = []
    students = query("students", [("class_id", "==", ak.get("class_id", ""))])
    student_map = {s["id"]: s for s in students}

    for m in sorted(approved, key=lambda x: float(x.get("percentage", 0)), reverse=True):
        sid = m.get("student_id", "")
        stu = student_map.get(sid, {})
        pct = float(m.get("percentage", 0))
        students_out.append({
            "student_id": sid,
            "name": _student_name(stu) if stu else "Unknown",
            "score": m.get("score", 0),
            "max_score": m.get("max_score", 0),
            "percentage": round(pct, 1),
            "pass_fail": "pass" if pct >= 50 else "fail",
            "mark_id": m.get("id", ""),
        })

    return jsonify({
        "has_data": True,
        "homework_id": homework_id,
        "homework_title": ak.get("title") or ak.get("subject") or "Homework",
        "class_id": ak.get("class_id", ""),
        "class_name": cls.get("name", ""),
        "submission_count": len(approved),
        "average_score": average_score,
        "highest_score": highest_score,
        "lowest_score": lowest_score,
        "pass_rate": round(
            100 * len([s for s in students_out if s["pass_fail"] == "pass"]) / len(students_out), 1
        ) if students_out else 0,
        "students": students_out,
    }), 200


# ── GET /api/analytics/student-class/<class_id> ───────────────────────────────

@analytics_bp.get("/analytics/student-class/<class_id>")
def analytics_student_class(class_id: str):
    """
    Class analytics scoped to a student's view.
    Returns enabled=False immediately when share_analytics is off or student
    is not in this class. Otherwise returns averages, rank, trend, and
    per-assignment breakdown.
    """
    student_id, err = require_role(request, "student")
    if err:
        return jsonify({"error": err}), 401

    # Allow client to pass student_id explicitly (matches mobile api.ts usage)
    student_id_param = request.args.get("student_id", "").strip() or student_id

    student = get_doc("students", student_id_param)
    if not student or student.get("class_id") != class_id:
        return jsonify({"enabled": False}), 200

    cls = get_doc("classes", class_id)
    if not cls or not cls.get("share_analytics", False):
        return jsonify({"enabled": False}), 200

    share_rank = bool(cls.get("share_rank", False))

    all_marks = query("marks", [("class_id", "==", class_id)], order_by="timestamp")
    approved = [m for m in all_marks if m.get("approved") or m.get("status") in ("approved", "graded")]
    student_marks = [m for m in approved if m.get("student_id") == student_id_param]

    total_graded = len(student_marks)
    logger.info(
        "Analytics/student-class: student_id=%s class_id=%s marks=%d",
        student_id_param, class_id, total_graded,
    )

    if total_graded == 0:
        return jsonify({
            "enabled": True,
            "rank_enabled": share_rank,
            "total_assignments_graded": 0,
        }), 200

    # Per-student averages across all students for rank computation
    per_student: dict[str, list[float]] = defaultdict(list)
    for m in approved:
        sid = m.get("student_id", "")
        if sid:
            per_student[sid].append(float(m.get("percentage", 0)))

    student_scores = [float(m.get("percentage", 0)) for m in student_marks]
    student_avg = round(sum(student_scores) / len(student_scores), 1)

    all_student_avgs = [
        round(sum(v) / len(v), 1) for v in per_student.values() if v
    ]
    class_avg = round(sum(all_student_avgs) / len(all_student_avgs), 1) if all_student_avgs else 0.0

    # Rank (1-indexed, lower is better)
    sorted_avgs = sorted(all_student_avgs, reverse=True)
    try:
        student_rank = sorted_avgs.index(student_avg) + 1
    except ValueError:
        student_rank = None

    # Batch-fetch unique answer keys to avoid N+1 queries
    unique_sm_ak_ids = list({m.get("answer_key_id", "") for m in student_marks if m.get("answer_key_id")})
    sm_ak_map: dict[str, dict] = {}
    for ak_id in unique_sm_ak_ids:
        doc = get_doc("answer_keys", ak_id)
        if doc:
            sm_ak_map[ak_id] = doc

    # Per-assignment breakdown
    per_assignment = []
    for m in student_marks:
        ak_id = m.get("answer_key_id", "")
        ak = sm_ak_map.get(ak_id, {})
        title = ak.get("title") or ak.get("subject") or "Homework"
        # Class average for this specific assignment
        ak_marks = [
            float(a.get("percentage", 0)) for a in approved
            if a.get("answer_key_id") == ak_id
        ]
        ak_class_avg = round(sum(ak_marks) / len(ak_marks), 1) if ak_marks else 0.0
        per_assignment.append({
            "title": title,
            "student_score": round(float(m.get("percentage", 0)), 1),
            "class_average": ak_class_avg,
        })

    # Strengths and weaknesses from verdicts
    all_verdicts: list[dict] = []
    for m in student_marks:
        all_verdicts.extend(m.get("verdicts", []))

    weaknesses = list({
        v.get("question_text", "")[:50]
        for v in all_verdicts
        if v.get("verdict") == "incorrect" and v.get("question_text")
    })[:5]
    strengths = list({
        v.get("question_text", "")[:50]
        for v in all_verdicts
        if v.get("verdict") == "correct" and v.get("question_text")
    })[:5]

    result: dict = {
        "enabled": True,
        "rank_enabled": share_rank,
        "student_average": student_avg,
        "class_average": class_avg,
        "total_assignments_graded": total_graded,
        "total_students": len(per_student),
        "per_assignment": per_assignment,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "trend": [round(s, 1) for s in student_scores[-5:]],
    }
    if share_rank and student_rank is not None:
        result["student_rank"] = student_rank

    return jsonify(result), 200
