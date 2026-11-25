"""
Pydantic v2 request / response models for the Flight Booking API.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ── Shared / nested ──────────────────────────────────────────────────────

class PassengerIn(BaseModel):
    name: str
    age: int
    gender: str


class PassengerOut(BaseModel):
    passenger_id: int
    name: str
    age: int
    gender: str


# ── Flights ──────────────────────────────────────────────────────────────

class FlightMeta(BaseModel):
    cities: list[str]
    departure_times: list[str]
    stops: list[str]
    classes: list[str]


class FlightSearchRequest(BaseModel):
    source_city: str
    destination_city: str
    travel_date: str                             # YYYY-MM-DD
    travel_class: str                            # Economy | Business
    passengers: int = 1
    max_price: int | None = None
    stops: str | None = None                     # zero | one | two_or_more
    departure_time: str | None = None


class FlightOut(BaseModel):
    flight_id: int
    airline: str
    flight_code: str
    source_city: str
    destination_city: str
    departure_time: str                          # bucket name
    arrival_time: str                            # bucket name
    dep_clock: str                               # HH:MM
    arr_clock: str                               # HH:MM
    stops: str
    stops_count: int
    travel_class: str
    duration_hrs: float
    days_left: int
    price: int
    seats_available: int
    live_seats_left: int


class FlightSearchResponse(BaseModel):
    flights: list[FlightOut]
    total: int


class AlternativesResponse(BaseModel):
    flights: list[FlightOut]
    total: int
    relaxed_fields: list[str]
    explanation: str


# ── Ranking ──────────────────────────────────────────────────────────────

class RankedFlightOut(FlightOut):
    score: float
    badge: str | None = None


class RankingResponse(BaseModel):
    best_pick: RankedFlightOut
    top_3: list[RankedFlightOut]


# ── Bookings ─────────────────────────────────────────────────────────────

class BookingRequest(BaseModel):
    flight_id: int
    travel_date: str                             # YYYY-MM-DD
    passengers: list[PassengerIn]
    email: str
    name: str
    phone: str | None = None
    booked_via: str = "MANUAL"
    session_id: int | None = None


class BookingOut(BaseModel):
    booking_id: int
    pnr: str
    user_id: int
    flight_id: int
    travel_date: str
    passenger_count: int
    total_amount: int
    status: str
    booked_via: str
    hold_expires: str | None = None
    created_at: str
    passengers: list[PassengerOut] = []
    flight: FlightOut | None = None


# ── Payments ─────────────────────────────────────────────────────────────

class PaymentOrderRequest(BaseModel):
    booking_id: int


class PaymentOrderResponse(BaseModel):
    payment_id: int
    booking_id: int
    gateway_order_id: str
    amount: int
    currency: str = "INR"
    status: str
    razorpay_key_id: str | None = None           # frontend needs this


class PaymentVerifyRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class PaymentVerifyResponse(BaseModel):
    payment_id: int
    status: str
    booking_status: str
    pnr: str
