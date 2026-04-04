# functions/schools.py
# Schools reference table.
#
# GET /api/schools — public, no auth required.
#   Returns all schools. Seeds the container on first call if empty.

from __future__ import annotations

import json
import logging
from uuid import uuid4

import azure.functions as func

from shared.cosmos_client import query_items, upsert_item

logger = logging.getLogger(__name__)

# ── Seed data ─────────────────────────────────────────────────────────────────

_SEED_SCHOOLS = [
    {"name": "Harare Central Primary",          "city": "Harare",   "province": "Harare",             "type": "primary"},
    {"name": "Mabelreign Girls High",            "city": "Harare",   "province": "Harare",             "type": "secondary"},
    {"name": "Prince Edward School",             "city": "Harare",   "province": "Harare",             "type": "secondary"},
    {"name": "Budiriro Primary School",          "city": "Harare",   "province": "Harare",             "type": "primary"},
    {"name": "Highfield Secondary School",       "city": "Harare",   "province": "Harare",             "type": "secondary"},
    {"name": "Bulawayo Central Primary",         "city": "Bulawayo", "province": "Bulawayo",           "type": "primary"},
    {"name": "Milton High School",               "city": "Bulawayo", "province": "Bulawayo",           "type": "secondary"},
    {"name": "Mutare Boys High",                 "city": "Mutare",   "province": "Manicaland",         "type": "secondary"},
    {"name": "Gweru Teachers College",           "city": "Gweru",    "province": "Midlands",           "type": "tertiary"},
    {"name": "Masvingo Polytechnic",             "city": "Masvingo", "province": "Masvingo",           "type": "tertiary"},
    {"name": "Great Zimbabwe University",        "city": "Masvingo", "province": "Masvingo",           "type": "tertiary"},
    {"name": "Chinhoyi University of Technology","city": "Chinhoyi", "province": "Mashonaland West",   "type": "tertiary"},
]


async def _seed() -> list[dict]:
    """Insert all seed schools into the container. Returns the inserted docs."""
    docs = []
    for s in _SEED_SCHOOLS:
        doc = {"id": str(uuid4()), **s}
        await upsert_item("schools", doc)
        docs.append(doc)
    logger.info("schools: seeded %d schools", len(docs))
    return docs


# ── GET /api/schools ──────────────────────────────────────────────────────────

def _ok(body: dict, status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(body, default=str), status_code=status, mimetype="application/json"
    )


async def handle_schools(req: func.HttpRequest) -> func.HttpResponse:
    """Return all schools. Seeds the container on first call if it is empty."""
    schools = await query_items("schools", "SELECT * FROM c", [])
    if not schools:
        logger.info("schools: container empty — seeding now")
        schools = await _seed()
    # Sort by province, then city, then name for consistent ordering
    schools.sort(key=lambda s: (s.get("province", ""), s.get("city", ""), s.get("name", "")))
    return _ok({"schools": schools})
