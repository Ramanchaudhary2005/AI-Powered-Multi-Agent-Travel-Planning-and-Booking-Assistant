"""
orchestrator — Gemini tool-loop with SSE streaming.

Yields SSE events:
  step_update   — when a tool call starts (RUNNING) and finishes (DONE/FAILED)
  ui_card       — after rank_flights (RANKED_FLIGHTS) or create_payment_order (PAYMENT_ORDER)
  assistant_message — final Gemini text
  done          — end of stream
"""

from __future__ import annotations

import json
import time
import traceback
from datetime import date, timedelta
from typing import Any, Generator

from google import genai
from google.genai import types

from backend import config
from backend.agent import tools as agent_tools
from backend.db import sqlite as sqlite_mod

MAX_ITERATIONS = 6
MAX_RETRIES_PER_MODEL = 2
RETRY_BACKOFF_SECONDS = 1.5


def _fallback_models() -> list[str]:
    candidates = [
        config.GEMINI_MODEL,
        "gemini-3.1-flash-lite",
        "gemini-3-flash",
        "gemini-2.5-flash",
    ]
    return list(dict.fromkeys(m for m in candidates if m))


def _is_retryable_or_fallback_error(exc: Exception) -> tuple[bool, bool]:
    """Return ``(should_fallback, should_retry_same_model)`` for Gemini API errors."""
    code = getattr(exc, "code", None)
    status = str(getattr(exc, "status", "") or "")
    msg = str(exc)
    combined = f"{code} {status} {msg}".upper()

    # Billing / depleted credits (402) won't be fixed by retries or model fallback
    if code == 402 or "CREDITS ARE DEPLETED" in combined:
        return False, False
    if code == 404 or "404" in combined or "NOT_FOUND" in combined:
        return True, False
    if code in (503, 429) or any(tok in combined for tok in ("503", "UNAVAILABLE", "429")):
        return True, True
    return False, False


def _generate_with_retry_and_fallback(
    client: genai.Client,
    contents: list[types.Content],
    gen_config: types.GenerateContentConfig,
):
    """Call ``generate_content`` with 2 attempts (1.5s backoff) and model fallback."""
    last_exc: Exception | None = None
    for model_name in _fallback_models():
        for attempt in range(MAX_RETRIES_PER_MODEL):
            try:
                return client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=gen_config,
                )
            except Exception as exc:
                last_exc = exc
                should_fallback, should_retry = _is_retryable_or_fallback_error(exc)
                if not should_fallback:
                    raise
                if not should_retry:
                    break
                if attempt < MAX_RETRIES_PER_MODEL - 1:
                    time.sleep(RETRY_BACKOFF_SECONDS)
    if last_exc is not None:
        raise last_exc
    raise RuntimeError("No Gemini models configured.")

# ── Lazy Gemini client ───────────────────────────────────────────────────

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        if not config.GEMINI_API_KEY:
            raise RuntimeError(
                "GEMINI_API_KEY is not configured. "
                "Set it in your .env file to enable the agent."
            )
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


# ── System prompt builder ────────────────────────────────────────────────

