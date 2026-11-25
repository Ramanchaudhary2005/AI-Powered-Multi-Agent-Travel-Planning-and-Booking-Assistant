"""
ticket_service — ReportLab 1-page boarding-pass PDF for CONFIRMED bookings.
"""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from backend.db import duck, sqlite as sqlite_mod


def generate_ticket(pnr: str) -> bytes:
    """Return PDF bytes for a *CONFIRMED* booking, or raise."""

    # ── Gather data ──────────────────────────────────────────────────
    conn = sqlite_mod.get_connection()
    try:
        brow = conn.execute(
            "SELECT booking_id, pnr, user_id, flight_id, travel_date, "
            "       passenger_count, total_amount, status, booked_via, created_at "
            "FROM bookings WHERE pnr = ?;",
            (pnr,),
        ).fetchone()
        if brow is None:
            raise ValueError(f"Booking with PNR '{pnr}' not found.")
        booking = dict(brow)
        if booking["status"] != "CONFIRMED":
            raise ValueError(
                f"Ticket available only for CONFIRMED bookings "
                f"(current status: {booking['status']})."
            )

        prows = conn.execute(
            "SELECT name, age, gender FROM passengers WHERE booking_id = ?;",
            (booking["booking_id"],),
        ).fetchall()
        passengers = [dict(r) for r in prows]

        urow = conn.execute(
            "SELECT name, email, phone FROM users WHERE user_id = ?;",
            (booking["user_id"],),
        ).fetchone()
        user = dict(urow) if urow else {"name": "", "email": "", "phone": ""}
    finally:
        conn.close()

    dcon = duck.get_connection()
    try:
        frow = dcon.execute(
            'SELECT airline, flight_code, source_city, destination_city, '
            'departure_time, arrival_time, dep_clock, arr_clock, '
            '"class" AS travel_class, duration_hrs, stops, stops_count '
            'FROM flights WHERE flight_id = ?;',
            [booking["flight_id"]],
        ).fetchone()
    finally:
        dcon.close()
    if frow is None:
        raise ValueError(f"Flight {booking['flight_id']} not found in catalog.")

    cols = [
        "airline", "flight_code", "source_city", "destination_city",
        "departure_time", "arrival_time", "dep_clock", "arr_clock",
        "travel_class", "duration_hrs", "stops", "stops_count",
    ]
    flight = dict(zip(cols, frow))

    # ── Build PDF ────────────────────────────────────────────────────
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    margin = 25 * mm
    y = height - margin

    # --- Header bar ---
    c.setFillColor(colors.HexColor("#1a56db"))
    c.rect(margin, y - 10 * mm, width - 2 * margin, 14 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(margin + 5 * mm, y - 6 * mm, "✈  E-TICKET / BOARDING PASS")
    y -= 22 * mm

    # --- Flight info ---
    c.setFillColor(colors.black)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin, y, f"{flight['airline']}   •   {flight['flight_code']}")
    y -= 7 * mm
    c.setFont("Helvetica", 11)
    c.drawString(margin, y, f"Class: {flight['travel_class']}")
    c.drawString(margin + 80 * mm, y, f"PNR: {pnr}")
    y -= 10 * mm

    # --- Route ---
    c.setStrokeColor(colors.HexColor("#d1d5db"))
    c.line(margin, y, width - margin, y)
    y -= 8 * mm

    c.setFont("Helvetica-Bold", 13)
    c.drawString(margin, y, flight["source_city"])
    c.drawString(margin + 60 * mm, y, "→")
    c.drawString(margin + 70 * mm, y, flight["destination_city"])
    y -= 7 * mm
    c.setFont("Helvetica", 10)
    c.drawString(margin, y, f"Dep: {flight['dep_clock']}  ({flight['departure_time']})")
    c.drawString(
        margin + 70 * mm, y,
        f"Arr: {flight['arr_clock']}  ({flight['arrival_time']})",
    )
    y -= 7 * mm
    c.drawString(margin, y, f"Duration: {flight['duration_hrs']} hrs")
    stops_label = {0: "Non-stop", 1: "1 stop", 2: "2+ stops"}.get(
        flight["stops_count"], flight["stops"]
    )
    c.drawString(margin + 70 * mm, y, f"Stops: {stops_label}")
    y -= 5 * mm

    c.setStrokeColor(colors.HexColor("#d1d5db"))
    c.line(margin, y, width - margin, y)
    y -= 8 * mm

    # --- Travel details ---
    c.setFont("Helvetica-Bold", 11)
    c.drawString(margin, y, f"Travel Date: {booking['travel_date']}")
    y -= 10 * mm

    # --- Passengers ---
    c.setFont("Helvetica-Bold", 11)
    c.drawString(margin, y, "PASSENGERS")
    y -= 6 * mm
    c.setFont("Helvetica", 10)
    for idx, p in enumerate(passengers, 1):
        c.drawString(
            margin + 3 * mm, y,
            f"{idx}. {p['name']}  ({p['gender']}, age {p['age']})",
        )
        y -= 5 * mm
    y -= 3 * mm

    c.setStrokeColor(colors.HexColor("#d1d5db"))
    c.line(margin, y, width - margin, y)
    y -= 8 * mm

    # --- Totals ---
    c.setFont("Helvetica-Bold", 12)
    c.drawString(margin, y, f"Total Amount: ₹{booking['total_amount']:,}")
    c.drawString(margin + 80 * mm, y, f"Status: {booking['status']}")
    y -= 7 * mm
    c.setFont("Helvetica", 9)
    c.drawString(margin, y, f"Booked via: {booking['booked_via']}")
    c.drawString(margin + 80 * mm, y, f"Contact: {user['email']}")

    c.showPage()
    c.save()
    return buf.getvalue()
