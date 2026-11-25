"""Authenticated profile and co-traveller management."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.db.sqlite import get_connection
from backend.routers.auth import get_current_user
from backend.services.auth_service import profile_completion

router = APIRouter(prefix="/api/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    first_middle_name: str | None = None
    last_name: str | None = None
    gender: str | None = None
    dob: str | None = None
    nationality: str | None = None
    marital_status: str | None = None
    anniversary: str | None = None
    city: str | None = None
    state: str | None = None
    mobile_number: str | None = None


class TravellerIn(BaseModel):
    first_middle_name: str
    last_name: str | None = None
    gender: str | None = None
    dob: str | None = None
    relationship: str | None = None


def _travellers(conn, user_id: int):
    return [dict(row) for row in conn.execute(
        "SELECT * FROM co_travellers WHERE user_id=? ORDER BY created_at DESC, id DESC", (user_id,)).fetchall()]


@router.get("")
def get_profile(user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        return {"general_information": {key: user.get(key) for key in (
            "first_middle_name", "last_name", "gender", "dob", "nationality", "marital_status", "anniversary", "city", "state")},
            "contact_details": {"email": user["email"], "email_verified": True, "mobile_number": user.get("mobile_number")},
            "profile_completion_pct": profile_completion(user), "co_travellers": _travellers(conn, user["user_id"])}
    finally:
        conn.close()


@router.put("")
def update_profile(payload: ProfileUpdate, user: dict[str, Any] = Depends(get_current_user)):
    updates = payload.model_dump(exclude_unset=True)
    if "marital_status" in updates and updates["marital_status"] != "Married":
        updates["anniversary"] = None
    if not updates:
        return {**user, "profile_completion_pct": profile_completion(user)}
    first = updates.get("first_middle_name", user.get("first_middle_name")) or ""
    last = updates.get("last_name", user.get("last_name")) or ""
    updates["name"] = " ".join(part for part in (first, last) if part)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    conn = get_connection()
    try:
        conn.execute("UPDATE users SET " + ", ".join(f"{key}=?" for key in updates) + " WHERE user_id=?",
                     (*updates.values(), user["user_id"]))
        conn.commit()
        row = dict(conn.execute("SELECT * FROM users WHERE user_id=?", (user["user_id"],)).fetchone())
        return {**row, "profile_completion_pct": profile_completion(row)}
    finally:
        conn.close()


@router.get("/co-travellers")
def list_travellers(user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        return _travellers(conn, user["user_id"])
    finally:
        conn.close()


@router.post("/co-travellers", status_code=201)
def add_traveller(payload: TravellerIn, user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        cur = conn.execute("""INSERT INTO co_travellers
            (user_id,first_middle_name,last_name,gender,dob,relationship,created_at) VALUES (?,?,?,?,?,?,?)""",
            (user["user_id"], payload.first_middle_name, payload.last_name, payload.gender, payload.dob,
             payload.relationship, datetime.now(timezone.utc).isoformat()))
        conn.commit()
        return dict(conn.execute("SELECT * FROM co_travellers WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()


@router.put("/co-travellers/{traveller_id}")
def update_traveller(traveller_id: int, payload: TravellerIn, user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        cur = conn.execute("""UPDATE co_travellers SET first_middle_name=?,last_name=?,gender=?,dob=?,relationship=?
            WHERE id=? AND user_id=?""", (*payload.model_dump().values(), traveller_id, user["user_id"]))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Co-traveller not found.")
        conn.commit()
        return dict(conn.execute("SELECT * FROM co_travellers WHERE id=?", (traveller_id,)).fetchone())
    finally:
        conn.close()


@router.delete("/co-travellers/{traveller_id}")
def delete_traveller(traveller_id: int, user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM co_travellers WHERE id=? AND user_id=?", (traveller_id, user["user_id"]))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Co-traveller not found.")
        conn.commit()
        return {"deleted": True}
    finally:
        conn.close()
