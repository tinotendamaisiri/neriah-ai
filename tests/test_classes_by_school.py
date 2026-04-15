"""
Tests for GET /api/classes/by-school (query by school name).

Feature: student registration needs to list classes at a selected school.
The endpoint scans teachers by school_name then fetches their classes by
teacher_id (uses the existing composite index — no school_id index needed).
"""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from main import app


def _make_client():
    app.config["TESTING"] = True
    return app.test_client()


# ── Helpers ────────────────────────────────────────────────────────────────────

TEACHER_1 = {
    "id": "teacher-1",
    "first_name": "Tendai",
    "surname": "Maisiri",
    "school_name": "Chiredzi High School",
    "school_id": "zw-017",
    "phone": "+263771000001",
    "token_version": 0,
    "role": "teacher",
}
TEACHER_2 = {
    "id": "teacher-2",
    "first_name": "Chipo",
    "surname": "Dube",
    "school_name": "Harare High School",
    "school_id": "zw-003",
    "phone": "+263771000002",
    "token_version": 0,
    "role": "teacher",
}

CLASS_1 = {
    "id": "class-1",
    "name": "Form 2A",
    "education_level": "form_2",
    "subject": "Mathematics",
    "teacher_id": "teacher-1",
    "school_id": "zw-017",
    "created_at": "2026-04-01T10:00:00+00:00",
}
CLASS_2 = {
    "id": "class-2",
    "name": "Form 3B",
    "education_level": "form_3",
    "subject": "English",
    "teacher_id": "teacher-1",
    "school_id": "zw-017",
    "created_at": "2026-04-01T11:00:00+00:00",
}
CLASS_3 = {
    "id": "class-3",
    "name": "Form 1A",
    "education_level": "form_1",
    "subject": "Science",
    "teacher_id": "teacher-2",
    "school_id": "zw-003",
    "created_at": "2026-04-01T12:00:00+00:00",
}


def _query_side_effect(collection, filters=None, limit=None, order_by=None, direction="ASCENDING"):
    """Minimal query stub that returns test data based on collection + filter."""
    filters = filters or []

    if collection == "teachers":
        if not filters:
            # Full scan — return all teachers
            return [TEACHER_1, TEACHER_2]
        for field, op, value in filters:
            if field == "school_name" and op == "==":
                return [t for t in [TEACHER_1, TEACHER_2] if t.get("school_name") == value]
        return []

    if collection == "classes":
        for field, op, value in filters:
            if field == "teacher_id" and op == "==":
                return [c for c in [CLASS_1, CLASS_2, CLASS_3] if c.get("teacher_id") == value]
        return []

    return []


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestClassesBySchoolName:

    def test_classes_by_school_returns_classes(self):
        """GET /api/classes/by-school?school=Chiredzi High School returns both classes."""
        client = _make_client()
        with patch("shared.firestore_client.get_db"), \
             patch("functions.classes.query", side_effect=_query_side_effect):

            res = client.get("/api/classes/by-school?school=Chiredzi+High+School")

        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, list)
        assert len(data) == 2

        ids = {c["id"] for c in data}
        assert ids == {"class-1", "class-2"}

        # Every item has required fields
        for cls in data:
            assert "id" in cls
            assert "name" in cls
            assert "teacher" in cls
            assert "first_name" in cls["teacher"]
            assert "surname" in cls["teacher"]

        # Teacher name is attached
        assert data[0]["teacher"]["first_name"] == "Tendai"
        assert data[0]["teacher"]["surname"] == "Maisiri"

    def test_classes_by_school_case_insensitive(self):
        """Lowercase school name still finds the right classes via scan fallback."""
        client = _make_client()

        def _query_ci(collection, filters=None, limit=None, order_by=None, direction="ASCENDING"):
            filters = filters or []
            if collection == "teachers":
                if not filters:
                    # Full scan — return all teachers (used by case-insensitive fallback)
                    return [TEACHER_1, TEACHER_2]
                for field, op, value in filters:
                    if field == "school_name" and op == "==":
                        # Exact match returns nothing (lowercase vs mixed-case)
                        return []
                return []
            if collection == "classes":
                for field, op, value in filters:
                    if field == "teacher_id" and op == "==":
                        return [c for c in [CLASS_1, CLASS_2, CLASS_3] if c["teacher_id"] == value]
                return []
            return []

        with patch("shared.firestore_client.get_db"), \
             patch("functions.classes.query", side_effect=_query_ci):

            res = client.get("/api/classes/by-school?school=chiredzi+high+school")

        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, list)
        # Both classes for teacher-1 returned via case-insensitive fallback
        assert len(data) == 2

    def test_classes_by_school_returns_empty_for_unknown_school(self):
        """Unknown school name returns 200 with an empty list, not 404."""
        client = _make_client()

        def _query_empty(collection, filters=None, limit=None, order_by=None, direction="ASCENDING"):
            filters = filters or []
            if collection == "teachers":
                return [TEACHER_1, TEACHER_2]  # scan returns teachers
            return []  # no classes match

        with patch("shared.firestore_client.get_db"), \
             patch("functions.classes.query", side_effect=_query_empty):

            res = client.get("/api/classes/by-school?school=Nonexistent+Academy")

        assert res.status_code == 200
        data = res.get_json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_classes_by_school_missing_param_returns_400(self):
        """Missing school param returns 400 with an error field."""
        client = _make_client()
        with patch("shared.firestore_client.get_db"), \
             patch("functions.classes.query", return_value=[]):
            res = client.get("/api/classes/by-school")

        assert res.status_code == 400
        data = res.get_json()
        assert "error" in data
