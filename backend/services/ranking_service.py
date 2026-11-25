"""
ranking_service — min-max weighted scorer with badges.

Pure Python; no LLM calls.
"""

from __future__ import annotations

from typing import Any


_STOPS_PENALTY = {0: 0.0, 1: 0.5, 2: 1.0}


def _minmax(vals: list[float]) -> tuple[float, float]:
    lo, hi = min(vals), max(vals)
    return (lo, hi)


def _norm(val: float, lo: float, hi: float) -> float:
    if hi == lo:
        return 0.0
    return (val - lo) / (hi - lo)


def rank_flights(
    flights: list[dict[str, Any]],
    preferred_departure_time: str | None = None,
) -> dict[str, Any]:
    """
    Score each flight and return ``{best_pick, top_3}`` with badges.

    ``score = 0.45 * price_norm + 0.30 * duration_norm
              + 0.15 * stops_penalty + 0.10 * time_penalty``
    """
    if not flights:
        raise ValueError("Cannot rank an empty flight list.")

    prices = [f["price"] for f in flights]
    durations = [f["duration_hrs"] for f in flights]
    p_lo, p_hi = _minmax(prices)
    d_lo, d_hi = _minmax(durations)

    scored: list[dict[str, Any]] = []
    for f in flights:
        price_n = _norm(f["price"], p_lo, p_hi)
        dur_n = _norm(f["duration_hrs"], d_lo, d_hi)
        stops_p = _STOPS_PENALTY.get(f["stops_count"], 1.0)
        time_p = (
            0.0
            if preferred_departure_time and f["departure_time"] == preferred_departure_time
            else 0.5
        )
        score = 0.45 * price_n + 0.30 * dur_n + 0.15 * stops_p + 0.10 * time_p
        entry = {**f, "score": round(score, 6), "badge": None}
        scored.append(entry)

    # Sort by composite score
    scored.sort(key=lambda x: x["score"])

    # Identify badge winners
    cheapest = min(scored, key=lambda x: x["price"])
    fastest = min(scored, key=lambda x: x["duration_hrs"])
    best = scored[0]  # lowest score

    best["badge"] = "Best Overall"
    cheapest["badge"] = cheapest.get("badge") or "Cheapest"
    fastest["badge"] = fastest.get("badge") or "Fastest"

    # Build deduplicated top-3
    seen_ids: set[int] = set()
    top_3: list[dict] = []
    for candidate in [best, cheapest, fastest]:
        if candidate["flight_id"] not in seen_ids:
            seen_ids.add(candidate["flight_id"])
            top_3.append(candidate)
    # Fill remaining slots from scored list
    for s in scored:
        if len(top_3) >= 3:
            break
        if s["flight_id"] not in seen_ids:
            seen_ids.add(s["flight_id"])
            top_3.append(s)

    return {"best_pick": best, "top_3": top_3[:3]}
