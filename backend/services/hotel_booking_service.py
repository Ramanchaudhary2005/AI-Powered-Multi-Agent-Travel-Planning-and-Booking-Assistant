"""Hotel reservation persistence and payment order helpers."""
from __future__ import annotations

import secrets
import string
from datetime import date, timedelta
from typing import Any

from backend.db import sqlite as sqlite_mod
from backend.services import hotel_service, payment_service


def _ref(prefix: str) -> str:
    return prefix + "-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


def get_hotel_booking(booking_ref: str) -> dict[str, Any] | None:
    conn = sqlite_mod.get_connection()
    try:
        row = conn.execute("SELECT * FROM hotel_bookings WHERE booking_ref=?", (booking_ref,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_hotel_booking(*, hotel_id: int, check_in_date: str, nights: int, guests: int,
                         guest_name: str, guest_email: str, user_id: int | None = None,
                         package_ref: str | None = None, linked_flight_pnr: str | None = None) -> dict[str, Any]:
    if not 1 <= nights <= 90 or not 1 <= guests <= 20:
        raise ValueError("Nights must be 1–90 and guests 1–20.")
    try:
        check_in = date.fromisoformat(check_in_date)
    except ValueError as exc:
        raise ValueError("check_in_date must use YYYY-MM-DD format.") from exc
    if check_in < date.today():
        raise ValueError("Check-in date cannot be in the past.")
    hotel = hotel_service.get_hotel(hotel_id)
    if not hotel:
        raise ValueError(f"Hotel {hotel_id} was not found.")
    per_night = float(hotel["price_inr"])
    tax_per_night = float(hotel.get("tax_inr") if hotel.get("tax_inr") is not None else hotel.get("estimated_tax_inr") or 0)
    tax_estimated = bool(hotel.get("tax_is_estimated"))
    total = round((per_night + tax_per_night) * nights, 2)
    booking_ref = _ref("HTL")
    conn = sqlite_mod.get_connection()
    try:
        cur = conn.execute("""INSERT INTO hotel_bookings
            (booking_ref,user_id,package_ref,linked_flight_pnr,hotel_id,hotel_name,city,location,nearest_landmark,
             star_rating,check_in_date,check_out_date,nights,guests,guest_name,guest_email,price_per_night_inr,
             tax_inr,tax_is_estimated,total_amount_inr,status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING_PAYMENT')""",
            (booking_ref,user_id,package_ref,linked_flight_pnr,hotel_id,hotel["hotel_name"],hotel["city"],
             hotel.get("location"),hotel.get("nearest_landmark"),hotel.get("star_rating"),check_in.isoformat(),
             (check_in+timedelta(days=nights)).isoformat(),nights,guests,guest_name.strip(),guest_email.strip(),
             per_night,tax_per_night,int(tax_estimated),total))
        conn.commit()
    finally:
        conn.close()
    return get_hotel_booking(booking_ref)  # type: ignore[return-value]


def create_payment_order(booking_ref: str) -> dict[str, Any]:
    booking = get_hotel_booking(booking_ref)
    if not booking or booking["status"] != "PENDING_PAYMENT":
        raise ValueError("Pending hotel booking was not found.")
    order = payment_service.create_external_order(booking["total_amount_inr"], booking_ref)
    conn = sqlite_mod.get_connection()
    try:
        conn.execute("UPDATE hotel_bookings SET razorpay_order_id=? WHERE booking_ref=?", (order["gateway_order_id"], booking_ref))
        conn.commit()
    finally:
        conn.close()
    return order


def verify_hotel_payment(booking_ref: str, order_id: str, payment_id: str, signature: str) -> dict[str, Any]:
    booking = get_hotel_booking(booking_ref)
    if not booking:
        raise ValueError("Hotel booking not found.")
    if booking["status"] == "CONFIRMED":
        return booking
    if booking["status"] != "PENDING_PAYMENT" or booking["razorpay_order_id"] != order_id:
        raise ValueError("Payment order does not match a pending hotel booking.")
    payment_service.verify_signature(order_id, payment_id, signature)
    conn = sqlite_mod.get_connection()
    try:
        conn.execute("UPDATE hotel_bookings SET status='CONFIRMED', razorpay_payment_id=? WHERE booking_ref=? AND status='PENDING_PAYMENT'", (payment_id,booking_ref))
        conn.commit()
    finally:
        conn.close()
    return get_hotel_booking(booking_ref)  # type: ignore[return-value]


def get_my_hotel_bookings(user_id: int) -> list[dict[str, Any]]:
    conn = sqlite_mod.get_connection()
    try:
        rows = conn.execute("SELECT * FROM hotel_bookings WHERE user_id=? ORDER BY created_at DESC", (user_id,)).fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()
