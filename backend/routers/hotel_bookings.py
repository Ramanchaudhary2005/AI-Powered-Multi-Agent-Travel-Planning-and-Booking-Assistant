"""Standalone hotel checkout, booking lookup, and vouchers."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from backend.routers.auth import get_current_user, get_optional_user
from backend.services import hotel_booking_service, hotel_voucher_service

router = APIRouter(prefix="/api/hotel-bookings", tags=["hotel-bookings"])

class HotelBookingRequest(BaseModel):
    hotel_id: int
    check_in_date: str
    nights: int = Field(ge=1, le=90)
    guests: int = Field(default=1, ge=1, le=20)
    guest_name: str
    guest_email: str

class VerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

@router.post("", status_code=201)
def create_booking(payload: HotelBookingRequest, user=Depends(get_optional_user)):
    try:
        booking = hotel_booking_service.create_hotel_booking(**payload.model_dump(), user_id=user["user_id"] if user else None)
        order = hotel_booking_service.create_payment_order(booking["booking_ref"])
        return {"hotel_booking": hotel_booking_service.get_hotel_booking(booking["booking_ref"]), "order": order}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/my")
def my_bookings(user=Depends(get_current_user)):
    return hotel_booking_service.get_my_hotel_bookings(user["user_id"])

@router.post("/{booking_ref}/verify-payment")
def verify_payment(booking_ref: str, payload: VerifyRequest):
    try:
        booking = hotel_booking_service.verify_hotel_payment(booking_ref, payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature)
        # Generate lazily here too, ensuring repeated verification repairs a missing artifact.
        hotel_voucher_service.generate_voucher(booking_ref)
        return {"hotel_booking": booking, "voucher_pdf_url": f"/api/hotel-bookings/{booking_ref}/voucher"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/{booking_ref}/voucher")
def voucher(booking_ref: str):
    try:
        data = hotel_voucher_service.generate_voucher(booking_ref)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="voucher_{booking_ref}.pdf"'})

@router.get("/{booking_ref}")
def get_booking(booking_ref: str):
    booking = hotel_booking_service.get_hotel_booking(booking_ref)
    if not booking:
        raise HTTPException(status_code=404, detail="Hotel booking not found.")
    return booking
