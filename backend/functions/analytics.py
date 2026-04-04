# functions/analytics.py
# Analytics endpoints:
#   GET /api/analytics/classes                   — teacher JWT, all classes summary
#   GET /api/analytics/class/{class_id}          — teacher JWT, class-level stats
#   GET /api/analytics/student/{student_id}      — teacher JWT, per-student breakdown
#   GET /api/analytics/teacher/{teacher_id}      — teacher JWT, cross-class summary
#   GET /api/analytics/student-class/{class_id}  — student JWT, anonymised class view
#
# Legacy route kept for backwards compat:
#   GET /api/analytics?class_id=...&student_id=...

from __future__ import annotations

import json
import logging
import statistics
from datetime import datetime, timedelta, timezone
from typing import Optional

import azure.functions as func

from shared.auth import require_role
from shared.cosmos_client import query_items

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ok(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(json.dumps(body), status_code=status, mimetype="application/json")


def _err(msg: str, status: int = 400) -> func.HttpResponse:
    return func.HttpResponse(json.dumps({"error": msg}), status_code=status, mimetype="application/json")


def _pct(mark: dict) -> float:
    ms = mark.get("max_score") or 0
    return (mark.get("score", 0) / ms * 100) if ms else 0.0


def _bucket(pct: float) -> str:
    if pct <= 20:  return "0-20"
    if pct <= 40:  return "21-40"
    if pct <= 60:  return "41-60"
    if pct <= 80:  return "61-80"
    return "81-100"


def _period_cutoff(period: Optional[str]) -> Optional[str]:
    """Return ISO cutoff string for the given period, or None for 'all'."""
    now = datetime.now(timezone.utc)
    if period == "week":  return (now - timedelta(days=7)).isoformat()
    if period == "month": return (now - timedelta(days=30)).isoformat()
    if period == "term":  return (now - timedelta(days=90)).isoformat()
    return None


def _distribution(pcts: list[float]) -> dict:
    dist = {"0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0}
    for p in pcts:
        dist[_bucket(p)] += 1
    return dist


def _trend(marks: list[dict]) -> list[dict]:
    """Group marks by date, return average per day, max 30 points."""
    by_date: dict[str, list[float]] = {}
    for m in marks:
        day = (m.get("timestamp") or "")[:10] or "unknown"
        by_date.setdefault(day, []).append(_pct(m))
    return [
        {"date": d, "average": round(statistics.mean(v), 1), "count": len(v)}
        for d, v in sorted(by_date.items())
    ][-30:]


def _strengths_weaknesses(marks: list[dict]) -> tuple[list[str], list[str]]:
    """
    Analyse verdict feedback labels across marks.
    Requires at least 2 data points per topic. Returns (strengths, weaknesses).
    """
    topic_scores: dict[str, list[float]] = {}
    for m in marks:
        for v in (m.get("verdicts") or []):
            topic = (v.get("feedback") or "").strip()
            if not topic:
                continue
            mx = v.get("max_marks") or 1
            topic_scores.setdefault(topic, []).append((v.get("awarded_marks") or 0) / mx * 100)

    strengths, weaknesses = [], []
    for topic, scores in topic_scores.items():
        if len(scores) < 2:
            continue
        avg = statistics.mean(scores)
        if avg >= 75:
            strengths.append(topic)
        elif avg < 40:
            weaknesses.append(topic)
    return strengths[:3], weaknesses[:3]


def _calc_trend_direction(marks: list[dict]) -> str:
    """Compare last 5 vs prev 5 marks by timestamp. Returns 'up'/'down'/'stable'."""
    sorted_marks = sorted(marks, key=lambda m: m.get("timestamp") or "")
    if len(sorted_marks) < 2:
        return "stable"
    last5 = sorted_marks[-5:]
    prev5 = sorted_marks[-10:-5]
    if not prev5:
        return "stable"
    last_avg = statistics.mean([_pct(m) for m in last5])
    prev_avg = statistics.mean([_pct(m) for m in prev5])
    diff = last_avg - prev_avg
    if diff > 2:
        return "up"
    if diff < -2:
        return "down"
    return "stable"


async def _fetch_ak_titles(ak_ids: list[str]) -> dict[str, dict]:
    """Fetch answer key titles in a batch (one query per id). Returns id -> doc map."""
    ak_map: dict[str, dict] = {}
    for ak_id in ak_ids:
        docs = await query_items(
            "answer_keys",
            "SELECT c.id, c.title, c.subject FROM c WHERE c.id = @id",
            [{"name": "@id", "value": ak_id}],
        )
        if docs:
            ak_map[ak_id] = docs[0]
    return ak_map


# ── All-classes analytics ─────────────────────────────────────────────────────

async def handle_classes_analytics(req: func.HttpRequest) -> func.HttpResponse:
    """GET /api/analytics/classes"""
    try:
        user = require_role(req, "teacher")
    except ValueError as e:
        return _err(str(e), 401)

    teacher_id = user["id"]

    classes = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.teacher_id = @tid",
        [{"name": "@tid", "value": teacher_id}],
        partition_key=teacher_id,
    )

    result = []
    for cls in classes:
        cid = cls["id"]
        total_students = len(cls.get("student_ids") or [])

        marks = await query_items(
            "marks",
            "SELECT c.score, c.max_score, c.timestamp, c.student_id "
            "FROM c WHERE c.class_id = @cid AND c.approved = true",
            [{"name": "@cid", "value": cid}],
        )

        total_submissions = len(marks)
        pcts = [_pct(m) for m in marks]
        average_score = round(statistics.mean(pcts), 1) if pcts else 0.0
        recent_trend = _calc_trend_direction(marks)

        timestamps = [m.get("timestamp") for m in marks if m.get("timestamp")]
        last_activity = max(timestamps) if timestamps else None

        result.append({
            "class_id": cid,
            "class_name": cls.get("name", ""),
            "education_level": cls.get("education_level", ""),
            "subject": cls.get("subject"),
            "total_students": total_students,
            "total_submissions": total_submissions,
            "average_score": average_score,
            "recent_trend": recent_trend,
            "last_activity": last_activity,
        })

    # Sort by last_activity descending, None last
    result.sort(key=lambda x: x["last_activity"] or "", reverse=True)

    return _ok(result)


# ── Class analytics ───────────────────────────────────────────────────────────

async def handle_class_analytics(
    req: func.HttpRequest, class_id: str
) -> func.HttpResponse:
    """GET /api/analytics/class/{class_id}"""
    try:
        user = require_role(req, "teacher")
    except ValueError as e:
        return _err(str(e), 401)

    class_docs = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.id = @id AND c.teacher_id = @tid",
        [{"name": "@id", "value": class_id}, {"name": "@tid", "value": user["id"]}],
    )
    if not class_docs:
        return _err("Class not found", 404)
    cls = class_docs[0]

    period = req.params.get("period")
    cutoff = _period_cutoff(period)

    students = await query_items(
        "students",
        "SELECT c.id, c.first_name, c.surname, c.register_number FROM c WHERE c.class_id = @cid",
        [{"name": "@cid", "value": class_id}],
        partition_key=class_id,
    )
    student_map = {s["id"]: s for s in students}

    marks = await query_items(
        "marks",
        "SELECT * FROM c WHERE c.class_id = @cid AND c.approved = true",
        [{"name": "@cid", "value": class_id}],
    )
    if cutoff:
        marks = [m for m in marks if (m.get("timestamp") or "") >= cutoff]

    empty_dist = {"0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0}
    total_students = len(students)

    if not marks:
        return _ok({
            "class_id": class_id,
            "class_name": cls.get("name", ""),
            "total_students": total_students,
            "total_marks_recorded": 0,
            "average_score": 0.0,
            "median_score": 0.0,
            "highest_score": 0.0,
            "lowest_score": 0.0,
            "score_distribution": empty_dist,
            "trend": [],
            "top_students": [],
            "struggling_students": [],
            "summary": {
                "average_score": 0.0,
                "total_submissions": 0,
                "completion_rate": 0.0,
                "improvement_pct": None,
            },
            "performance_over_time": [],
            "students": [],
            "improvement_pct": None,
        })

    pcts = [_pct(m) for m in marks]

    # ── Fetch answer key titles (batch) ───────────────────────────────────────
    ak_ids = list({m["answer_key_id"] for m in marks if m.get("answer_key_id")})
    ak_map = await _fetch_ak_titles(ak_ids)

    # ── Performance over time (grouped by answer_key_id) ─────────────────────
    ak_groups: dict[str, list[dict]] = {}
    for m in marks:
        ak_id = m.get("answer_key_id", "")
        ak_groups.setdefault(ak_id, []).append(m)

    # Sort each group by timestamp, compute earliest timestamp per group
    pot_entries = []
    for ak_id, ak_marks in ak_groups.items():
        sorted_ak = sorted(ak_marks, key=lambda m: m.get("timestamp") or "")
        earliest = (sorted_ak[0].get("timestamp") or "")[:10]
        ak = ak_map.get(ak_id, {})
        hw_title = ak.get("title") or ak.get("subject") or ak_id
        ak_pcts = [_pct(m) for m in ak_marks]
        avg = round(statistics.mean(ak_pcts), 1) if ak_pcts else 0.0
        pot_entries.append({
            "homework_title": hw_title,
            "date": earliest,
            "average_score": avg,
        })

    performance_over_time = sorted(pot_entries, key=lambda x: x["date"])

    # ── Improvement pct ───────────────────────────────────────────────────────
    improvement_pct: Optional[float] = None
    if len(performance_over_time) >= 10:
        scores = [e["average_score"] for e in performance_over_time]
        last5 = scores[-5:]
        prev5 = scores[-10:-5]
        last_mean = statistics.mean(last5)
        prev_mean = statistics.mean(prev5)
        improvement_pct = round(last_mean - prev_mean, 1)

    # ── Per-student stats ─────────────────────────────────────────────────────
    per_student_marks: dict[str, list[dict]] = {}
    for m in marks:
        per_student_marks.setdefault(m["student_id"], []).append(m)

    students_list = []
    for s in students:
        sid = s["id"]
        s_marks = per_student_marks.get(sid, [])
        s_pcts = [_pct(m) for m in s_marks]
        s_avg = round(statistics.mean(s_pcts), 1) if s_pcts else 0.0
        s_trend = _calc_trend_direction(s_marks) if len(s_marks) >= 2 else "stable"
        students_list.append({
            "id": sid,
            "name": f"{s.get('first_name', '')} {s.get('surname', '')}".strip(),
            "register_number": s.get("register_number"),
            "average_score": s_avg,
            "submissions_count": len(s_marks),
            "trend": s_trend,
        })

    students_list.sort(key=lambda x: x["average_score"], reverse=True)

    # Completion rate: students with >= 1 approved mark / total students
    students_with_marks = len([s for s in students_list if s["submissions_count"] > 0])
    completion_rate = round((students_with_marks / total_students * 100), 1) if total_students else 0.0

    avg_score = round(statistics.mean(pcts), 1)

    # Legacy top/struggling lists
    student_avgs = sorted(
        [(sid, statistics.mean([_pct(m) for m in smarks])) for sid, smarks in per_student_marks.items()],
        key=lambda x: x[1],
        reverse=True,
    )

    def _entry(sid: str, avg: float) -> dict:
        s = student_map.get(sid, {})
        return {
            "student_id": sid,
            "first_name": s.get("first_name", ""),
            "surname": s.get("surname", ""),
            "average": round(avg, 1),
        }

    return _ok({
        # Legacy fields (backwards compat)
        "class_id": class_id,
        "class_name": cls.get("name", ""),
        "total_students": total_students,
        "total_marks_recorded": len(marks),
        "average_score": avg_score,
        "median_score": round(statistics.median(pcts), 1),
        "highest_score": round(max(pcts), 1),
        "lowest_score": round(min(pcts), 1),
        "score_distribution": _distribution(pcts),
        "trend": _trend(marks),
        "top_students": [_entry(sid, avg) for sid, avg in student_avgs[:5]],
        "struggling_students": [
            _entry(sid, avg) for sid, avg in student_avgs[-5:] if avg < 50
        ],
        # New fields
        "summary": {
            "average_score": avg_score,
            "total_submissions": len(marks),
            "completion_rate": completion_rate,
            "improvement_pct": improvement_pct,
        },
        "performance_over_time": performance_over_time,
        "improvement_pct": improvement_pct,
        "students": students_list,
    })


# ── Student analytics ─────────────────────────────────────────────────────────

async def handle_student_analytics(
    req: func.HttpRequest, student_id: str
) -> func.HttpResponse:
    """GET /api/analytics/student/{student_id}"""
    try:
        user = require_role(req, "teacher")
    except ValueError as e:
        return _err(str(e), 401)

    student_results = await query_items(
        "students",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": student_id}],
    )
    if not student_results:
        return _err("Student not found", 404)
    student = student_results[0]

    marks = await query_items(
        "marks",
        "SELECT * FROM c WHERE c.student_id = @sid ORDER BY c.timestamp ASC",
        [{"name": "@sid", "value": student_id}],
        partition_key=student_id,
    )
    approved = [m for m in marks if m.get("approved", False)]

    if not approved:
        return _ok({
            "student": {
                "id": student_id,
                "name": f"{student.get('first_name', '')} {student.get('surname', '')}".strip(),
                "register_number": student.get("register_number"),
                "average_score": 0.0,
                "total_submissions": 0,
                "first_submission_date": None,
            },
            "performance_over_time": [],
            "strengths": [],
            "weaknesses": [],
            "submissions": [],
        })

    # ── Fetch answer key titles (batch at the start) ───────────────────────────
    ak_ids = list({m["answer_key_id"] for m in approved if m.get("answer_key_id")})
    ak_map = await _fetch_ak_titles(ak_ids)

    pcts = [_pct(m) for m in approved]
    overall_avg = statistics.mean(pcts) if pcts else 0.0

    # ── Optional class_id for comparison ─────────────────────────────────────
    class_id = req.params.get("class_id")
    class_marks_by_ak: dict[str, list[float]] = {}
    if class_id:
        class_marks_all = await query_items(
            "marks",
            "SELECT c.score, c.max_score, c.answer_key_id "
            "FROM c WHERE c.class_id = @cid AND c.approved = true",
            [{"name": "@cid", "value": class_id}],
        )
        for cm in class_marks_all:
            ak_id = cm.get("answer_key_id", "")
            class_marks_by_ak.setdefault(ak_id, []).append(_pct(cm))

    # ── Performance over time (grouped by answer_key_id) ─────────────────────
    ak_groups: dict[str, list[dict]] = {}
    for m in approved:
        ak_groups.setdefault(m.get("answer_key_id", ""), []).append(m)

    pot_entries = []
    for ak_id, ak_marks in ak_groups.items():
        sorted_ak = sorted(ak_marks, key=lambda m: m.get("timestamp") or "")
        date = (sorted_ak[0].get("timestamp") or "")[:10]
        ak = ak_map.get(ak_id, {})
        hw_title = ak.get("title") or ak.get("subject") or ak_id
        ak_pcts = [_pct(m) for m in ak_marks]
        score_pct = round(statistics.mean(ak_pcts), 1)

        class_avg_pcts = class_marks_by_ak.get(ak_id, [])
        class_avg = round(statistics.mean(class_avg_pcts), 1) if class_avg_pcts else 0.0

        pot_entries.append({
            "homework_title": hw_title,
            "date": date,
            "score_pct": score_pct,
            "class_average": class_avg,
        })

    performance_over_time = sorted(pot_entries, key=lambda x: x["date"])

    # ── Strengths and weaknesses ──────────────────────────────────────────────
    strengths = []
    weaknesses = []
    for entry in performance_over_time:
        score = entry["score_pct"]
        ca = entry["class_average"]
        if ca > 0:
            if score > ca + 5:
                strengths.append({
                    "homework_title": entry["homework_title"],
                    "score": score,
                    "class_average": ca,
                })
            elif score < ca - 5:
                weaknesses.append({
                    "homework_title": entry["homework_title"],
                    "score": score,
                    "class_average": ca,
                })
        else:
            if score > overall_avg + 5:
                strengths.append({
                    "homework_title": entry["homework_title"],
                    "score": score,
                    "class_average": ca,
                })
            elif score < overall_avg - 5:
                weaknesses.append({
                    "homework_title": entry["homework_title"],
                    "score": score,
                    "class_average": ca,
                })

    # ── Submissions list (approved, newest first) ─────────────────────────────
    sorted_approved = sorted(approved, key=lambda m: m.get("timestamp") or "", reverse=True)
    submissions_list = []
    for m in sorted_approved:
        ak = ak_map.get(m.get("answer_key_id", ""), {})
        hw_title = ak.get("title") or ak.get("subject") or ""
        feedback = m.get("feedback") or ""
        submissions_list.append({
            "id": m["id"],
            "homework_title": hw_title,
            "date": (m.get("timestamp") or "")[:10],
            "score": m.get("score", 0),
            "max_score": m.get("max_score", 0),
            "feedback_preview": feedback[:80] if feedback else None,
        })

    first_sub_date = (approved[0].get("timestamp") or "")[:10] if approved else None

    return _ok({
        "student": {
            "id": student_id,
            "name": f"{student.get('first_name', '')} {student.get('surname', '')}".strip(),
            "register_number": student.get("register_number"),
            "average_score": round(overall_avg, 1),
            "total_submissions": len(approved),
            "first_submission_date": first_sub_date,
        },
        "performance_over_time": performance_over_time,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "submissions": submissions_list,
    })


# ── Teacher analytics ─────────────────────────────────────────────────────────

async def handle_teacher_analytics(
    req: func.HttpRequest, teacher_id: str
) -> func.HttpResponse:
    """GET /api/analytics/teacher/{teacher_id}"""
    try:
        user = require_role(req, "teacher")
    except ValueError as e:
        return _err(str(e), 401)
    if user["id"] != teacher_id:
        return _err("Forbidden", 403)

    classes = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.teacher_id = @tid",
        [{"name": "@tid", "value": teacher_id}],
        partition_key=teacher_id,
    )

    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    classes_summary = []
    total_students = 0
    total_marks = 0
    marks_this_week = 0
    all_pcts: list[float] = []

    for cls in classes:
        cid = cls["id"]
        student_count_result = await query_items(
            "students",
            "SELECT VALUE COUNT(1) FROM c WHERE c.class_id = @cid",
            [{"name": "@cid", "value": cid}],
            partition_key=cid,
        )
        student_count = student_count_result[0] if student_count_result else 0

        cls_marks = await query_items(
            "marks",
            "SELECT c.score, c.max_score, c.timestamp FROM c WHERE c.class_id = @cid",
            [{"name": "@cid", "value": cid}],
        )
        cls_pcts = [_pct(m) for m in cls_marks]
        week_count = sum(1 for m in cls_marks if (m.get("timestamp") or "") >= week_ago)

        total_students += student_count
        total_marks += len(cls_marks)
        marks_this_week += week_count
        all_pcts.extend(cls_pcts)

        classes_summary.append({
            "class_id": cid,
            "name": cls.get("name", ""),
            "student_count": student_count,
            "marks_count": len(cls_marks),
            "average_score": round(statistics.mean(cls_pcts), 1) if cls_pcts else 0.0,
        })

    return _ok({
        "teacher_id": teacher_id,
        "total_classes": len(classes),
        "total_students": total_students,
        "total_marks_recorded": total_marks,
        "marks_this_week": marks_this_week,
        "average_score_all_classes": round(statistics.mean(all_pcts), 1) if all_pcts else 0.0,
        "classes_summary": sorted(classes_summary, key=lambda x: x["marks_count"], reverse=True),
    })


