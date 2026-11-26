"""Atomic flight+hotel package checkout and confirmation."""
from __future__ import annotations
import secrets
import string
from typing import Any
from backend.db import sqlite as sqlite_mod
from backend.services import booking_service, flight_service, hotel_booking_service, payment_service, ticket_service, hotel_voucher_service


def _package_ref() -> str:
    return "PKG-" + "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))


def get_package(package_ref: str) -> dict[str, Any] | None:
    conn = sqlite_mod.get_connection()
    try:
        hotel_row = conn.execute("SELECT * FROM hotel_bookings WHERE package_ref=?", (package_ref,)).fetchone()
        if not hotel_row:
            return None
        hotel = dict(hotel_row)
        flight_row = conn.execute("SELECT pnr FROM bookings WHERE package_ref=?", (package_ref,)).fetchone()
    finally:
        conn.close()
    if not flight_row:
        return {"package_ref": package_ref, "hotel_booking": hotel, "flight_booking": None}
    flight = booking_service.get_booking_by_pnr(flight_row["pnr"])
    if flight:
        flight["flight"] = flight_service.get_flight_by_id(flight["flight_id"], flight["travel_date"])
        flight["ticket_pdf_url"] = f"/api/bookings/{flight['pnr']}/ticket.pdf" if flight["status"] == "CONFIRMED" else None
    hotel["voucher_pdf_url"] = f"/api/hotel-bookings/{hotel['booking_ref']}/voucher" if hotel["status"] == "CONFIRMED" else None
    return {"package_ref": package_ref, "status": "CONFIRMED" if hotel["status"] == "CONFIRMED" and flight and flight["status"] == "CONFIRMED" else hotel["status"], "flight_booking": flight, "hotel_booking": hotel}


def create_package(*, flight_id: int, travel_date: str, passengers: list[dict[str, Any]],
                   hotel_id: int, check_in_date: str, nights: int, guests: int,
                   guest_name: str, guest_email: str, phone: str | None = None,
                   user: dict[str, Any] | None = None) -> dict[str, Any]:
    if not passengers:
        raise ValueError("At least one flight passenger is required.")
    package_ref = _package_ref()
    flight_booking = booking_service.create_booking(
        flight_id=flight_id, travel_date=travel_date, passengers=passengers,
        email=(user or {}).get("email") or guest_email,
        name=(user or {}).get("name") or guest_name, phone=phone,
        booked_via="MANUAL", user_id=(user or {}).get("user_id"),
    )
    conn = sqlite_mod.get_connection()
    try:
        conn.execute("UPDATE bookings SET package_ref=? WHERE pnr=?", (package_ref, flight_booking["pnr"]))
        conn.commit()
    finally:
        conn.close()
    try:
        hotel_booking = hotel_booking_service.create_hotel_booking(
            hotel_id=hotel_id, check_in_date=check_in_date, nights=nights, guests=guests,
            guest_name=(user or {}).get("name") or guest_name,
            guest_email=(user or {}).get("email") or guest_email,
            user_id=flight_booking["user_id"], package_ref=package_ref,
            linked_flight_pnr=flight_booking["pnr"],
        )
        total = round(int(flight_booking["total_amount"]) + float(hotel_booking["total_amount_inr"]), 2)
        order = payment_service.create_external_order(total, package_ref)
        conn = sqlite_mod.get_connection()
        try:
            conn.execute("UPDATE hotel_bookings SET razorpay_order_id=? WHERE booking_ref=?", (order["gateway_order_id"], hotel_booking["booking_ref"]))
            conn.commit()
        finally:
            conn.close()
    except Exception:
        conn = sqlite_mod.get_connection()
        try:
            conn.execute("UPDATE bookings SET status='CANCELLED' WHERE pnr=? AND status='PENDING_PAYMENT'", (flight_booking["pnr"],))
            conn.execute("UPDATE hotel_bookings SET status='CANCELLED' WHERE package_ref=? AND status='PENDING_PAYMENT'", (package_ref,))
            conn.commit()
        finally:
            conn.close()
        flight_service.invalidate_search_cache()
        raise
    return {"package_ref": package_ref, "flight_booking": flight_booking,
            "hotel_booking": hotel_booking_service.get_hotel_booking(hotel_booking["booking_ref"]), "order": order,
            "flight_total_inr": flight_booking["total_amount"], "hotel_total_inr": hotel_booking["total_amount_inr"], "total_amount_inr": total}


def verify_package(package_ref: str, order_id: str, payment_id: str, signature: str) -> dict[str, Any]:
    package = get_package(package_ref)
    if not package or not package.get("flight_booking"):
        raise ValueError("Package not found.")
    flight = package["flight_booking"]
    hotel = package["hotel_booking"]
    if package["status"] == "CONFIRMED":
        return package
    if hotel["razorpay_order_id"] != order_id:
        raise ValueError("Payment order does not match this package.")
    payment_service.verify_signature(order_id, payment_id, signature)
    conn = sqlite_mod.get_connection()
    try:
        conn.execute("BEGIN IMMEDIATE")
        cur1 = conn.execute("UPDATE bookings SET status='CONFIRMED' WHERE pnr=? AND package_ref=? AND status='PENDING_PAYMENT' AND (hold_expires IS NULL OR hold_expires >= strftime('%Y-%m-%dT%H:%M:%fZ','now'))", (flight["pnr"], package_ref))
        cur2 = conn.execute("UPDATE hotel_bookings SET status='CONFIRMED',razorpay_payment_id=? WHERE booking_ref=? AND package_ref=? AND status='PENDING_PAYMENT'", (payment_id, hotel["booking_ref"], package_ref))
        if cur1.rowcount != 1 or cur2.rowcount != 1:
            conn.rollback()
            raise ValueError("Package booking hold is no longer active.")
        conn.commit()
    finally:
        conn.close()
    flight_service.invalidate_search_cache()
    # Generate both documents before returning the successful confirmation.
    ticket_service.generate_ticket(flight["pnr"])
    hotel_voucher_service.generate_voucher(hotel["booking_ref"])
    return get_package(package_ref)  # type: ignore[return-value]


def get_my_packages(user_id: int) -> list[dict[str, Any]]:
    conn = sqlite_mod.get_connection()
    try:
        rows = conn.execute("SELECT DISTINCT package_ref FROM hotel_bookings WHERE user_id=? AND package_ref IS NOT NULL ORDER BY package_ref DESC", (user_id,)).fetchall()
    finally:
        conn.close()
    return [package for row in rows if (package := get_package(row["package_ref"]))]
