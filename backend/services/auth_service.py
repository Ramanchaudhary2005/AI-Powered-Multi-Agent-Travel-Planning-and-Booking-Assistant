"""Google identity verification and application JWT helpers."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token

from backend.config import GOOGLE_CLIENT_ID, JWT_SECRET
from backend.db.sqlite import get_connection


def user_dict(row: Any) -> dict[str, Any]:
    return dict(row)


def profile_completion(user: dict[str, Any]) -> int:
    fields = ("first_middle_name", "last_name", "gender", "dob", "nationality",
              "marital_status", "city", "state", "mobile_number")
    return round(sum(bool(user.get(field)) for field in fields) * 100 / len(fields))


def authenticate_google(credential: str) -> tuple[str, dict[str, Any]]:
    if not GOOGLE_CLIENT_ID:
        raise ValueError("Google sign-in is not configured.")
    try:
        claims = id_token.verify_oauth2_token(credential, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception as exc:
        raise ValueError("Invalid Google credential.") from exc
    if claims.get("aud") != GOOGLE_CLIENT_ID or not claims.get("email_verified"):
        raise ValueError("Google credential must have a verified email for this application.")
    subject, email = claims.get("sub"), claims.get("email")
    if not subject or not email:
        raise ValueError("Google credential is missing required identity details.")
    first = claims.get("given_name") or ""
    last = claims.get("family_name") or ""
    name = claims.get("name") or " ".join(part for part in (first, last) if part)
    avatar = claims.get("picture")

    conn = get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT * FROM users WHERE google_sub = ? OR email = ? LIMIT 1", (subject, email)).fetchone()
        if row:
            conn.execute("""UPDATE users SET google_sub=?, avatar_url=?, first_middle_name=COALESCE(NULLIF(first_middle_name,''),?),
                last_name=COALESCE(NULLIF(last_name,''),?), name=?, email=?, updated_at=? WHERE user_id=?""",
                (subject, avatar, first, last, name, email, datetime.now(timezone.utc).isoformat(), row["user_id"]))
            user_id = row["user_id"]
        else:
            cur = conn.execute("""INSERT INTO users (name,email,google_sub,avatar_url,first_middle_name,last_name)
                VALUES (?,?,?,?,?,?)""", (name, email, subject, avatar, first, last))
            user_id = cur.lastrowid
        conn.commit()
        user = dict(conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone())
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    token = jwt.encode({"sub": str(user["user_id"]), "iat": datetime.now(timezone.utc),
                        "exp": datetime.now(timezone.utc) + timedelta(days=7)}, JWT_SECRET, algorithm="HS256")
    return token, user


def decode_access_token(token: str) -> int:
    try:
        claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return int(claims["sub"])
    except Exception as exc:
        raise ValueError("Invalid or expired access token.") from exc
