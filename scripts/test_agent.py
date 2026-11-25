#!/usr/bin/env python
"""
Milestone 3 — Agent endpoint verification test.

Tests:
  1. POST /api/agent/session          — create a session
  2. PATCH /api/agent/session/{id}/budget — set budget
  3. POST /api/agent/message          — stream SSE (may error without API key)
  4. GET  /api/agent/session/{id}/steps — hydration endpoint
  5. Budget guard unit test           — block when over budget
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ["MOCK_RAZORPAY"] = "true"

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Reset SQLite
app_db = ROOT / "data" / "app.db"
if app_db.exists():
    app_db.unlink()

from backend.db.sqlite import init_db
init_db()

from starlette.testclient import TestClient
from backend.main import app

client = TestClient(app, raise_server_exceptions=False)

passed = 0
failed = 0


def check(label: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✓ {label}")
    else:
        failed += 1
        print(f"  ✗ {label}  — {detail}")


print("=" * 60)
print("  Milestone 3 — Agent Endpoint Tests")
print("=" * 60)

# ── 1. Create session ───────────────────────────────────────────────────
print("\n[1] POST /api/agent/session")
r = client.post("/api/agent/session", json={})
check("status 201", r.status_code == 201, f"got {r.status_code}: {r.text}")
session = r.json()
session_id = session["session_id"]
check("session_id present", session_id is not None)
check("status ACTIVE", session["status"] == "ACTIVE")
check("budget is None", session["budget"] is None)
print(f"       session_id={session_id}")

# ── 2. Set budget ───────────────────────────────────────────────────────
print(f"\n[2] PATCH /api/agent/session/{session_id}/budget")
r = client.patch(f"/api/agent/session/{session_id}/budget", json={"budget": 15000})
check("status 200", r.status_code == 200, f"got {r.status_code}: {r.text}")
check("budget = 15000", r.json()["budget"] == 15000)

# ── 3. POST /api/agent/message (SSE) ────────────────────────────────────
print(f"\n[3] POST /api/agent/message  (session_id={session_id})")
r = client.post(
    "/api/agent/message",
    json={"session_id": session_id, "content": "Hello, search flights from Delhi to Mumbai"},
)
check("status 200 (SSE stream)", r.status_code == 200, f"got {r.status_code}")
check("content-type text/event-stream",
      "text/event-stream" in r.headers.get("content-type", ""),
      r.headers.get("content-type", ""))

# Parse SSE events
events = []
for line in r.text.strip().split("\n"):
    line = line.strip()
    if line.startswith("event:"):
        events.append({"event": line.split(":", 1)[1].strip()})
    elif line.startswith("data:") and events:
        try:
            events[-1]["data"] = json.loads(line.split(":", 1)[1].strip())
        except json.JSONDecodeError:
            events[-1]["data"] = line.split(":", 1)[1].strip()

event_types = [e["event"] for e in events]
print(f"       Received {len(events)} SSE events: {event_types}")

check("has 'done' event", "done" in event_types)

has_assistant = "assistant_message" in event_types
check("has 'assistant_message' event", has_assistant)

if has_assistant:
    am = next(e for e in events if e["event"] == "assistant_message")
    content = am.get("data", {}).get("content", "")
    print(f"       Assistant: {content[:120]}...")

# Check if any step_update events (depends on whether Gemini API key is set)
step_events = [e for e in events if e["event"] == "step_update"]
if step_events:
    print(f"       Tool steps: {len(step_events)}")
    for se in step_events:
        d = se.get("data", {})
        print(f"         {d.get('tool_name', '?')}: {d.get('status', '?')} — {d.get('summary', '')}")

# ── 4. GET /api/agent/session/{id}/steps ────────────────────────────────
print(f"\n[4] GET /api/agent/session/{session_id}/steps")
r = client.get(f"/api/agent/session/{session_id}/steps")
check("status 200", r.status_code == 200, f"got {r.status_code}: {r.text}")
hydration = r.json()
check("has 'session' key", "session" in hydration)
check("has 'messages' key", "messages" in hydration)
check("has 'steps' key", "steps" in hydration)
check(f"messages count >= 2 (user+assistant)", len(hydration["messages"]) >= 2,
      f"got {len(hydration['messages'])}")
print(f"       {len(hydration['messages'])} messages, {len(hydration['steps'])} steps persisted")

# ── 5. Budget guard unit test ───────────────────────────────────────────
print("\n[5] Budget guard unit test")
from backend.agent import budget_guard

# Budget is 15000, try amount within budget
result = budget_guard.check(session_id, 10000)
check("₹10,000 within ₹15,000 budget → None", result is None)

# Try amount exceeding budget
result = budget_guard.check(session_id, 20000)
check("₹20,000 exceeds ₹15,000 budget → BLOCKED",
      result is not None and result["status"] == "BLOCKED_BY_BUDGET_GUARD",
      str(result))

if result:
    check("blocked response has total_amount=20000", result["total_amount"] == 20000)
    check("blocked response has budget=15000", result["budget"] == 15000)

# No session → always pass
result = budget_guard.check(None, 999999)
check("No session_id → None (passes)", result is None)

# ── Summary ──────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
total = passed + failed
print(f"  Results: {passed}/{total} passed, {failed} failed")
if failed == 0:
    print("  ✓ All agent tests passed!")
else:
    print("  ✗ Some tests failed — see above.")
print("=" * 60)

client.close()
sys.exit(1 if failed else 0)
