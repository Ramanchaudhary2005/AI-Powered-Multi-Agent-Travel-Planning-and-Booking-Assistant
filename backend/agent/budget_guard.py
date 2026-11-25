"""
budget_guard — hard Python enforcement before bookings / payment orders.

If the session has a budget and the requested amount exceeds it,
the guard returns a BLOCKED dict that is sent back to Gemini as
the tool result.  Otherwise it returns ``None`` (pass).
"""

from __future__ import annotations

from backend.db import sqlite as sqlite_mod


def check(session_id: int | None, amount: int) -> dict | None:
    """
    Return ``None`` when within budget (or no budget set).
    Return a ``BLOCKED_BY_BUDGET_GUARD`` dict otherwise.
    """
    if session_id is None:
        return None

    conn = sqlite_mod.get_connection()
    try:
        row = conn.execute(
            "SELECT budget FROM agent_sessions WHERE session_id = ?;",
            (session_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None or row["budget"] is None:
        return None

    budget = row["budget"]
    if amount > budget:
        return {
            "status": "BLOCKED_BY_BUDGET_GUARD",
            "total_amount": amount,
            "budget": budget,
        }
    return None
