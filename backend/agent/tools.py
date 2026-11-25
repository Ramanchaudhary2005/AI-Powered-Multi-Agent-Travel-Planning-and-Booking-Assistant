"""
Agent tools — 5 Gemini function-declarations + dispatcher.

Each tool wraps the corresponding ``backend/services/`` function.
``create_booking`` and ``create_payment_order`` are guarded by budget_guard.
"""

from __future__ import annotations

import json
from typing import Any

from google.genai import types

from backend.agent import budget_guard
from backend.db import duck, sqlite as sqlite_mod
from backend.services import (
    booking_service,
    flight_service,
    payment_service,
    ranking_service,
)

# ── Enum constants (single source of truth) ──────────────────────────────

CITIES = flight_service.CITIES
DEPARTURE_TIMES = flight_service.DEPARTURE_TIMES
STOPS_ENUM = flight_service.STOPS
CLASSES = flight_service.CLASSES

# ── Gemini FunctionDeclarations ──────────────────────────────────────────

_search_flights = types.FunctionDeclaration(
    name="search_flights",
    description=(
        "Search for available flights between two Indian cities on a given "
        "date.  Returns up to 50 results sorted by price."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "source_city": types.Schema(
                type=types.Type.STRING, enum=CITIES,
                description="Departure city",
            ),
            "destination_city": types.Schema(
                type=types.Type.STRING, enum=CITIES,
                description="Arrival city",
            ),
            "travel_date": types.Schema(
                type=types.Type.STRING,
                description="Travel date in YYYY-MM-DD format",
            ),
            "travel_class": types.Schema(
                type=types.Type.STRING, enum=CLASSES,
                description="Economy or Business",
            ),
            "passengers": types.Schema(
                type=types.Type.INTEGER,
                description="Number of passengers (default 1)",
            ),
            "max_price": types.Schema(
                type=types.Type.INTEGER,
                description="Maximum price per ticket in INR (optional)",
            ),
            "stops": types.Schema(
                type=types.Type.STRING, enum=STOPS_ENUM,
                description="Stops filter (optional)",
            ),
            "departure_time": types.Schema(
                type=types.Type.STRING, enum=DEPARTURE_TIMES,
                description="Preferred departure time slot (optional)",
            ),
        },
        required=["source_city", "destination_city", "travel_date", "travel_class"],
    ),
)

_rank_flights = types.FunctionDeclaration(
    name="rank_flights",
    description=(
        "Rank the most recent search results by a weighted composite score "
        "(price 45 %, duration 30 %, stops 15 %, time-match 10 %).  "
        "Call this AFTER search_flights."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "preferred_departure_time": types.Schema(
                type=types.Type.STRING, enum=DEPARTURE_TIMES,
                description="If set, flights matching this slot get a bonus.",
            ),
        },
    ),
)

_find_alternatives = types.FunctionDeclaration(
    name="find_alternatives",
    description=(
        "Find alternative flights when the primary search returned no results.  "
        "Relaxes constraints in order: dates ± 2 days, stops, class."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "source_city": types.Schema(type=types.Type.STRING, enum=CITIES),
            "destination_city": types.Schema(type=types.Type.STRING, enum=CITIES),
            "travel_date": types.Schema(type=types.Type.STRING, description="YYYY-MM-DD"),
            "travel_class": types.Schema(type=types.Type.STRING, enum=CLASSES),
            "passengers": types.Schema(type=types.Type.INTEGER),
            "max_price": types.Schema(type=types.Type.INTEGER),
            "stops": types.Schema(type=types.Type.STRING, enum=STOPS_ENUM),
            "departure_time": types.Schema(type=types.Type.STRING, enum=DEPARTURE_TIMES),
        },
        required=["source_city", "destination_city", "travel_date", "travel_class"],
    ),
)

_create_booking = types.FunctionDeclaration(
    name="create_booking",
    description=(
        "Hold seats for a flight.  Requires passenger details and user email.  "
        "Creates a 10-minute payment hold.  Budget guard is enforced."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "flight_id": types.Schema(type=types.Type.INTEGER, description="Flight ID from search results"),
            "travel_date": types.Schema(type=types.Type.STRING, description="YYYY-MM-DD"),
            "passengers": types.Schema(
                type=types.Type.ARRAY,
                items=types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "name": types.Schema(type=types.Type.STRING, description="Full name"),
                        "age": types.Schema(type=types.Type.INTEGER, description="Age"),
                        "gender": types.Schema(type=types.Type.STRING, description="M, F, or Other"),
                    },
                    required=["name", "age", "gender"],
                ),
                description="Passenger list",
            ),
            "email": types.Schema(type=types.Type.STRING, description="Contact email"),
            "name": types.Schema(type=types.Type.STRING, description="Primary passenger / booker name"),
            "phone": types.Schema(type=types.Type.STRING, description="Phone number (optional)"),
        },
        required=["flight_id", "travel_date", "passengers", "email", "name"],
    ),
)

