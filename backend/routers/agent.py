"""
Agent router — session management + SSE message streaming.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.agent import orchestrator
from backend.db import sqlite as sqlite_mod

router = APIRouter(prefix="/api/agent", tags=["agent"])


# ── Request / response models ────────────────────────────────────────────

class SessionCreate(BaseModel):
    user_id: int | None = None


class SessionOut(BaseModel):
    session_id: int
    user_id: int | None = None
    budget: int | None = None
    status: str
    created_at: str


class BudgetUpdate(BaseModel):
    budget: int


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
            (req.budget, session_id),
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
def agent_message(req: AgentMessageIn):
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

    return StreamingResponse(
        orchestrator.stream_response(req.session_id, req.content),
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
