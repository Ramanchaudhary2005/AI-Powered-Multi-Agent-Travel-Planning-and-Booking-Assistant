"""Combined flight + hotel single-order checkout."""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from backend.routers.auth import get_current_user, get_optional_user
from backend.schemas import PassengerIn
from backend.services import package_service

router = APIRouter(prefix="/api/packages", tags=["packages"])

class PackageRequest(BaseModel):
    flight_id: int
    travel_date: str
    passengers: list[PassengerIn]
    email: str
    name: str
    phone: str | None = None
    hotel_id: int
    check_in_date: str
    nights: int = Field(ge=1, le=90)
    guests: int = Field(default=1, ge=1, le=20)

class VerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str

@router.post("/book", status_code=201)
def book_package(payload: PackageRequest, user=Depends(get_optional_user)):
    try:
        data = payload.model_dump()
        data["passengers"] = [person.model_dump() for person in payload.passengers]
        data["guest_email"] = data.pop("email")
        data["guest_name"] = data.pop("name")
        return package_service.create_package(**data, user=user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/my")
def my_packages(user=Depends(get_current_user)):
    return package_service.get_my_packages(user["user_id"])

@router.post("/{package_ref}/verify-payment")
def verify_package(package_ref: str, payload: VerifyRequest):
    try:
        package = package_service.verify_package(package_ref, payload.razorpay_order_id, payload.razorpay_payment_id, payload.razorpay_signature)
        package["flight_booking"]["ticket_pdf_url"] = f"/api/bookings/{package['flight_booking']['pnr']}/ticket.pdf"
        package["hotel_booking"]["voucher_pdf_url"] = f"/api/hotel-bookings/{package['hotel_booking']['booking_ref']}/voucher"
        return package
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.get("/{package_ref}")
def get_package(package_ref: str):
    package = package_service.get_package(package_ref)
    if not package:
        raise HTTPException(status_code=404, detail="Package not found.")
    return package
