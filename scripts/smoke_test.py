#!/usr/bin/env python
"""
Milestone 2 — End-to-end smoke test.

Flow:  meta → search → rank → book → verify seats drop →
       create payment order → verify payment → download PDF.

Uses FastAPI TestClient so no server process is needed.
"""

from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from pathlib import Path

# ── Ensure mock Razorpay before any imports ──────────────────────────────
os.environ["MOCK_RAZORPAY"] = "true"

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Reset SQLite for a clean run (DuckDB left as-is from Milestone 1)
app_db = ROOT / "data" / "app.db"
if app_db.exists():
    app_db.unlink()

from backend.db.sqlite import init_db
init_db()  # ensure tables exist before TestClient enters lifespan

from starlette.testclient import TestClient
from backend.main import app
from backend.services import ranking_service

# ── Build client ─────────────────────────────────────────────────────────
client = TestClient(app, raise_server_exceptions=False)

TRAVEL_DATE = (date.today() + timedelta(days=15)).isoformat()
PASSENGERS = 2
SRC, DST, CLS = "Delhi", "Mumbai", "Economy"

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
print("  Milestone 2 — Smoke Test")
print("=" * 60)

# ── 1. GET /api/flights/meta ─────────────────────────────────────────────
print("\n[1] GET /api/flights/meta")
r = client.get("/api/flights/meta")
check("status 200", r.status_code == 200)
meta = r.json()
check("6 cities", len(meta["cities"]) == 6)
check("6 departure_times", len(meta["departure_times"]) == 6)

# ── 2. POST /api/flights/search ──────────────────────────────────────────
print(f"\n[2] POST /api/flights/search  ({SRC}→{DST}, {CLS}, date={TRAVEL_DATE})")
r = client.post("/api/flights/search", json={
    "source_city": SRC,
    "destination_city": DST,
    "travel_date": TRAVEL_DATE,
    "travel_class": CLS,
    "passengers": PASSENGERS,
})
check("status 200", r.status_code == 200)
search_data = r.json()
flights = search_data["flights"]
check(f"got {search_data['total']} flights (>0)", search_data["total"] > 0)

first = flights[0]
flight_id = first["flight_id"]
seats_before = first["live_seats_left"]
print(f"       Using flight_id={flight_id}  code={first['flight_code']}  "
      f"price=₹{first['price']}  live_seats={seats_before}")

# ── 3. Rank flights (service-level call) ─────────────────────────────────
print("\n[3] Rank flights (service call)")
ranking = ranking_service.rank_flights(flights, preferred_departure_time="Morning")
check("best_pick has badge", ranking["best_pick"]["badge"] == "Best Overall")
check(f"top_3 length = {len(ranking['top_3'])}", len(ranking["top_3"]) >= 1)
for f in ranking["top_3"]:
    print(f"       #{f['flight_id']}  score={f['score']:.4f}  badge={f['badge']}  "
          f"₹{f['price']}  {f['duration_hrs']}h")

# ── 4. POST /api/bookings ───────────────────────────────────────────────
print(f"\n[4] POST /api/bookings  (flight_id={flight_id}, {PASSENGERS} pax)")
r = client.post("/api/bookings", json={
    "flight_id": flight_id,
    "travel_date": TRAVEL_DATE,
    "passengers": [
        {"name": "Alice Sharma", "age": 30, "gender": "F"},
        {"name": "Bob Sharma",   "age": 32, "gender": "M"},
    ],
    "email": "alice@test.com",
    "name": "Alice Sharma",
    "phone": "9876543210",
})
check("status 201", r.status_code == 201, r.text)
booking = r.json()
pnr = booking["pnr"]
booking_id = booking["booking_id"]
check("PNR is 6 chars", len(pnr) == 6)
check("status PENDING_PAYMENT", booking["status"] == "PENDING_PAYMENT")
check(f"total_amount = {first['price']}×{PASSENGERS} = {first['price']*PASSENGERS}",
      booking["total_amount"] == first["price"] * PASSENGERS)
check("hold_expires set", booking["hold_expires"] is not None)
check(f"passenger_count = {PASSENGERS}", booking["passenger_count"] == PASSENGERS)
print(f"       PNR={pnr}  booking_id={booking_id}  total=₹{booking['total_amount']}")

# ── 5. Verify live seats dropped ─────────────────────────────────────────
print(f"\n[5] Verify seats drop for flight_id={flight_id}")
r = client.get(f"/api/flights/{flight_id}", params={"travel_date": TRAVEL_DATE})
check("status 200", r.status_code == 200)
seats_after = r.json()["live_seats_left"]
check(f"seats_before({seats_before}) - seats_after({seats_after}) == {PASSENGERS}",
      seats_before - seats_after == PASSENGERS)

# ── 6. POST /api/payments/order ──────────────────────────────────────────
print(f"\n[6] POST /api/payments/order  (booking_id={booking_id})")
r = client.post("/api/payments/order", json={"booking_id": booking_id})
check("status 201", r.status_code == 201, r.text)
order = r.json()
check("gateway_order_id starts with mock_ord_", order["gateway_order_id"].startswith("mock_ord_"))
check("status CREATED", order["status"] == "CREATED")
print(f"       order_id={order['gateway_order_id']}  amount=₹{order['amount']}")

# ── 7. POST /api/payments/verify ─────────────────────────────────────────
print("\n[7] POST /api/payments/verify  (mock signature)")
r = client.post("/api/payments/verify", json={
    "razorpay_order_id": order["gateway_order_id"],
    "razorpay_payment_id": "mock_pay_12345",
    "razorpay_signature": "mock_sig",
})
check("status 200", r.status_code == 200, r.text)
verify = r.json()
check("payment status PAID", verify["status"] == "PAID")
check("booking status CONFIRMED", verify["booking_status"] == "CONFIRMED")
check(f"PNR matches ({pnr})", verify["pnr"] == pnr)

# ── 8. GET /api/bookings/{pnr} ──────────────────────────────────────────
print(f"\n[8] GET /api/bookings/{pnr}")
r = client.get(f"/api/bookings/{pnr}")
check("status 200", r.status_code == 200)
check("status CONFIRMED", r.json()["status"] == "CONFIRMED")

# ── 9. GET /api/bookings?email=... ──────────────────────────────────────
print("\n[9] GET /api/bookings?email=alice@test.com")
r = client.get("/api/bookings", params={"email": "alice@test.com"})
check("status 200", r.status_code == 200)
check(">=1 booking returned", len(r.json()) >= 1)

# ── 10. GET /api/bookings/{pnr}/ticket.pdf ───────────────────────────────
print(f"\n[10] GET /api/bookings/{pnr}/ticket.pdf")
r = client.get(f"/api/bookings/{pnr}/ticket.pdf")
check("status 200", r.status_code == 200, r.text[:200] if r.status_code != 200 else "")
check("content-type PDF", "application/pdf" in r.headers.get("content-type", ""))
check(f"PDF size > 0 ({len(r.content)} bytes)", len(r.content) > 500)

# Save a copy for manual inspection
pdf_path = ROOT / "data" / f"ticket_{pnr}.pdf"
pdf_path.write_bytes(r.content)
print(f"       Saved PDF → {pdf_path}")

# ── Summary ──────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
total = passed + failed
print(f"  Results: {passed}/{total} passed, {failed} failed")
if failed == 0:
    print("  ✓ All smoke tests passed!")
else:
    print("  ✗ Some tests failed — see above.")
print("=" * 60)

client.close()
sys.exit(1 if failed else 0)