def _build_system_prompt(session: dict, user_context: dict | None = None) -> str:
    today = date.today()
    tomorrow = today + timedelta(days=1)
    max_date = today + timedelta(days=49)
    budget = session.get("budget")
    budget_str = f"₹{budget:,}" if budget else "No budget set"

    profile_block = ""
    if user_context:
        profile_block = (
            "[Logged-in User Context]\n"
            + json.dumps(user_context, ensure_ascii=False, default=str)
            + "\nUse this private profile context only to personalize assistance and fill details the user has asked you to use. Never reveal credentials. The primary user's name, email, age, and gender are their saved booking details; each saved co-traveller also has their saved name, age, and gender.\n\n"
        )
    return (
        "You are SkyAgent, a friendly and efficient flight-booking assistant "
        "for Indian domestic flights.\n\n"
        f"TODAY: {today.isoformat()}\n"
        f"BOOKABLE WINDOW: {tomorrow.isoformat()} to {max_date.isoformat()} "
        f"(1–49 days from today)\n"
        f"SUPPORTED CITIES: Delhi, Mumbai, Bangalore, Kolkata, Hyderabad, Chennai\n"
        f"SESSION BUDGET: {budget_str}\n\n"
        f"{profile_block}"
        "YOUR WORKFLOW:\n"
        "1. Understand the user's travel needs (cities, dates, class, number of passengers). If they state or change a budget in any form, immediately call set_budget_cap before searching, ranking, or booking.\n"
        "2. Use search_flights to find available options.\n"
        "3. Use rank_flights to compare and recommend the best options.\n"
        "4. If no flights match, use find_alternatives to broaden the search.\n"
        "5. Present options clearly with prices, times, and stops.\n"
        "6. When the user picks a flight, guests without profile context should provide passenger name, age, gender, and contact email as before. For a logged-in user, use their saved name, email, age, and gender from [Logged-in User Context] when booking for them. For a saved co-traveller, use that person's saved name, age, and gender, and use the logged-in user's email as the booking contact. Never ask the user to repeat any known values. Ask for a booking field (name, email, age, or gender) only when that specific value is missing or null from the applicable logged-in context.\n"
        "7. Use create_booking to hold the seats.\n"
        "8. Use create_payment_order to generate a payment order.\n\n"
        "STRICT RULES:\n"
        "- NEVER invent or fabricate flight IDs. Always search first and use "
        "IDs from search results.\n"
        "- NEVER ask the user for credit/debit card numbers, CVV, UPI IDs, "
        "or any payment credentials. Payments are handled securely through "
        "Razorpay checkout.\n"
        "- ALL prices are in Indian Rupees (₹ / INR).\n"
        "- If the budget is set, warn the user if a booking would exceed it.\n"
        "- For authenticated users, greet them naturally by first name when appropriate. Resolve 'from my city' / 'mere home city se' from the saved city. Match named or relationship-referenced saved co-travellers and use their saved details without asking the user to repeat them. Do not infer a home city for guests.\n"
        "- Keep responses concise and helpful. Use bullet points for flight "
        "comparisons.\n"
        "- Confirm flight details with the user BEFORE creating a booking.\n"
    )


# ── History helpers ──────────────────────────────────────────────────────

def _load_history(session_id: int) -> list[types.Content]:
    """Rebuild Gemini-compatible content list from persisted messages."""
    conn = sqlite_mod.get_connection()
    try:
        rows = conn.execute(
            "SELECT role, content FROM agent_messages "
            "WHERE session_id = ? ORDER BY message_id ASC;",
            (session_id,),
        ).fetchall()
    finally:
        conn.close()

    contents: list[types.Content] = []
    for r in rows:
        role = "model" if r["role"] == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part(text=r["content"])]))
    return contents


# ── Persistence helpers ──────────────────────────────────────────────────

def _save_message(session_id: int, role: str, content: str,
                  ui_payload_json: str | None = None) -> int:
    conn = sqlite_mod.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO agent_messages (session_id, role, content, ui_payload_json) "
            "VALUES (?, ?, ?, ?);",
            (session_id, role, content, ui_payload_json),
        )
        conn.commit()
        return cur.lastrowid  # type: ignore[return-value]
    finally:
        conn.close()


def _next_turn_id(session_id: int) -> int:
    conn = sqlite_mod.get_connection()
    try:
        row = conn.execute(
            "SELECT COALESCE(MAX(turn_id), 0) + 1 FROM agent_steps WHERE session_id = ?;",
            (session_id,),
        ).fetchone()
        return row[0]
    finally:
        conn.close()


