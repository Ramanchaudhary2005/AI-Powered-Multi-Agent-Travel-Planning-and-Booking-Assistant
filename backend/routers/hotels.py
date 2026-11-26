"""Hotel search, details, and pipeline quality summary endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.services import hotel_service

router = APIRouter(tags=["hotels", "data-quality"])


@router.get("/api/hotels/search")
def search_hotels(
    city: str | None = Query(default=None),
    max_price: float | None = Query(default=None, gt=0, description="Maximum total price per night including exact or estimated tax"),
    min_rating: float | None = Query(default=None, ge=0, le=5),
    star_rating: float | None = Query(default=None, ge=1, le=5, description="Exact star rating"),
    locality: str | None = Query(default=None),
    nights: int = Query(default=1, ge=1, le=90),
    sort_by: str = Query(default="recommended", pattern="^(recommended|price_asc|price_desc|rating_desc)$"),
    limit: int = Query(default=20, ge=1, le=100),
):
    try:
        return hotel_service.search_hotels(
            city=city, max_price=max_price, min_rating=min_rating,
            star_rating=star_rating, locality=locality, nights=nights,
            sort_by=sort_by, limit=limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Hotel inventory unavailable: {exc}") from exc


@router.get("/api/hotels/{hotel_id}")
def get_hotel(hotel_id: int):
    try:
        hotel = hotel_service.get_hotel(hotel_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Hotel inventory unavailable: {exc}") from exc
    if hotel is None:
        raise HTTPException(status_code=404, detail="Hotel not found")
    return hotel


@router.get("/api/data-quality/summary")
def get_data_quality_summary():
    try:
        return hotel_service.get_data_quality_summary()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Unable to read data quality report") from exc