_create_payment_order = types.FunctionDeclaration(
    name="create_payment_order",
    description=(
        "Create a Razorpay payment order for a pending booking.  "
        "Budget guard is enforced.  Returns the order ID for checkout."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "booking_id": types.Schema(type=types.Type.INTEGER, description="Booking ID"),
        },
        required=["booking_id"],
    ),
)

GEMINI_TOOL = types.Tool(
    function_declarations=[
        _search_flights,
        _rank_flights,
        _find_alternatives,
        _create_booking,
        _create_payment_order,
    ]
)

# ── Arg conversion helper ────────────────────────────────────────────────

def _convert(val: Any) -> Any:
    """Recursively turn proto-plus / MapComposite into plain Python."""
    if isinstance(val, (str, bool, type(None))):
        return val
    if isinstance(val, float):
        return int(val) if val == int(val) else val
    if isinstance(val, int):
        return val
    if hasattr(val, "items"):
        return {str(k): _convert(v) for k, v in val.items()}
    if hasattr(val, "__iter__"):
        return [_convert(v) for v in val]
    return val


# ── Dispatcher ───────────────────────────────────────────────────────────

def execute(
    name: str,
    raw_args: Any,
    session_id: int | None,
    context: dict,
) -> dict[str, Any]:
    """
    Execute a tool by *name* and return a JSON-serialisable dict.

    ``context`` carries ``last_search_results`` across calls within a turn.
    """
    args = _convert(raw_args) or {}

    if name == "search_flights":
        results = flight_service.search_flights(
            source_city=args["source_city"],
            destination_city=args["destination_city"],
            travel_date=args["travel_date"],
            travel_class=args["travel_class"],
            passengers=int(args.get("passengers", 1)),
            max_price=args.get("max_price"),
            stops=args.get("stops"),
            departure_time=args.get("departure_time"),
        )
        context["last_search_results"] = results
        # Return summary for the LLM (top 10), keep full list in context
        preview = results[:10]
        return {
            "total_results": len(results),
            "showing": len(preview),
            "flights": preview,
        }

    if name == "rank_flights":
        cached = context.get("last_search_results", [])
        if not cached:
            return {"error": "No search results to rank. Call search_flights first."}
        ranked = ranking_service.rank_flights(
            cached,
            preferred_departure_time=args.get("preferred_departure_time"),
        )
        return ranked

    if name == "find_alternatives":
        result = flight_service.find_alternatives(
            source_city=args["source_city"],
            destination_city=args["destination_city"],
            travel_date=args["travel_date"],
            travel_class=args["travel_class"],
            passengers=int(args.get("passengers", 1)),
            max_price=args.get("max_price"),
            stops=args.get("stops"),
            departure_time=args.get("departure_time"),
        )
        context["last_search_results"] = result.get("flights", [])
        preview = result["flights"][:10]
        return {
            "total_results": result["total"],
            "showing": len(preview),
            "flights": preview,
            "relaxed_fields": result["relaxed_fields"],
            "explanation": result["explanation"],
        }

    if name == "create_booking":
        # ── Budget guard ─────────────────────────────────────────────
        flight_id = int(args["flight_id"])
        passengers = args["passengers"]
        dcon = duck.get_connection()
        try:
            row = dcon.execute(
                "SELECT price FROM flights WHERE flight_id = ?;", [flight_id]
            ).fetchone()
        finally:
            dcon.close()
        if row is None:
            return {"error": f"Flight {flight_id} not found."}
        total = row[0] * len(passengers)
        blocked = budget_guard.check(session_id, total)
        if blocked:
            return blocked

        booking = booking_service.create_booking(
            flight_id=flight_id,
            travel_date=args["travel_date"],
            passengers=passengers,
            email=args["email"],
            name=args["name"],
            phone=args.get("phone"),
            booked_via="AGENT",
            session_id=session_id,
        )
        return booking

    if name == "create_payment_order":
        # ── Budget guard ─────────────────────────────────────────────
        booking_id = int(args["booking_id"])
        conn = sqlite_mod.get_connection()
        try:
            brow = conn.execute(
                "SELECT total_amount FROM bookings WHERE booking_id = ?;",
                (booking_id,),
            ).fetchone()
        finally:
            conn.close()
        if brow is None:
            return {"error": f"Booking {booking_id} not found."}
        blocked = budget_guard.check(session_id, brow["total_amount"])
        if blocked:
            return blocked

        order = payment_service.create_order(booking_id)
        return order

    return {"error": f"Unknown tool '{name}'."}