def _persist_step(session_id: int, turn_id: int, step_no: int,
                  tool_name: str, status: str,
                  input_json: str | None = None,
                  output_json: str | None = None,
                  summary: str | None = None) -> int:
    conn = sqlite_mod.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO agent_steps "
            "(session_id, turn_id, step_no, tool_name, status, summary, input_json, output_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?);",
            (session_id, turn_id, step_no, tool_name, status, summary, input_json, output_json),
        )
        conn.commit()
        return cur.lastrowid  # type: ignore[return-value]
    finally:
        conn.close()


def _update_step(step_id: int, status: str,
                 summary: str | None = None,
                 output_json: str | None = None) -> None:
    conn = sqlite_mod.get_connection()
    try:
        conn.execute(
            "UPDATE agent_steps SET status = ?, summary = ?, output_json = ? "
            "WHERE step_id = ?;",
            (status, summary, output_json, step_id),
        )
        conn.commit()
    finally:
        conn.close()


# ── SSE formatting ───────────────────────────────────────────────────────

def _sse(event: str, data: Any) -> str:
    """Format one SSE frame."""
    payload = json.dumps(data, default=str)
    return f"event: {event}\ndata: {payload}\n\n"


def _summarise(tool_name: str, result: dict) -> str:
    """One-line human summary of a tool result for step_update."""
    if "error" in result:
        return f"Error: {result['error']}"
    if tool_name == "search_flights":
        return f"Found {result.get('total_results', '?')} flights"
    if tool_name == "rank_flights":
        bp = result.get("best_pick", {})
        return f"Best: {bp.get('flight_code', '?')} ₹{bp.get('price', '?')}"
    if tool_name == "find_alternatives":
        return (f"Found {result.get('total_results', 0)} alternatives — "
                f"{result.get('explanation', '')}")
    if tool_name == "create_booking":
        return f"Booking {result.get('pnr', '?')} created"
    if tool_name == "create_payment_order":
        return f"Payment order {result.get('gateway_order_id', '?')} created"
    return "Done"


# ── Main streaming generator ─────────────────────────────────────────────

def stream_response(session_id: int, user_message: str,
                    user_context: dict | None = None) -> Generator[str, None, None]:
    """
    Synchronous generator that yields SSE frames.

    FastAPI will run this in a thread-pool for ``StreamingResponse``.
    """
    # Always persist the user message before anything that might fail
    _save_message(session_id, "user", user_message)

    try:
        yield from _stream_inner(session_id, user_message, user_context)
    except Exception as exc:
        error_text = f"⚠️ Agent error: {exc}"
        _save_message(session_id, "assistant", error_text)
        yield _sse("assistant_message", {
            "content": error_text,
            "ui_payload_json": None,
        })
    finally:
        yield _sse("done", {})


