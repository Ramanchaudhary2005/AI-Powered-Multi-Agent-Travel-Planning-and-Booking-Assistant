"""Per-user saved flight snapshots."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.db.sqlite import get_connection
from backend.routers.auth import get_current_user

router = APIRouter(prefix="/api/wishlist", tags=["wishlist"])


class WishlistFlight(BaseModel):
    flight_id: str
    airline: str | None = None
    flight_code: str | None = None
    source_city: str | None = None
    destination_city: str | None = None
    travel_date: str
    flight_class: str | None = None
    price_when_saved: float | None = None
    duration_hrs: float | None = None
    stops: str | None = None


@router.get("")
def get_wishlist(user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        return [dict(row) for row in conn.execute(
            "SELECT * FROM wishlist WHERE user_id=? ORDER BY created_at DESC, id DESC", (user["user_id"],)).fetchall()]
    finally:
        conn.close()


@router.post("", status_code=201)
def add_to_wishlist(payload: WishlistFlight, user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        conn.execute("""INSERT OR IGNORE INTO wishlist
            (user_id,flight_id,airline,flight_code,source_city,destination_city,travel_date,flight_class,
             price_when_saved,duration_hrs,stops,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (user["user_id"], payload.flight_id, payload.airline, payload.flight_code, payload.source_city,
             payload.destination_city, payload.travel_date, payload.flight_class, payload.price_when_saved,
             payload.duration_hrs, payload.stops, datetime.now(timezone.utc).isoformat()))
        conn.commit()
        row = conn.execute("SELECT * FROM wishlist WHERE user_id=? AND flight_id=? AND travel_date=?",
                           (user["user_id"], payload.flight_id, payload.travel_date)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.delete("/{flight_id}")
def remove_from_wishlist(flight_id: str, travel_date: str | None = Query(default=None),
                         user: dict[str, Any] = Depends(get_current_user)):
    conn = get_connection()
    try:
        if travel_date is None:
            cur = conn.execute("DELETE FROM wishlist WHERE user_id=? AND flight_id=?", (user["user_id"], flight_id))
        else:
            cur = conn.execute("DELETE FROM wishlist WHERE user_id=? AND flight_id=? AND travel_date=?",
                               (user["user_id"], flight_id, travel_date))
        conn.commit()
        if not cur.rowcount:
            raise HTTPException(status_code=404, detail="Wishlist flight not found.")
        return {"deleted": True}
    finally:
        conn.close()
