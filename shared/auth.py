"""JWT, OTP, and PIN utilities for the GCP project."""

from __future__ import annotations

import hashlib
import random
import string
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from flask import Request

from shared.config import settings


# ─── JWT ──────────────────────────────────────────────────────────────────────

def create_jwt(user_id: str, role: str, token_version: int) -> str:
    payload = {
        "sub": user_id,
        "role": role,
        "token_version": token_version,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.JWT_EXPIRE_DAYS),
    }
    return jwt.encode(payload, settings.APP_JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_jwt(token: str) -> Optional[dict]:
    try:
        return jwt.decode(
            token,
            settings.APP_JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )
    except jwt.PyJWTError:
        return None


def require_auth(request: Request) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Returns (user_id, role, error_message).
    error_message is None on success.
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, None, "missing Authorization header"
    token = auth_header[7:]
    payload = decode_jwt(token)
    if not payload:
        return None, None, "invalid or expired token"
    return payload.get("sub"), payload.get("role"), None


def require_role(request: Request, *roles: str) -> tuple[Optional[str], Optional[str]]:
    """
    Returns (user_id, error_message).
    Validates the JWT, checks role, and verifies token_version against Firestore
    to enforce session invalidation (logout-all / account recovery).
    """
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None, "missing Authorization header"
    token = auth_header[7:]
    payload = decode_jwt(token)
    if not payload:
        return None, "invalid or expired token"
    role = payload.get("role")
    user_id = payload.get("sub")
    if role not in roles:
        return None, "forbidden"
    # Validate token_version to enforce invalidation on account recovery / logout-all.
    # Deferred import avoids circular dependency (auth ← firestore_client ← models ← auth).
    from shared.firestore_client import get_doc  # noqa: PLC0415
    collection = "teachers" if role == "teacher" else "students"
    doc = get_doc(collection, user_id)
    if doc is not None and doc.get("token_version", 0) != payload.get("token_version", 0):
        return None, "token revoked"
    return user_id, None


# ─── OTP ──────────────────────────────────────────────────────────────────────

def generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


def hash_otp(otp: str) -> str:
    return hashlib.sha256(otp.encode()).hexdigest()


def verify_otp_hash(otp: str, stored_hash: str) -> bool:
    return hashlib.sha256(otp.encode()).hexdigest() == stored_hash


# ─── PIN ──────────────────────────────────────────────────────────────────────

def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(pin: str, pin_hash: str) -> bool:
    try:
        return bcrypt.checkpw(pin.encode(), pin_hash.encode())
    except Exception:
        return False