# ── Student-facing class analytics ───────────────────────────────────────────

async def handle_student_class_analytics(
    req: func.HttpRequest, class_id: str
) -> func.HttpResponse:
    """GET /api/analytics/student-class/{class_id} — student JWT, anonymised."""
    try:
        user = require_role(req, "student")
    except ValueError as e:
        return _err(str(e), 401)

    student_id = req.params.get("student_id") or user.get("id", "")
    if student_id != user["id"]:
        return _err("Forbidden", 403)

    class_docs = await query_items(
        "classes",
        "SELECT * FROM c WHERE c.id = @id",
        [{"name": "@id", "value": class_id}],
    )
    if not class_docs:
        return _err("Class not found", 404)
    cls = class_docs[0]

    if not cls.get("share_analytics", False):
        return _ok({"enabled": False})

    rank_enabled: bool = cls.get("share_rank", False)

    # All approved marks for this class (cross-partition)
    all_marks = await query_items(
        "marks",
        "SELECT c.student_id, c.score, c.max_score, c.timestamp, c.answer_key_id "
        "FROM c WHERE c.class_id = @cid AND c.approved = true",
        [{"name": "@cid", "value": class_id}],
    )

    # Student's own marks (partition key query — fast)
    my_marks_all = await query_items(
        "marks",
        "SELECT * FROM c WHERE c.student_id = @sid AND c.approved = true ORDER BY c.timestamp ASC",
        [{"name": "@sid", "value": student_id}],
        partition_key=student_id,
    )
    my_marks = [m for m in my_marks_all if m.get("class_id") == class_id]

    class_pcts = [_pct(m) for m in all_marks]
    my_pcts = [_pct(m) for m in my_marks]

    class_avg = round(statistics.mean(class_pcts), 1) if class_pcts else 0.0
    student_avg = round(statistics.mean(my_pcts), 1) if my_pcts else 0.0

    dist = _distribution(class_pcts)
    bucket_keys = list(dist.keys())
    my_bucket_idx = bucket_keys.index(_bucket(student_avg)) if my_pcts else None

    # Per-assignment comparison (no other student names in response)
    ak_ids = list({m["answer_key_id"] for m in all_marks})
    ak_map = await _fetch_ak_titles(ak_ids)

    class_ak_pcts: dict[str, list[float]] = {}
    for m in all_marks:
        class_ak_pcts.setdefault(m["answer_key_id"], []).append(_pct(m))

    my_ak_pcts: dict[str, float] = {}
    for m in my_marks:
        my_ak_pcts[m["answer_key_id"]] = _pct(m)

    per_assignment = []
    for ak_id, cpcts in class_ak_pcts.items():
        ak = ak_map.get(ak_id, {})
        entry: dict = {
            "title": ak.get("title") or ak.get("subject", ak_id),
            "class_average": round(statistics.mean(cpcts), 1),
        }
        if ak_id in my_ak_pcts:
            entry["student_score"] = round(my_ak_pcts[ak_id], 1)
        per_assignment.append(entry)

    result: dict = {
        "enabled": True,
        "rank_enabled": rank_enabled,
        "student_average": student_avg,
        "class_average": class_avg,
        "total_assignments_graded": len(set(m["answer_key_id"] for m in my_marks)),
        "score_distribution": list(dist.values()),
        "trend": [round(p, 1) for p in my_pcts],
        "per_assignment": per_assignment,
    }
    if my_bucket_idx is not None:
        result["student_bucket"] = my_bucket_idx

    if rank_enabled and my_pcts:
        per_student_avg = {}
        for m in all_marks:
            per_student_avg.setdefault(m["student_id"], []).append(_pct(m))
        avgs_sorted = sorted(
            [statistics.mean(ps) for ps in per_student_avg.values()],
            reverse=True,
        )
        rank = next(
            (i + 1 for i, a in enumerate(avgs_sorted) if a <= student_avg),
            len(avgs_sorted),
        )
        result["student_rank"] = rank
        result["total_students"] = len(avgs_sorted)

    strengths, weaknesses = _strengths_weaknesses(my_marks)
    if strengths:
        result["strengths"] = strengths
    if weaknesses:
        result["weaknesses"] = weaknesses

    return _ok(result)


# ── Legacy handler ────────────────────────────────────────────────────────────

async def handle_analytics(req: func.HttpRequest) -> func.HttpResponse:
    """Legacy: GET /api/analytics?class_id=...&student_id=..."""
    class_id = req.params.get("class_id")
    student_id = req.params.get("student_id")
    if class_id:
        return await handle_class_analytics(req, class_id)
    if student_id:
        return await handle_student_analytics(req, student_id)
    return _err("Provide class_id or student_id query param")
