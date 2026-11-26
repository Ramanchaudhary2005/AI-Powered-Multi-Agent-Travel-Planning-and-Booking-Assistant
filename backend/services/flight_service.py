"""
flight_service — search, meta, single-flight lookup, and alternatives.

Every public function that returns flight rows attaches ``live_seats_left``
computed by subtracting active bookings (CONFIRMED + unexpired
PENDING_PAYMENT) from the DuckDB ``seats_available`` baseline.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from backend.db import duck, sqlite as sqlite_mod

# ── Constants ────────────────────────────────────────────────────────────

CITIES = ["Delhi", "Mumbai", "Bangalore", "Kolkata", "Hyderabad", "Chennai"]
DEPARTURE_TIMES = ["Early_Morning", "Morning", "Afternoon", "Evening", "Night", "Late_Night"]
STOPS = ["zero", "one", "two_or_more"]
CLASSES = ["Economy", "Business"]

_FLIGHT_COLUMNS = (
    "flight_id, airline, flight_code, source_city, destination_city, "
    "departure_time, arrival_time, dep_clock, arr_clock, stops, stops_count, "
    '"class" AS travel_class, duration_hrs, days_left, price, seats_available'
)


# ── Helpers ──────────────────────────────────────────────────────────────

def get_meta() -> dict[str, list[str]]:
    return {
        "cities": CITIES,
        "departure_times": DEPARTURE_TIMES,
        "stops": STOPS,
        "classes": CLASSES,
    }


def resolve_days_left(travel_date: str) -> int:
    """Convert *YYYY-MM-DD* → ``days_left``; raise if out of range."""
    td = date.fromisoformat(travel_date)
    days = (td - date.today()).days
    if days < 1 or days > 49:
        raise ValueError(
            f"travel_date must be between 1 and 49 days from today (got {days})."
        )
    return days


def expire_stale_holds() -> None:
    """Mark overdue PENDING_PAYMENT bookings as EXPIRED."""
    now_utc = datetime.now(timezone.utc).isoformat()
    conn = sqlite_mod.get_connection()
    try:
        conn.execute(
            "UPDATE bookings SET status = 'EXPIRED' "
            "WHERE status = 'PENDING_PAYMENT' AND hold_expires < ?;",
            (now_utc,),
        )
        conn.commit()
    finally:
        conn.close()


def _booked_seats(flight_ids: list[int], travel_date: str) -> dict[int, int]:
    """
    Return ``{flight_id: total_booked_passengers}`` for active bookings.
    Active = CONFIRMED or unexpired PENDING_PAYMENT.
    """
    if not flight_ids:
        return {}
    conn = sqlite_mod.get_connection()
    try:
        placeholders = ",".join("?" for _ in flight_ids)
        now_utc = datetime.now(timezone.utc).isoformat()
        rows = conn.execute(
            f"SELECT flight_id, SUM(passenger_count) "
            f"FROM bookings "
            f"WHERE flight_id IN ({placeholders}) "
            f"  AND travel_date = ? "
            f"  AND (status = 'CONFIRMED' "
            f"       OR (status = 'PENDING_PAYMENT' AND hold_expires >= ?)) "
            f"GROUP BY flight_id;",
            [*flight_ids, travel_date, now_utc],
        ).fetchall()
        return {r[0]: r[1] for r in rows}
    finally:
        conn.close()


def _rows_to_dicts(cursor) -> list[dict[str, Any]]:
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, row)) for row in cursor.fetchall()]


def _attach_live_seats(
    flights: list[dict], travel_date: str, min_passengers: int = 1
) -> list[dict]:
    """Add ``live_seats_left`` and filter out flights with insufficient seats."""
    ids = [f["flight_id"] for f in flights]
    booked = _booked_seats(ids, travel_date)
    out: list[dict] = []
    for f in flights:
        f["live_seats_left"] = f["seats_available"] - booked.get(f["flight_id"], 0)
        if f["live_seats_left"] >= min_passengers:
            out.append(f)
    return out


# ── Public API ───────────────────────────────────────────────────────────

def search_flights(
    source_city: str,
    destination_city: str,
    travel_date: str,
    travel_class: str,
    passengers: int = 1,
    max_price: int | None = None,
    stops: str | None = None,
    departure_time: str | None = None,
) -> list[dict[str, Any]]:
    """
    Return up to 50 matching flights sorted by price ASC with live seat counts.
    """
    expire_stale_holds()
    days_left = resolve_days_left(travel_date)

    where = 'source_city = ? AND destination_city = ? AND days_left = ? AND "class" = ?'
    params: list[Any] = [source_city, destination_city, days_left, travel_class]

    if max_price is not None:
        where += " AND price <= ?"
        params.append(max_price)
    if stops is not None:
        where += " AND stops = ?"
        params.append(stops)
    if departure_time is not None:
        where += " AND departure_time = ?"
        params.append(departure_time)

    con = duck.get_connection()
    try:
        cur = con.execute(
            f"SELECT {_FLIGHT_COLUMNS} FROM flights "
            f"WHERE {where} ORDER BY price ASC LIMIT 200;",
            params,
        )
        flights = _rows_to_dicts(cur)
    finally:
        con.close()

    flights = _attach_live_seats(flights, travel_date, passengers)
    # Advisory-only model enrichment. Missing/corrupt artifacts never block search.
    from backend.services.ml_service import attach_price_signals
    flights = attach_price_signals(flights)
    return flights[:50]


def get_flight_by_id(flight_id: int, travel_date: str) -> dict[str, Any] | None:
    """Return a single flight with live seats, or ``None``."""
    expire_stale_holds()
    con = duck.get_connection()
    try:
        cur = con.execute(
            f"SELECT {_FLIGHT_COLUMNS} FROM flights WHERE flight_id = ?;",
            [flight_id],
        )
        rows = _rows_to_dicts(cur)
    finally:
        con.close()
    if not rows:
        return None
    flight = rows[0]
    enriched = _attach_live_seats([flight], travel_date, min_passengers=0)
    return enriched[0] if enriched else None


def find_alternatives(
    source_city: str,
    destination_city: str,
    travel_date: str,
    travel_class: str,
    passengers: int = 1,
    max_price: int | None = None,
    stops: str | None = None,
    departure_time: str | None = None,
) -> dict[str, Any]:
    """
    Three-step relaxation ladder.  Returns ``{flights, total, relaxed_fields, explanation}``.
    """
    relaxed: list[str] = []
    explanations: list[str] = []

    # Step 0 — exact search (already done by caller, but we redo for safety)
    results = search_flights(
        source_city, destination_city, travel_date, travel_class,
        passengers, max_price, stops, departure_time,
    )
    if results:
        return _alt_response(results, relaxed, explanations)

    # Step 1 — relax days_left ± 2
    days_left_orig = resolve_days_left(travel_date)
    lo = max(1, days_left_orig - 2)
    hi = min(49, days_left_orig + 2)
    relaxed.append("days_left")
    explanations.append(f"Expanded date window to {lo}–{hi} days before departure")

    results = _search_days_range(
        source_city, destination_city, lo, hi, travel_class,
        passengers, travel_date, max_price, stops, departure_time,
    )
    if results:
        return _alt_response(results, relaxed, explanations)

    # Step 2 — also relax stops
    relaxed.append("stops")
    explanations.append("Removed stops filter")
    results = _search_days_range(
        source_city, destination_city, lo, hi, travel_class,
        passengers, travel_date, max_price, None, departure_time,
    )
    if results:
        return _alt_response(results, relaxed, explanations)

    # Step 3 — also relax class (Business → Economy)
    alt_class = "Economy" if travel_class == "Business" else travel_class
    if alt_class != travel_class:
        relaxed.append("class")
        explanations.append(f"Switched class from {travel_class} to {alt_class}")
        results = _search_days_range(
            source_city, destination_city, lo, hi, alt_class,
            passengers, travel_date, max_price, None, departure_time,
        )

    return _alt_response(results, relaxed, explanations)


# ── find_alternatives helpers ────────────────────────────────────────────

def _search_days_range(
    source_city: str,
    destination_city: str,
    days_lo: int,
    days_hi: int,
    travel_class: str,
    passengers: int,
    travel_date: str,
    max_price: int | None,
    stops: str | None,
    departure_time: str | None,
) -> list[dict]:
    where = (
        'source_city = ? AND destination_city = ? '
        'AND days_left BETWEEN ? AND ? AND "class" = ?'
    )
    params: list[Any] = [source_city, destination_city, days_lo, days_hi, travel_class]

    if max_price is not None:
        where += " AND price <= ?"
        params.append(max_price)
    if stops is not None:
        where += " AND stops = ?"
        params.append(stops)
    if departure_time is not None:
        where += " AND departure_time = ?"
        params.append(departure_time)

    con = duck.get_connection()
    try:
        cur = con.execute(
            f"SELECT {_FLIGHT_COLUMNS} FROM flights "
            f"WHERE {where} ORDER BY price ASC LIMIT 200;",
            params,
        )
        flights = _rows_to_dicts(cur)
    finally:
        con.close()

    return _attach_live_seats(flights, travel_date, passengers)[:50]


def _alt_response(
    flights: list[dict], relaxed: list[str], explanations: list[str]
) -> dict[str, Any]:
    return {
        "flights": flights,
        "total": len(flights),
        "relaxed_fields": relaxed,
        "explanation": "; ".join(explanations) if explanations else "Exact match found.",
    }