def _stream_inner(session_id: int, user_message: str,
                  user_context: dict | None = None) -> Generator[str, None, None]:
    # ── Load session ─────────────────────────────────────────────────
    conn = sqlite_mod.get_connection()
    try:
        srow = conn.execute(
            "SELECT session_id, user_id, budget, status "
            "FROM agent_sessions WHERE session_id = ?;",
            (session_id,),
        ).fetchone()
    finally:
        conn.close()
    if srow is None:
        raise ValueError(f"Session {session_id} not found.")
    session = dict(srow)
    if session["status"] != "ACTIVE":
        raise ValueError(f"Session {session_id} is {session['status']}; cannot send messages.")

    # ── Build Gemini config ──────────────────────────────────────────
    client = _get_client()
    system_prompt = _build_system_prompt(session, user_context)
    gen_config = types.GenerateContentConfig(
        tools=[agent_tools.GEMINI_TOOL],
        system_instruction=system_prompt,
        temperature=0.2,
    )

    # ── Conversation contents ────────────────────────────────────────
    contents = _load_history(session_id)
    # User message already persisted by stream_response()
    contents.append(types.Content(role="user", parts=[types.Part(text=user_message)]))

    turn_id = _next_turn_id(session_id)
    step_no = 0
    last_ui_payload: dict | None = None
    context: dict[str, Any] = {"last_search_results": [], "user_context": user_context}

    # ── Tool loop (max 6 iterations) ─────────────────────────────────
    for _iteration in range(MAX_ITERATIONS):
        response = _generate_with_retry_and_fallback(
            client=client,
            contents=contents,
            gen_config=gen_config,
        )

        candidate = response.candidates[0]
        parts = candidate.content.parts

        fn_calls = [p for p in parts if p.function_call]
        # Apply a newly stated cap before any search or booking calls returned
        # in the same Gemini response.
        fn_calls.sort(key=lambda part: part.function_call.name != "set_budget_cap")
        text_parts = [p for p in parts if p.text]

        if fn_calls:
            # Append model's response (with function_call parts) to history
            contents.append(candidate.content)

            fr_parts: list[types.Part] = []
            for part in fn_calls:
                fc = part.function_call
                step_no += 1
                args_dict = agent_tools._convert(fc.args) or {}

                # ── RUNNING ──────────────────────────────────────────
                step_id = _persist_step(
                    session_id, turn_id, step_no, fc.name, "RUNNING",
                    input_json=json.dumps(args_dict, default=str),
                )
                yield _sse("step_update", {
                    "step_id": step_id, "turn_id": turn_id,
                    "step_no": step_no, "tool_name": fc.name,
                    "status": "RUNNING", "summary": None,
                })

                # ── Execute ──────────────────────────────────────────
                try:
                    result = agent_tools.execute(
                        fc.name, fc.args, session_id, context,
                    )
                    summary = _summarise(fc.name, result)
                    out_json = json.dumps(result, default=str)
                    _update_step(step_id, "DONE", summary, out_json)
                    yield _sse("step_update", {
                        "step_id": step_id, "turn_id": turn_id,
                        "step_no": step_no, "tool_name": fc.name,
                        "status": "DONE", "summary": summary,
                    })
                    if fc.name == "set_budget_cap" and "error" not in result:
                        yield _sse("budget_updated", {"budget_cap": result.get("budget_cap")})

                    # ── UI card? ─────────────────────────────────────
                    if fc.name == "rank_flights" and "error" not in result:
                        last_ui_payload = {"type": "RANKED_FLIGHTS", "data": result}
                        yield _sse("ui_card", last_ui_payload)
                    elif fc.name == "create_payment_order" and "error" not in result:
                        last_ui_payload = {"type": "PAYMENT_ORDER", "data": result}
                        yield _sse("ui_card", last_ui_payload)

                except Exception as exc:
                    summary = str(exc)
                    _update_step(step_id, "FAILED", summary)
                    yield _sse("step_update", {
                        "step_id": step_id, "turn_id": turn_id,
                        "step_no": step_no, "tool_name": fc.name,
                        "status": "FAILED", "summary": summary,
                    })
                    result = {"error": summary}

                # Build function-response Part
                fr_parts.append(types.Part(
                    function_response=types.FunctionResponse(
                        name=fc.name,
                        response=result,
                    )
                ))

            # Append all function responses as one Content turn
            contents.append(types.Content(parts=fr_parts))
            continue  # next iteration — Gemini will produce text or more calls

        # ── Text response (final) ────────────────────────────────────
        if text_parts:
            text = " ".join(p.text for p in text_parts if p.text)
            ui_json = json.dumps(last_ui_payload, default=str) if last_ui_payload else None
            _save_message(session_id, "assistant", text, ui_json)
            yield _sse("assistant_message", {
                "content": text,
                "ui_payload_json": ui_json,
            })
            return  # done event emitted by stream_response wrapper

        # Neither function call nor text — safety fallback
        _save_message(session_id, "assistant", "(No response generated)")
        yield _sse("assistant_message", {
            "content": "(No response generated)",
            "ui_payload_json": None,
        })
        return

    # Exhausted iterations — tell the user
    msg = "I've reached my tool-call limit for this turn. Please send another message to continue."
    _save_message(session_id, "assistant", msg)
    yield _sse("assistant_message", {"content": msg, "ui_payload_json": None})
