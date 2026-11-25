"""Google OAuth exchange and bearer-token dependencies."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from backend.db.sqlite import get_connection
from backend.services.auth_service import authenticate_google, decode_access_token, profile_completion

router = APIRouter(prefix="/api/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)


def _user_from_credentials(credentials: HTTPAuthorizationCredentials | None, required: bool) -> dict[str, Any] | None:
    if credentials is None:
        if required:
            raise HTTPException(status_code=401, detail="Bearer token required.")
        return None
    try:
        user_id = decode_access_token(credentials.credentials)
    except ValueError as exc:
        if required:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return None
    conn = get_connection()
    try:
        row = conn.execute("SELECT * FROM users WHERE user_id=?", (user_id,)).fetchone()
        if row is None:
            if required:
                raise HTTPException(status_code=401, detail="User no longer exists.")
            return None
        return dict(row)
    finally:
        conn.close()


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, Any]:
    return _user_from_credentials(credentials, True)  # type: ignore[return-value]


def get_optional_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict[str, Any] | None:
    return _user_from_credentials(credentials, False)


class GoogleCredential(BaseModel):
    credential: str


@router.post("/google")
def google_login(payload: GoogleCredential):
    try:
        token, user = authenticate_google(payload.credential)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return {"access_token": token, "token_type": "bearer", "user": user}


@router.get("/me")
def me(user: dict[str, Any] = Depends(get_current_user)):
    return {**user, "profile_completion_pct": profile_completion(user)}


@router.post("/logout")
def logout(_: dict[str, Any] = Depends(get_current_user)):
    return {"message": "Logged out."}
