"""Market insights and ML fare timing endpoints."""
from __future__ import annotations
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from backend.services import ml_service

router = APIRouter(prefix="/api/insights", tags=["insights"])

class FarePredictionRequest(BaseModel):
    source_city: str
    destination_city: str
    airline: str
    flight_class: str = "Economy"
    days_left: int = Field(default=7, ge=1, le=49)
    current_price: float = Field(gt=0)
    stops_count: int = Field(default=0, ge=0)
    duration_hrs: float = Field(default=2.2, gt=0)

@router.post("/predict-fare")
def predict_fare(payload: FarePredictionRequest):
    try:
        return ml_service.predict_fare_timing(**payload.model_dump())
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Fare prediction is temporarily unavailable: {exc}") from exc

@router.get("/market-trends")
def market_trends(source_city: str | None = None, destination_city: str | None = None,
                  flight_class: str = Query(default="Economy", pattern="^(Economy|Business)$"),
                  hotel_city: str = Query(default="Mumbai")):
    try:
        return ml_service.market_trends(source_city,destination_city,flight_class,hotel_city)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Market trend data is temporarily unavailable: {exc}") from exc
