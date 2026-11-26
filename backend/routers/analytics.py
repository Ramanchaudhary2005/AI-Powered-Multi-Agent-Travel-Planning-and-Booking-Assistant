"""Personal travel and spending analytics for the authenticated user."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.db import duck, sqlite as sqlite_mod
from backend.routers.auth import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


def _share(amount: float, total: float) -> float:
    return round((amount / total * 100) if total else 0, 1)


@router.get("/my-trips")
def my_trips(scope: str = Query(default="confirmed", pattern="^(confirmed|all)$"),
             user: dict[str, Any] = Depends(get_current_user)):
    """Return per-user trip, route, airline, class, and spend aggregates."""
    conn = sqlite_mod.get_connection()
    try:
        where = "b.user_id = ? AND b.status = 'CONFIRMED'" if scope == "confirmed" else "b.user_id = ? AND b.status != 'CANCELLED'"
        rows = conn.execute(
            "SELECT b.booking_id, b.flight_id, b.travel_date, b.passenger_count, "
            "b.total_amount, b.status, b.booked_via, b.created_at "
            f"FROM bookings b WHERE {where} ORDER BY b.travel_date ASC, b.booking_id ASC",
            (user["user_id"],),
        ).fetchall()
        bookings = [dict(row) for row in rows]
    finally:
        conn.close()

    flight_ids = sorted({int(row["flight_id"]) for row in bookings})
    flights_by_id: dict[int, dict[str, Any]] = {}
    if flight_ids:
        dcon = duck.get_connection()
        try:
            placeholders = ",".join("?" for _ in flight_ids)
            flight_rows = dcon.execute(
                f'SELECT flight_id, airline, source_city, destination_city, "class" AS flight_class '
                f"FROM flights WHERE flight_id IN ({placeholders})",
                flight_ids,
            ).fetchall()
            columns = [description[0] for description in dcon.description]
            flights_by_id = {int(row[0]): dict(zip(columns, row)) for row in flight_rows}
        finally:
            dcon.close()

    trips = []
    for booking in bookings:
        flight = flights_by_id.get(int(booking["flight_id"]), {})
        spend = float(booking["total_amount"] or 0)
        passenger_count = max(1, int(booking["passenger_count"] or 1))
        source = flight.get("source_city") or "Unknown"
        destination = flight.get("destination_city") or "Unknown"
        trips.append({
            **booking,
            "airline": flight.get("airline") or "Unknown",
            "origin": source,
            "destination": destination,
            "flight_class": flight.get("flight_class") or "Unknown",
            "route": f"{source} → {destination}",
            "spend_inr": spend,
            "ticket_fare_inr": spend / passenger_count,
        })

    total_spend = sum(trip["spend_inr"] for trip in trips)
    passenger_total = sum(max(1, int(trip["passenger_count"] or 1)) for trip in trips)
    destinations: dict[str, dict[str, Any]] = defaultdict(lambda: {"trips_count": 0, "total_spend_inr": 0.0})
    routes: dict[str, dict[str, Any]] = {}
    airlines: dict[str, dict[str, Any]] = defaultdict(lambda: {"trips_count": 0, "total_spend_inr": 0.0})
    classes: dict[str, dict[str, Any]] = defaultdict(lambda: {"trips_count": 0, "total_spend_inr": 0.0})
    months: dict[str, dict[str, Any]] = defaultdict(lambda: {"spend_inr": 0.0, "trips_count": 0, "routes": Counter()})
    ticket_fares = []

    for trip in trips:
        destination = trip["destination"]
        destinations[destination]["trips_count"] += 1
        destinations[destination]["total_spend_inr"] += trip["spend_inr"]
        route = trip["route"]
        if route not in routes:
            routes[route] = {"route": route, "origin": trip["origin"], "destination": destination,
                             "trips_count": 0, "total_spend_inr": 0.0}
        routes[route]["trips_count"] += 1
        routes[route]["total_spend_inr"] += trip["spend_inr"]
        airline = trip["airline"]
        airlines[airline]["trips_count"] += 1
        airlines[airline]["total_spend_inr"] += trip["spend_inr"]
        flight_class = trip["flight_class"]
        classes[flight_class]["trips_count"] += 1
        classes[flight_class]["total_spend_inr"] += trip["spend_inr"]
        ticket_fares.append(trip["ticket_fare_inr"])
        month = str(trip["travel_date"] or trip["created_at"] or "")[:7]
        if len(month) == 7:
            months[month]["spend_inr"] += trip["spend_inr"]
            months[month]["trips_count"] += 1
            months[month]["routes"][route] += 1

    destination_items = [
        {"city": city, **data, "total_spend_inr": round(data["total_spend_inr"], 2),
         "share_pct": _share(data["total_spend_inr"], total_spend)}
        for city, data in destinations.items()
    ]
    destination_items.sort(key=lambda item: (-item["trips_count"], -item["total_spend_inr"], item["city"]))
    route_items = sorted(routes.values(), key=lambda item: (-item["trips_count"], -item["total_spend_inr"], item["route"]))[:10]
    for item in route_items:
        item["total_spend_inr"] = round(item["total_spend_inr"], 2)
    airline_items = [
        {"airline": airline, **data, "total_spend_inr": round(data["total_spend_inr"], 2),
         "share_pct": _share(data["total_spend_inr"], total_spend)}
        for airline, data in airlines.items()
    ]
    airline_items.sort(key=lambda item: (-item["total_spend_inr"], item["airline"]))
    class_items = [
        {"flight_class": flight_class, **data, "total_spend_inr": round(data["total_spend_inr"], 2)}
        for flight_class, data in classes.items()
    ]
    class_items.sort(key=lambda item: (-item["total_spend_inr"], item["flight_class"]))

    timeline = []
    for month in sorted(months):
        data = months[month]
        month_route = data["routes"].most_common(1)[0][0] if data["routes"] else ""
        timeline.append({
            "label": date.fromisoformat(f"{month}-01").strftime("%b %Y"),
            "date": f"{month}-01",
            "spend_inr": round(data["spend_inr"], 2),
            "trips_count": data["trips_count"],
            "route": month_route if len(data["routes"]) == 1 else f"{month_route} + {len(data['routes']) - 1} more" if month_route else "",
        })
    trip_spend_series = []
    if trips and len(months) == 1:
        trip_spend_series = [
            {"label": trip["destination"], "date": trip["travel_date"],
             "spend_inr": trip["spend_inr"], "trips_count": 1, "route": trip["route"]}
            for trip in trips
        ]

    destination_counts = Counter({item["city"]: item["trips_count"] for item in destination_items})
    airline_counts = Counter({item["airline"]: item["trips_count"] for item in airline_items})
    summary = {
        "total_spend_inr": round(total_spend, 2),
        "total_trips": len(trips),
        "unique_destinations_count": len(destination_items),
        "unique_cities_visited": [item["city"] for item in destination_items],
        "avg_ticket_price_inr": round(total_spend / passenger_total, 2) if passenger_total else 0,
        "highest_fare_inr": round(max(ticket_fares), 2) if ticket_fares else None,
        "lowest_fare_inr": round(min(ticket_fares), 2) if ticket_fares else None,
        "most_visited_destination": ({"city": destination_counts.most_common(1)[0][0], "count": destination_counts.most_common(1)[0][1]} if destination_counts else None),
        "favourite_airline": ({"airline": airline_counts.most_common(1)[0][0], "count": airline_counts.most_common(1)[0][1]} if airline_counts else None),
    }
    return {
        "scope": scope,
        "summary": summary,
        "spending_timeline": timeline,
        "trip_spend_series": trip_spend_series,
        "destinations_breakdown": destination_items,
        "top_routes": route_items,
        "airline_breakdown": airline_items,
        "class_breakdown": class_items,
    }
