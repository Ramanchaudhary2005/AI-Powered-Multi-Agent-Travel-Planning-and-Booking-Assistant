"""Read and rank the curated hotel inventory in the DuckDB flight catalog."""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR
from backend.db import duck

REPORT_PATH = ROOT_DIR / "data" / "curated" / "data_quality_report.json"
HOTEL_CITIES = ["Delhi", "Mumbai", "Bangalore", "Kolkata", "Hyderabad", "Chennai"]


def _rows(cursor) -> list[dict[str, Any]]:
    columns = [item[0] for item in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _city_median_price(city: str | None) -> float | None:
    if not city:
        return None
    hotels = _fetch_hotels(city)
    prices = sorted(float(hotel["price_inr"]) for hotel in hotels)
    if not prices:
        return None
    mid = len(prices) // 2
    return prices[mid] if len(prices) % 2 else (prices[mid - 1] + prices[mid]) / 2


def _score_rows(hotels: list[dict[str, Any]], city_median_price: float | None = None) -> list[dict[str, Any]]:
    if not hotels:
        return hotels
    prices = [float(hotel["total_price_per_night_inr"]) for hotel in hotels]
    min_price, max_price = min(prices), max(prices)
    max_reviews = max((int(hotel.get("reviews") or 0) for hotel in hotels), default=0)
    max_distance = max((float(hotel["distance_to_landmark_km"]) for hotel in hotels
                        if hotel.get("distance_to_landmark_km") is not None), default=0.0)
    ratings = [float(hotel["rating"]) for hotel in hotels if hotel.get("rating") is not None]
    max_rating = max(ratings, default=5.0)
    med_price = city_median_price if city_median_price is not None else sorted(prices)[len(prices) // 2] if len(prices) % 2 else (
        sorted(prices)[len(prices) // 2 - 1] + sorted(prices)[len(prices) // 2]
    ) / 2

    for hotel in hotels:
        price = float(hotel["total_price_per_night_inr"])
        price_score = 1.0 if max_price == min_price else (max_price - price) / (max_price - min_price)
        rating = hotel.get("rating")
        rating_score = max(0.0, min(1.0, float(rating) / 5.0)) if rating is not None else 0.5
        reviews = max(0, int(hotel.get("reviews") or 0))
        review_score = math.log1p(reviews) / math.log1p(max_reviews) if max_reviews else 0.0
        stars = hotel.get("star_rating")
        star_score = max(0.0, min(1.0, float(stars) / 5.0)) if stars is not None else 0.5

        # Omit the location component when distance is unavailable, then renormalize.
        components = [
            (0.36, price_score), (0.30, rating_score),
            (0.12, review_score), (0.16, star_score),
        ]
        distance = hotel.get("distance_to_landmark_km")
        if distance is not None:
            distance_score = 1.0 if max_distance <= 0 else 1.0 - min(float(distance), max_distance) / max_distance
            components.append((0.06, distance_score))
        weight_total = sum(weight for weight, _ in components)
        hotel["value_score"] = round(100 * sum(weight * score for weight, score in components) / weight_total, 1)

        explanation = []
        if rating is not None:
            explanation.append(f"{float(rating):.1f}★ rated")
        if distance is not None:
            landmark = hotel.get("nearest_landmark") or "a landmark"
            explanation.append(f"{float(distance):g} km from {landmark}")
        if med_price:
            delta_pct = round(abs(float(hotel["price_inr"]) - med_price) / med_price * 100)
            comparison = "below" if float(hotel["price_inr"]) < med_price else "above"
            if delta_pct:
                explanation.append(f"{delta_pct}% {comparison} city median")
        hotel["explanation"] = " • ".join(explanation) or "Curated hotel listing"
        tax_rate = 12 if float(hotel["price_inr"]) <= 7500 else 18
        hotel["tax_disclosure"] = (
            f"GST estimated at {tax_rate}%" if hotel.get("tax_is_estimated")
            else "Tax amount supplied by the source listing"
        )
        hotel["badge"] = None

    # Set distinct, data-backed highlights when possible.
    ranked = sorted(hotels, key=lambda h: (-h["value_score"], h["total_price_per_night_inr"], h["hotel_name"].casefold()))
    ranked[0]["badge"] = "Best Overall"
    unbadged = [hotel for hotel in hotels if hotel["badge"] is None]
    if unbadged:
        min(unbadged, key=lambda h: (h["total_price_per_night_inr"], h["hotel_name"].casefold()))["badge"] = "Best Value"
    unbadged = [hotel for hotel in hotels if hotel["badge"] is None and hotel.get("rating") is not None]
    if unbadged:
        max(unbadged, key=lambda h: (h["rating"], h.get("reviews") or 0, h["hotel_name"].casefold()))["badge"] = "Top Rated"
    unbadged = [hotel for hotel in hotels if hotel["badge"] is None]
    if unbadged:
        min(unbadged, key=lambda h: (h["price_inr"], h["hotel_name"].casefold()))["badge"] = "Budget Pick"
    return hotels


def _fetch_hotels(city: str | None = None, min_rating: float | None = None,
                  star_rating: float | None = None, locality: str | None = None) -> list[dict[str, Any]]:
    clauses: list[str] = []
    params: list[Any] = []
    if city:
        clauses.append("lower(city) = lower(?)")
        params.append(city.strip())
    if min_rating is not None:
        clauses.append("rating >= ?")
        params.append(min_rating)
    if star_rating is not None:
        clauses.append("star_rating >= ?")
        params.append(star_rating)
    if locality:
        clauses.append("(lower(location) LIKE lower(?) OR lower(hotel_name) LIKE lower(?) OR lower(coalesce(nearest_landmark, '')) LIKE lower(?))")
        pattern = f"%{locality.strip()}%"
        params.extend((pattern, pattern, pattern))
    sql = "SELECT * FROM hotels"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY hotel_id"
    con = duck.get_connection()
    try:
        return _rows(con.execute(sql, params))
    finally:
        con.close()


def _stay_total(hotel: dict[str, Any], nights: int) -> dict[str, Any]:
    result = dict(hotel)
    result["nights"] = nights
    result["stay_total_inr"] = round(float(hotel["total_price_per_night_inr"]) * nights, 2)
    return result


def search_hotels(city: str | None = None, max_price: float | None = None,
                  min_rating: float | None = None, star_rating: float | None = None,
                  locality: str | None = None, nights: int = 1,
                  sort_by: str = "recommended", limit: int = 20) -> dict[str, Any]:
    if nights < 1:
        raise ValueError("nights must be at least 1")
    if sort_by not in {"recommended", "price_asc", "price_desc", "rating_desc"}:
        raise ValueError("sort_by must be recommended, price_asc, price_desc, or rating_desc")
    hotels = _score_rows(_fetch_hotels(city, min_rating, star_rating, locality), _city_median_price(city))
    if max_price is not None:
        hotels = [h for h in hotels if float(h["total_price_per_night_inr"]) <= max_price]
    for hotel in hotels:
        hotel["nights"] = nights
        hotel["stay_total_inr"] = round(float(hotel["total_price_per_night_inr"]) * nights, 2)
    orderings = {
        "recommended": lambda h: (-h["value_score"], h["total_price_per_night_inr"], h["hotel_name"].casefold()),
        "price_asc": lambda h: (h["total_price_per_night_inr"], -h["value_score"], h["hotel_name"].casefold()),
        "price_desc": lambda h: (-h["total_price_per_night_inr"], -h["value_score"], h["hotel_name"].casefold()),
        "rating_desc": lambda h: (-(h.get("rating") if h.get("rating") is not None else -1), -(h.get("reviews") or 0), h["hotel_name"].casefold()),
    }
    hotels.sort(key=orderings[sort_by])
    return {"city": city, "nights": nights, "total": len(hotels), "hotels": hotels[:limit]}


def rank_hotels(city: str, nights: int = 1, max_total_stay_budget: float | None = None,
                priority: str = "balanced", min_rating: float | None = None,
                star_rating: float | None = None, limit: int = 5) -> dict[str, Any]:
    if nights < 1:
        raise ValueError("nights must be at least 1")
    if priority not in {"balanced", "cheapest", "top_rated"}:
        raise ValueError("priority must be balanced, cheapest, or top_rated")
    hotels = _score_rows(_fetch_hotels(city, min_rating, star_rating), _city_median_price(city))
    for hotel in hotels:
        hotel["nights"] = nights
        hotel["stay_total_inr"] = round(float(hotel["total_price_per_night_inr"]) * nights, 2)
    if max_total_stay_budget is not None:
        hotels = [h for h in hotels if h["stay_total_inr"] <= max_total_stay_budget]
    if priority == "cheapest":
        hotels.sort(key=lambda h: (h["stay_total_inr"], -h["value_score"], h["hotel_name"].casefold()))
    elif priority == "top_rated":
        hotels.sort(key=lambda h: (-(h.get("rating") if h.get("rating") is not None else -1), -(h.get("reviews") or 0), -h["value_score"]))
    else:
        hotels.sort(key=lambda h: (-h["value_score"], h["stay_total_inr"], h["hotel_name"].casefold()))
    return {
        "city": city, "nights": nights, "priority": priority,
        "max_total_stay_budget": max_total_stay_budget,
        "total": len(hotels), "hotels": hotels[:limit],
    }


def get_hotel(hotel_id: int) -> dict[str, Any] | None:
    con = duck.get_connection()
    try:
        rows = _rows(con.execute("SELECT * FROM hotels WHERE hotel_id = ?", [hotel_id]))
    finally:
        con.close()
    if not rows:
        return None
    return _score_rows(rows, _city_median_price(rows[0]["city"]))[0]


def get_data_quality_summary() -> dict[str, Any]:
    if not REPORT_PATH.is_file():
        raise FileNotFoundError("Data quality report is not available. Run scripts/etl_and_validate.py first.")
    return json.loads(REPORT_PATH.read_text(encoding="utf-8"))

