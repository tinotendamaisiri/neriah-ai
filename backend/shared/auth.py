# shared/auth.py
# JWT creation/validation and OTP utilities for the Neriah auth system.
#
# Usage:
#   from shared.auth import create_jwt, require_auth, require_role
#   from shared.auth import generate_otp, hash_otp, verify_otp_hash
#
# Token lifetime: 365 days (persistent session — OTP only fires on new device / recovery).
# Algorithm:      HS256.
# OTP:            6-digit numeric, SHA-256 hashed before storage.

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from shared.config import get_settings


# ── OTP ───────────────────────────────────────────────────────────────────────

def generate_otp() -> str:
    """Generate a cryptographically random 6-digit numeric OTP code."""
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_otp(otp: str) -> str:
    """Return the SHA-256 hex digest of the OTP. Never store the raw code."""
    return hashlib.sha256(otp.encode()).hexdigest()


def verify_otp_hash(provided_otp: str, stored_hash: str) -> bool:
    """Return True if provided_otp hashes to stored_hash."""
    return hash_otp(provided_otp) == stored_hash


# ── JWT ───────────────────────────────────────────────────────────────────────

def create_jwt(user_id: str, phone: str, role: str, extra_claims: dict | None = None) -> str:
    """Create a signed JWT token.

    Payload:  { id, phone, role, iat, exp } + any extra_claims.
    Expires:  365 days from now (UTC). Persistent session — OTP only on new device/recovery.
    Algorithm: HS256.

    Args:
        user_id:      Cosmos document id of the teacher or student.
        phone:        E.164 phone number.
        role:         "teacher" or "student".
        extra_claims: Optional dict merged into the payload (e.g. {"school": "..."} for teachers,
                      {"class_id": "..."} for students).

    Returns:
        Signed JWT string.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict = {
        "id": user_id,
        "phone": phone,
        "role": role,
        "iat": now,
        "exp": now + timedelta(days=365),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, settings.app_jwt_secret, algorithm="HS256")


def decode_jwt(token: str) -> dict:
    """Decode and validate a JWT token.

    Raises:
        jwt.ExpiredSignatureError:  if the token has expired.
        jwt.InvalidTokenError:      if the token is malformed or the signature is wrong.

    Returns:
        Decoded payload dict.
    """
    settings = get_settings()
    return jwt.decode(token, settings.app_jwt_secret, algorithms=["HS256"])


def get_user_from_request(req) -> dict | None:
    """Extract and validate the JWT from the Authorization header.

    Header format: ``Authorization: Bearer <token>``

    Returns:
        Decoded JWT payload dict, or None if the header is missing or the token is invalid.
    """
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None
    token = auth_header[7:]
    try:
        return decode_jwt(token)
    except Exception:
        return None


def require_auth(req) -> dict:
    """Require a valid JWT. Raises ValueError if missing or invalid.

    Use in endpoints that must be authenticated.

    Returns:
        Decoded JWT payload dict.

    Raises:
        ValueError: "Authentication required"
    """
    user = get_user_from_request(req)
    if user is None:
        raise ValueError("Authentication required")
    return user


def require_role(req, role: str) -> dict:
    """Require a valid JWT with a specific role. Raises ValueError otherwise.

    Args:
        req:   Azure Functions HttpRequest.
        role:  Expected role string, e.g. "teacher" or "student".

    Returns:
        Decoded JWT payload dict.

    Raises:
        ValueError: "Authentication required" or "Role '<role>' required"
    """
    user = require_auth(req)
    if user.get("role") != role:
        raise ValueError(f"Role '{role}' required")
    return user
