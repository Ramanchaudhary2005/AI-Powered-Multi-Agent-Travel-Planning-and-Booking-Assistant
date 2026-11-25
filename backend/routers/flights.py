"""
Flights router — meta, search, single-flight lookup.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.schemas import (
    FlightMeta,
    FlightOut,
    FlightSearchRequest,
    FlightSearchResponse,
)
from backend.services import flight_service

router = APIRouter(prefix="/api/flights", tags=["flights"])


@router.get("/meta", response_model=FlightMeta)
def meta():
    return flight_service.get_meta()


@router.post("/search", response_model=FlightSearchResponse)
def search(req: FlightSearchRequest):
    try:
        flights = flight_service.search_flights(
            source_city=req.source_city,
            destination_city=req.destination_city,
            travel_date=req.travel_date,
            travel_class=req.travel_class,
            passengers=req.passengers,
            max_price=req.max_price,
            stops=req.stops,
            departure_time=req.departure_time,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"flights": flights, "total": len(flights)}


@router.get("/{flight_id}", response_model=FlightOut)
def get_flight(flight_id: int, travel_date: str = Query(...)):
    try:
        flight = flight_service.get_flight_by_id(flight_id, travel_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if flight is None:
        raise HTTPException(status_code=404, detail="Flight not found.")
    return flight
