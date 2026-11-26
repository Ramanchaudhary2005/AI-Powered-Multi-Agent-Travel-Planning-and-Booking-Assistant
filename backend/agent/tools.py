"""
Agent tools — 9 Gemini function-declarations + dispatcher.

Each tool wraps the corresponding ``backend/services/`` function.
``create_booking`` and ``create_payment_order`` are guarded by budget_guard.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any

from google.genai import types

from backend.agent import budget_guard
from backend.db import duck, sqlite as sqlite_mod
from backend.services import (
    booking_service,
    flight_service,
    hotel_service,
    ml_service,
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

_set_budget_cap = types.FunctionDeclaration(
    name="set_budget_cap",
    description=(
        "Set or clear this active session's maximum total spend in Indian Rupees. "
        "Call immediately when the user states or changes their budget; use 0 to clear it."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "amount_inr": types.Schema(
                type=types.Type.NUMBER,
                description="Budget cap in INR; 0 clears the cap.",
            ),
        },
        required=["amount_inr"],
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

_search_hotels = types.FunctionDeclaration(
    name="search_hotels",
    description=(
        "Search curated hotels in Delhi, Mumbai, Bangalore, Kolkata, Hyderabad, "
        "or Chennai. Prices include the listed tax or a clearly disclosed GST estimate."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "city": types.Schema(type=types.Type.STRING, enum=CITIES),
            "max_price_per_night": types.Schema(type=types.Type.NUMBER, description="Maximum total INR per night, including tax"),
            "min_rating": types.Schema(type=types.Type.NUMBER, description="Minimum guest rating from 0 to 5"),
            "star_rating": types.Schema(type=types.Type.NUMBER, description="Exact hotel star rating from 1 to 5"),
            "locality": types.Schema(type=types.Type.STRING, description="Optional locality, hotel, or landmark text"),
            "nights": types.Schema(type=types.Type.INTEGER, description="Number of nights, default 1"),
            "limit": types.Schema(type=types.Type.INTEGER, description="Maximum hotels to return, default 10"),
        },
        required=["city"],
    ),
)

_rank_hotels = types.FunctionDeclaration(
    name="rank_hotels",
    description=(
        "Rank curated hotels by balanced value, cheapest total stay, or highest rating. "
        "Can constrain the full stay total to a remaining hotel budget."
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "city": types.Schema(type=types.Type.STRING, enum=CITIES),
            "nights": types.Schema(type=types.Type.INTEGER, description="Number of nights, default 1"),
            "max_total_stay_budget": types.Schema(type=types.Type.NUMBER, description="Maximum INR for the full hotel stay"),
            "priority": types.Schema(type=types.Type.STRING, enum=["balanced", "cheapest", "top_rated"]),
            "min_rating": types.Schema(type=types.Type.NUMBER),
            "star_rating": types.Schema(type=types.Type.NUMBER, description="Exact hotel star rating, e.g. 4 means exactly 4-star"),
            "limit": types.Schema(type=types.Type.INTEGER, description="Maximum hotels to return, default 3 and never more than 5"),
        },
        required=["city"],
    ),
)

_predict_fare_timing = types.FunctionDeclaration(
    name="predict_fare_timing",
    description=("Use the trained fare model to estimate a flight's fair fare and advise whether to book now or wait."),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "source_city": types.Schema(type=types.Type.STRING, enum=CITIES),
            "destination_city": types.Schema(type=types.Type.STRING, enum=CITIES),
            "airline": types.Schema(type=types.Type.STRING),
            "flight_class": types.Schema(type=types.Type.STRING, enum=CLASSES),
            "days_left": types.Schema(type=types.Type.INTEGER, description="Days until departure, 1 to 49"),
            "current_price": types.Schema(type=types.Type.NUMBER, description="Current fare per passenger in INR"),
            "stops_count": types.Schema(type=types.Type.INTEGER, description="Number of stops, usually 0, 1, or 2"),
            "duration_hrs": types.Schema(type=types.Type.NUMBER, description="Flight duration in hours"),
        },
        required=["source_city", "destination_city", "airline", "flight_class", "days_left", "current_price"],
    ),
)

GEMINI_TOOL = types.Tool(
    function_declarations=[
        _search_flights,
        _rank_flights,
        _find_alternatives,
        _create_booking,
        _create_payment_order,
        _set_budget_cap,
        _search_hotels,
        _rank_hotels,
        _predict_fare_timing,
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

    if name == "set_budget_cap":
        if session_id is None:
            return {"error": "An active session is required to set a budget."}
        raw_amount = args.get("amount_inr")
        amount = None if raw_amount is None or float(raw_amount) == 0 else float(raw_amount)
        if amount is not None and amount < 0:
            return {"error": "Budget cap must be zero or a positive INR amount."}
        conn = sqlite_mod.get_connection()
        try:
            cur = conn.execute(
                "UPDATE agent_sessions SET budget = ? WHERE session_id = ? AND status = 'ACTIVE'",
                (amount, session_id),
            )
            if cur.rowcount == 0:
                return {"error": "Active session not found."}
            conn.commit()
        finally:
            conn.close()
        context["budget_cap"] = amount
        return {"budget_cap": amount}

    if name == "search_hotels":
        result = hotel_service.search_hotels(
            city=args["city"],
            max_price=args.get("max_price_per_night"),
            min_rating=args.get("min_rating"),
            star_rating=args.get("star_rating"),
            locality=args.get("locality"),
            nights=int(args.get("nights", 1)),
            limit=int(args.get("limit", 10)),
        )
        context["last_hotel_results"] = result["hotels"]
        return result

    if name == "rank_hotels":
        result = hotel_service.rank_hotels(
            city=args["city"],
            nights=int(args.get("nights", 1)),
            max_total_stay_budget=args.get("max_total_stay_budget"),
            priority=args.get("priority", "balanced"),
            min_rating=args.get("min_rating"),
            star_rating=args.get("star_rating"),
            limit=int(args.get("limit", 3)),
        )
        context["last_hotel_results"] = result["hotels"]
        return result

    if name == "predict_fare_timing":
        return ml_service.predict_fare_timing(
            source_city=args["source_city"], destination_city=args["destination_city"],
            airline=args["airline"], flight_class=args.get("flight_class", "Economy"),
            days_left=int(args["days_left"]), current_price=float(args["current_price"]),
            stops_count=int(args.get("stops_count", 0)), duration_hrs=float(args.get("duration_hrs", 2.2)),
        )

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
        for flight in results:
            flight["travel_date"] = args["travel_date"]
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
        for flight in result.get("flights", []):
            flight["travel_date"] = args["travel_date"]
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
        user_context = context.get("user_context") or {}
        if user_context:
            args["email"] = args.get("email") or user_context.get("email")
            args["name"] = args.get("name") or user_context.get("name") or user_context.get("first_middle_name")
            args["phone"] = args.get("phone") or user_context.get("mobile_number")
            companions = user_context.get("co_travellers", [])
            for passenger in passengers:
                requested = str(passenger.get("name") or "").strip().lower()
                primary_name = str(user_context.get("name") or user_context.get("first_middle_name") or "").strip()
                if requested in {"me", "myself", "self", "primary user"} or (primary_name and primary_name.lower() in requested):
                    passenger["name"] = primary_name or passenger.get("name")
                    if user_context.get("age") is not None:
                        passenger["age"] = user_context["age"]
                    if user_context.get("gender"):
                        passenger["gender"] = {"Male": "M", "Female": "F"}.get(user_context["gender"], user_context["gender"])
                    continue
                relationship_aliases = {
                    "spouse": ("wife", "husband", "partner"),
                    "child": ("son", "daughter", "kid"),
                    "parent": ("mother", "father", "mom", "dad"),
                    "sibling": ("brother", "sister"),
                }
                match = next((companion for companion in companions if (
                    (companion.get("first_middle_name") or "").lower() in requested
                    or " ".join(filter(None, [companion.get("first_middle_name"), companion.get("last_name")])).lower() in requested
                    or (bool(companion.get("relationship")) and companion["relationship"].lower() in requested)
                    or any(alias in requested for alias in relationship_aliases.get((companion.get("relationship") or "").lower(), ()))
                )), None)
                if match:
                    passenger["name"] = " ".join(filter(None, [match.get("first_middle_name"), match.get("last_name")]))
                    if match.get("gender"):
                        gender = match["gender"]
                        passenger["gender"] = {"Male": "M", "Female": "F"}.get(gender, gender)
                    if match.get("age") is not None:
                        passenger["age"] = match["age"]
                    elif match.get("dob"):
                        try:
                            born = date.fromisoformat(match["dob"])
                            today = date.today()
                            passenger["age"] = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
                        except ValueError:
                            pass
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
