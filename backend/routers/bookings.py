"""
Bookings router — create, lookup by PNR / email, download PDF ticket.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from backend.schemas import BookingOut, BookingRequest
from backend.services import booking_service, ticket_service

router = APIRouter(prefix="/api/bookings", tags=["bookings"])


@router.post("", response_model=BookingOut, status_code=201)
def create_booking(req: BookingRequest):
    try:
        booking = booking_service.create_booking(
            flight_id=req.flight_id,
            travel_date=req.travel_date,
            passengers=[p.model_dump() for p in req.passengers],
            email=req.email,
            name=req.name,
            phone=req.phone,
            booked_via=req.booked_via,
            session_id=req.session_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return booking


@router.get("", response_model=list[BookingOut])
def list_bookings(email: str = Query(...)):
    return booking_service.get_bookings_by_email(email)


@router.get("/{pnr}", response_model=BookingOut)
def get_booking(pnr: str):
    booking = booking_service.get_booking_by_pnr(pnr.upper())
    if booking is None:
        raise HTTPException(status_code=404, detail="Booking not found.")
    return booking


@router.get("/{pnr}/ticket.pdf")
def download_ticket(pnr: str):
    try:
        pdf_bytes = ticket_service.generate_ticket(pnr.upper())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="ticket_{pnr.upper()}.pdf"'},
    )
