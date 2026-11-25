"""
Agent router — session management + SSE message streaming.
"""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.agent import orchestrator
from backend.db import sqlite as sqlite_mod
from backend.routers.auth import get_optional_user

router = APIRouter(prefix="/api/agent", tags=["agent"])


def _age_from_dob(dob: str | None) -> int | None:
    if not dob:
        return None
    try:
        born = date.fromisoformat(dob)
    except (TypeError, ValueError):
        return None
    today = date.today()
    return today.year - born.year - ((today.month, today.day) < (born.month, born.day))


# ── Request / response models ────────────────────────────────────────────

class SessionCreate(BaseModel):
    user_id: int | None = None


class SessionOut(BaseModel):
    session_id: int
    user_id: int | None = None
    budget: float | None = None
    status: str
    created_at: str


class BudgetUpdate(BaseModel):
    budget: int | None


class AgentMessageIn(BaseModel):
    session_id: int
    content: str


class MessageOut(BaseModel):
    message_id: int
    role: str
    content: str
    ui_payload_json: str | None = None
    created_at: str


class StepOut(BaseModel):
    step_id: int
    turn_id: int
    step_no: int
    tool_name: str
    status: str
    summary: str | None = None
    input_json: str | None = None
    output_json: str | None = None
    created_at: str


class SessionHydration(BaseModel):
    session: SessionOut
    messages: list[MessageOut]
    steps: list[StepOut]


# ── Endpoints ────────────────────────────────────────────────────────────

@router.post("/session", response_model=SessionOut, status_code=201)
def create_session(req: SessionCreate):
    conn = sqlite_mod.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO agent_sessions (user_id) VALUES (?);",
            (req.user_id,),
        )
        session_id = cur.lastrowid
        conn.commit()
        row = conn.execute(
            "SELECT session_id, user_id, budget, status, created_at "
            "FROM agent_sessions WHERE session_id = ?;",
            (session_id,),
        ).fetchone()
    finally:
        conn.close()
    return dict(row)


@router.patch("/session/{session_id}/budget", response_model=SessionOut)
def update_budget(session_id: int, req: BudgetUpdate):
    conn = sqlite_mod.get_connection()
    try:
        cur = conn.execute(
            "UPDATE agent_sessions SET budget = ? WHERE session_id = ?;",
            (None if req.budget is None or req.budget <= 0 else req.budget, session_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Session not found.")
        conn.commit()
        row = conn.execute(
            "SELECT session_id, user_id, budget, status, created_at "
            "FROM agent_sessions WHERE session_id = ?;",
            (session_id,),
        ).fetchone()
    finally:
        conn.close()
    return dict(row)


@router.post("/message")
def agent_message(req: AgentMessageIn, user=Depends(get_optional_user)):
    """
    Stream SSE events for one user turn.

    Events: ``step_update``, ``ui_card``, ``assistant_message``, ``done``.
    """
    # Quick validation
    conn = sqlite_mod.get_connection()
    try:
        row = conn.execute(
            "SELECT status FROM agent_sessions WHERE session_id = ?;",
            (req.session_id,),
        ).fetchone()
    finally:
        conn.close()
    if row is None:
        raise HTTPException(404, "Session not found.")
    if row["status"] != "ACTIVE":
        raise HTTPException(400, f"Session is {row['status']}.")

    user_context = None
    if user:
        conn = sqlite_mod.get_connection()
        try:
            profile = conn.execute(
                "SELECT name, first_middle_name, email, city, state, mobile_number, "
                "dob, gender, nationality "
                "FROM users WHERE user_id = ?", (user["user_id"],)
            ).fetchone()
            co_travellers = conn.execute(
                "SELECT first_middle_name, last_name, gender, dob, relationship "
                "FROM co_travellers WHERE user_id = ? ORDER BY created_at DESC, id DESC",
                (user["user_id"],),
            ).fetchall()
            wishlist = conn.execute(
                "SELECT DISTINCT source_city, destination_city FROM wishlist "
                "WHERE user_id = ? ORDER BY source_city, destination_city",
                (user["user_id"],),
            ).fetchall()
        finally:
            conn.close()
        if profile:
            primary_profile = dict(profile)
            primary_profile["age"] = _age_from_dob(primary_profile.get("dob"))
            saved_co_travellers = []
            for row in co_travellers:
                traveller = dict(row)
                traveller["age"] = _age_from_dob(traveller.get("dob"))
                saved_co_travellers.append(traveller)
            user_context = {
                **primary_profile,
                "co_travellers": saved_co_travellers,
                "wishlist_routes": [dict(row) for row in wishlist],
            }

    return StreamingResponse(
        orchestrator.stream_response(req.session_id, req.content, user_context=user_context),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/session/{session_id}/steps", response_model=SessionHydration)
def get_session_hydration(session_id: int):
    """
    Return session info, all messages, and all steps — used by the
    frontend on page refresh to reconstruct the conversation.
    """
    conn = sqlite_mod.get_connection()
    try:
        srow = conn.execute(
            "SELECT session_id, user_id, budget, status, created_at "
            "FROM agent_sessions WHERE session_id = ?;",
            (session_id,),
        ).fetchone()
        if srow is None:
            raise HTTPException(404, "Session not found.")

        mrows = conn.execute(
            "SELECT message_id, role, content, ui_payload_json, created_at "
            "FROM agent_messages WHERE session_id = ? ORDER BY message_id ASC;",
            (session_id,),
        ).fetchall()

        strows = conn.execute(
            "SELECT step_id, turn_id, step_no, tool_name, status, "
            "       summary, input_json, output_json, created_at "
            "FROM agent_steps WHERE session_id = ? ORDER BY step_id ASC;",
            (session_id,),
        ).fetchall()
    finally:
        conn.close()

    return {
        "session": dict(srow),
        "messages": [dict(r) for r in mrows],
        "steps": [dict(r) for r in strows],
    }
