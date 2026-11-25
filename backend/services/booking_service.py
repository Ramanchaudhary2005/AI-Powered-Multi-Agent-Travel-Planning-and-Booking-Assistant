"""
booking_service — create / query bookings with BEGIN IMMEDIATE
and authoritative price from DuckDB.
"""

from __future__ import annotations

import random
import string
from datetime import datetime, timezone, timedelta
from typing import Any

from backend.db import duck, sqlite as sqlite_mod
from backend.services.flight_service import expire_stale_holds


# ── Helpers ──────────────────────────────────────────────────────────────

def _generate_pnr(conn) -> str:
    """Return a unique 6-char uppercase alphanumeric PNR."""
    chars = string.ascii_uppercase + string.digits
    for _ in range(100):                       # safety bound
        pnr = "".join(random.choices(chars, k=6))
        row = conn.execute(
            "SELECT 1 FROM bookings WHERE pnr = ?;", (pnr,)
        ).fetchone()
        if row is None:
            return pnr
    raise RuntimeError("Failed to generate unique PNR after 100 attempts.")


def _now_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


# ── Public API ───────────────────────────────────────────────────────────

def create_booking(
    flight_id: int,
    travel_date: str,
    passengers: list[dict[str, Any]],
    email: str,
    name: str,
    phone: str | None = None,
    booked_via: str = "MANUAL",
    session_id: int | None = None,
) -> dict[str, Any]:
    """
    Atomically book seats.

    1. Expire stale holds.
    2. BEGIN IMMEDIATE on SQLite.
    3. Verify ``flight_id`` in DuckDB.
    4. Re-check live seats.
    5. Compute ``total_amount = price * len(passengers)``.
    6. Insert booking + passengers.
    """
    expire_stale_holds()

    # ── Verify flight in DuckDB ──────────────────────────────────────
    dcon = duck.get_connection()
    try:
        row = dcon.execute(
            'SELECT price, seats_available FROM flights WHERE flight_id = ?;',
            [flight_id],
        ).fetchone()
    finally:
        dcon.close()
    if row is None:
        raise ValueError(f"Flight {flight_id} does not exist.")
    price, seats_available = row

    passenger_count = len(passengers)
    total_amount = price * passenger_count

    # ── SQLite transactional block ───────────────────────────────────
    conn = sqlite_mod.get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE;")

        # Live-seat re-check inside the transaction
        now_utc = _now_utc()
        booked_row = conn.execute(
            "SELECT COALESCE(SUM(passenger_count), 0) FROM bookings "
            "WHERE flight_id = ? AND travel_date = ? "
            "  AND (status = 'CONFIRMED' "
            "       OR (status = 'PENDING_PAYMENT' AND hold_expires >= ?));",
            (flight_id, travel_date, now_utc),
        ).fetchone()
        booked_seats = booked_row[0]
        live_left = seats_available - booked_seats
        if live_left < passenger_count:
            conn.rollback()
            raise ValueError(
                f"Not enough seats: {live_left} available but {passenger_count} requested."
            )

        # Get or create user
        user_row = conn.execute(
            "SELECT user_id FROM users WHERE email = ?;", (email,)
        ).fetchone()
        if user_row:
            user_id = user_row[0]
        else:
            cur = conn.execute(
                "INSERT INTO users (name, email, phone) VALUES (?, ?, ?);",
                (name, email, phone),
            )
            user_id = cur.lastrowid

        # Generate PNR + hold
        pnr = _generate_pnr(conn)
        hold_expires = (
            datetime.now(timezone.utc) + timedelta(minutes=10)
        ).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

        cur = conn.execute(
            "INSERT INTO bookings "
            "(pnr, user_id, flight_id, travel_date, passenger_count, "
            " total_amount, status, booked_via, session_id, hold_expires) "
            "VALUES (?, ?, ?, ?, ?, ?, 'PENDING_PAYMENT', ?, ?, ?);",
            (pnr, user_id, flight_id, travel_date, passenger_count,
             total_amount, booked_via, session_id, hold_expires),
        )
        booking_id = cur.lastrowid

        # Insert passengers
        for p in passengers:
            conn.execute(
                "INSERT INTO passengers (booking_id, name, age, gender) "
                "VALUES (?, ?, ?, ?);",
                (booking_id, p["name"], p["age"], p["gender"]),
            )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return get_booking_by_pnr(pnr)  # type: ignore[return-value]


def get_booking_by_pnr(pnr: str) -> dict[str, Any] | None:
    """Return full booking record (with passengers) or ``None``."""
    conn = sqlite_mod.get_connection()
    try:
        brow = conn.execute(
            "SELECT booking_id, pnr, user_id, flight_id, travel_date, "
            "       passenger_count, total_amount, status, booked_via, "
            "       session_id, hold_expires, created_at "
            "FROM bookings WHERE pnr = ?;",
            (pnr,),
        ).fetchone()
        if brow is None:
            return None
        booking = dict(brow)

        prows = conn.execute(
            "SELECT passenger_id, name, age, gender "
            "FROM passengers WHERE booking_id = ?;",
            (booking["booking_id"],),
        ).fetchall()
        booking["passengers"] = [dict(r) for r in prows]
    finally:
        conn.close()

    return booking


def get_bookings_by_email(email: str) -> list[dict[str, Any]]:
    """Return all bookings for a given e-mail address."""
    conn = sqlite_mod.get_connection()
    try:
        rows = conn.execute(
            "SELECT b.booking_id, b.pnr, b.user_id, b.flight_id, "
            "       b.travel_date, b.passenger_count, b.total_amount, "
            "       b.status, b.booked_via, b.session_id, "
            "       b.hold_expires, b.created_at "
            "FROM bookings b "
            "JOIN users u ON u.user_id = b.user_id "
            "WHERE u.email = ? "
            "ORDER BY b.created_at DESC;",
            (email,),
        ).fetchall()
        bookings = [dict(r) for r in rows]
    finally:
        conn.close()
    return bookings
