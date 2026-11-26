"""
payment_service — Razorpay order creation + HMAC-SHA256 verification.

Supports ``MOCK_RAZORPAY=true`` for local testing without live keys.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from typing import Any

from backend import config
from backend.db import sqlite as sqlite_mod


# ── Razorpay client (lazy) ──────────────────────────────────────────────

_rz_client = None


def _get_razorpay_client():
    global _rz_client
    if _rz_client is None:
        import razorpay
        _rz_client = razorpay.Client(
            auth=(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET)
        )
    return _rz_client


def verify_signature(razorpay_order_id: str, razorpay_payment_id: str, razorpay_signature: str) -> None:
    """Apply the same HMAC check used by the existing flight payment flow."""
    if config.MOCK_RAZORPAY:
        return
    message = f"{razorpay_order_id}|{razorpay_payment_id}"
    expected = hmac.new(config.RAZORPAY_KEY_SECRET.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, razorpay_signature):
        raise ValueError("Payment signature verification failed.")


def create_external_order(amount_inr: float, receipt: str) -> dict[str, Any]:
    """Create an order for a non-flight payment without touching flight payments."""
    amount = round(float(amount_inr), 2)
    if amount <= 0:
        raise ValueError("Payment amount must be positive.")
    if config.MOCK_RAZORPAY:
        order_id = f"mock_ord_{uuid.uuid4().hex[:16]}"
    else:
        order = _get_razorpay_client().order.create(data={
            "amount": int(round(amount * 100)), "currency": "INR", "receipt": receipt[:40],
        })
        order_id = order["id"]
    return {
        "gateway_order_id": order_id, "amount": amount, "currency": "INR",
        "status": "CREATED", "razorpay_key_id": config.RAZORPAY_KEY_ID or None,
    }


# ── Public API ───────────────────────────────────────────────────────────

def create_order(booking_id: int) -> dict[str, Any]:
    """
    Create a Razorpay (or mock) payment order for the given booking.
    """
    conn = sqlite_mod.get_connection()
    try:
        row = conn.execute(
            "SELECT booking_id, pnr, total_amount, status "
            "FROM bookings WHERE booking_id = ?;",
            (booking_id,),
        ).fetchone()
    finally:
        conn.close()

    if row is None:
        raise ValueError(f"Booking {booking_id} not found.")
    booking = dict(row)
    if booking["status"] not in ("PENDING_PAYMENT",):
        raise ValueError(
            f"Booking {booking_id} is '{booking['status']}', cannot create order."
        )

    amount_paise = booking["total_amount"] * 100

    if config.MOCK_RAZORPAY:
        gateway_order_id = f"mock_ord_{uuid.uuid4().hex[:16]}"
    else:
        client = _get_razorpay_client()
        order = client.order.create(
            data={
                "amount": amount_paise,
                "currency": "INR",
                "receipt": booking["pnr"],
            }
        )
        gateway_order_id = order["id"]

    # Persist payment record
    conn = sqlite_mod.get_connection()
    try:
        cur = conn.execute(
            "INSERT INTO payments (booking_id, gateway_order_id, amount, status) "
            "VALUES (?, ?, ?, 'CREATED');",
            (booking_id, gateway_order_id, booking["total_amount"]),
        )
        payment_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    return {
        "payment_id": payment_id,
        "booking_id": booking_id,
        "gateway_order_id": gateway_order_id,
        "amount": booking["total_amount"],
        "currency": "INR",
        "status": "CREATED",
        "razorpay_key_id": config.RAZORPAY_KEY_ID or None,
    }


def verify_payment(
    razorpay_order_id: str,
    razorpay_payment_id: str,
    razorpay_signature: str,
) -> dict[str, Any]:
    """
    Verify HMAC-SHA256 signature and idempotently confirm the booking.
    """
    conn = sqlite_mod.get_connection()
    try:
        prow = conn.execute(
            "SELECT payment_id, booking_id, status "
            "FROM payments WHERE gateway_order_id = ?;",
            (razorpay_order_id,),
        ).fetchone()
    finally:
        conn.close()

    if prow is None:
        raise ValueError(f"Payment order '{razorpay_order_id}' not found.")
    payment = dict(prow)

    # Idempotent: already paid
    if payment["status"] == "PAID":
        return _build_verify_response(payment["payment_id"])

    # ── Signature verification ───────────────────────────────────────
    try:
        verify_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature)
    except ValueError:
        # Preserve the flight flow's failed-payment bookkeeping.
        conn = sqlite_mod.get_connection()
        try:
            conn.execute(
                "UPDATE payments SET status = 'FAILED' WHERE payment_id = ?;",
                (payment["payment_id"],),
            )
            conn.commit()
        finally:
            conn.close()
        raise

    # ── Mark PAID + CONFIRMED ────────────────────────────────────────
    conn = sqlite_mod.get_connection()
    try:
        conn.execute(
            "UPDATE payments SET gateway_payment_id = ?, status = 'PAID' "
            "WHERE payment_id = ?;",
            (razorpay_payment_id, payment["payment_id"]),
        )
        conn.execute(
            "UPDATE bookings SET status = 'CONFIRMED' WHERE booking_id = ?;",
            (payment["booking_id"],),
        )
        conn.commit()
    finally:
        conn.close()

    return _build_verify_response(payment["payment_id"])


def _build_verify_response(payment_id: int) -> dict[str, Any]:
    conn = sqlite_mod.get_connection()
    try:
        row = conn.execute(
            "SELECT p.payment_id, p.status AS payment_status, "
            "       b.status AS booking_status, b.pnr "
            "FROM payments p JOIN bookings b ON b.booking_id = p.booking_id "
            "WHERE p.payment_id = ?;",
            (payment_id,),
        ).fetchone()
    finally:
        conn.close()
    r = dict(row)
    return {
        "payment_id": r["payment_id"],
        "status": r["payment_status"],
        "booking_status": r["booking_status"],
        "pnr": r["pnr"],
    }
