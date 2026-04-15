"""GET /api/schools — returns list of schools for registration picker.

Falls back to a hardcoded seed list of Zimbabwean schools when the
Firestore 'schools' collection is empty or unavailable.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify

from shared.firestore_client import query

logger = logging.getLogger(__name__)
schools_bp = Blueprint("schools", __name__)

# ─── Seed data — 20 real Zimbabwean schools ───────────────────────────────────

_SEED_SCHOOLS = [
    # Harare — secondary
    {"id": "zw-001", "name": "Prince Edward School",           "city": "Harare",    "province": "Harare",             "type": "secondary"},
    {"id": "zw-002", "name": "St George's College",            "city": "Harare",    "province": "Harare",             "type": "secondary"},
    {"id": "zw-003", "name": "Harare High School",             "city": "Harare",    "province": "Harare",             "type": "secondary"},
    {"id": "zw-004", "name": "Girls High School",              "city": "Harare",    "province": "Harare",             "type": "secondary"},
    {"id": "zw-005", "name": "Highlands Junior School",        "city": "Harare",    "province": "Harare",             "type": "primary"},
    {"id": "zw-006", "name": "Borrowdale Primary School",      "city": "Harare",    "province": "Harare",             "type": "primary"},
    {"id": "zw-007", "name": "Marlborough High School",        "city": "Harare",    "province": "Harare",             "type": "secondary"},
    {"id": "zw-008", "name": "Kuwadzana Primary School",       "city": "Harare",    "province": "Harare",             "type": "primary"},
    # Bulawayo — primary & secondary
    {"id": "zw-009", "name": "Christian Brothers College",     "city": "Bulawayo",  "province": "Bulawayo",           "type": "secondary"},
    {"id": "zw-010", "name": "Eveline High School",            "city": "Bulawayo",  "province": "Bulawayo",           "type": "secondary"},
    {"id": "zw-011", "name": "Mzilikazi Primary School",       "city": "Bulawayo",  "province": "Bulawayo",           "type": "primary"},
    {"id": "zw-012", "name": "Plumtree High School",           "city": "Bulawayo",  "province": "Bulawayo",           "type": "secondary"},
    {"id": "zw-013", "name": "Townsend Primary School",        "city": "Bulawayo",  "province": "Bulawayo",           "type": "primary"},
    # Rural / provincial
    {"id": "zw-014", "name": "Goromonzi High School",          "city": "Goromonzi", "province": "Mashonaland East",   "type": "secondary"},
    {"id": "zw-015", "name": "Mutare Boys High School",        "city": "Mutare",    "province": "Manicaland",         "type": "secondary"},
    {"id": "zw-016", "name": "Marist Brothers Nyanga",         "city": "Nyanga",    "province": "Manicaland",         "type": "secondary"},
    {"id": "zw-017", "name": "Chiredzi High School",           "city": "Chiredzi",  "province": "Masvingo",           "type": "secondary"},
    {"id": "zw-018", "name": "Chinhoyi Primary School",        "city": "Chinhoyi",  "province": "Mashonaland West",   "type": "primary"},
    {"id": "zw-019", "name": "Gweru Technical College",        "city": "Gweru",     "province": "Midlands",           "type": "college"},
    {"id": "zw-020", "name": "Harare Polytechnic",             "city": "Harare",    "province": "Harare",             "type": "college"},
]


# ─── Endpoint ─────────────────────────────────────────────────────────────────

@schools_bp.get("/schools")
def list_schools():
    try:
        results = query("schools", [], limit=200, order_by="name")
    except Exception:
        logger.warning("Firestore schools query failed — using seed data")
        results = []

    if not results:
        return jsonify(_SEED_SCHOOLS), 200

    return jsonify(results), 200


@schools_bp.get("/schools/search")
def search_schools():
    """
    Search schools by partial name match. Returns unique school names.

    GET /api/schools/search?q=chiredzi → ["Chiredzi High School"]
    """
    from flask import request

    q = (request.args.get("q") or "").strip().lower()
    if len(q) < 2:
        return jsonify({"schools": []}), 200

    # Merge: seed list + Firestore teachers' school_name + Firestore schools collection
    names: set[str] = set()

    # Seed schools
    for s in _SEED_SCHOOLS:
        name = s.get("name", "")
        if q in name.lower():
            names.add(name)

    # Teacher-registered schools (covers schools not in seed list)
    try:
        teachers = query("teachers", [])
        for t in teachers:
            sn = t.get("school_name") or ""
            if sn and q in sn.lower():
                names.add(sn)
    except Exception:
        pass

    schools = sorted(names)[:10]
    logger.debug("[schools] search q=%r → %d results", q, len(schools))
    return jsonify({"schools": schools}), 200
