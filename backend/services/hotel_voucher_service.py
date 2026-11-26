"""ReportLab hotel confirmation voucher generator."""
from __future__ import annotations
import io
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from backend.services.hotel_booking_service import get_hotel_booking


def generate_voucher(booking_ref: str) -> bytes:
    booking = get_hotel_booking(booking_ref)
    if not booking:
        raise ValueError("Hotel booking not found.")
    if booking["status"] != "CONFIRMED":
        raise ValueError("Voucher available only for confirmed hotel bookings.")
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    x, y = 22 * mm, height - 24 * mm
    pdf.setFillColor(colors.HexColor("#101827")); pdf.roundRect(x, y-20*mm, width-44*mm, 24*mm, 4*mm, fill=1, stroke=0)
    pdf.setFillColor(colors.white); pdf.setFont("Helvetica-Bold", 17); pdf.drawString(x+6*mm, y-7*mm, "HOTEL BOOKING CONFIRMATION")
    pdf.setFont("Helvetica", 10); pdf.drawString(x+6*mm, y-14*mm, f"Confirmation Ref: {booking_ref}    Status: CONFIRMED")
    y -= 35*mm
    lines = [
        ("Hotel", booking["hotel_name"]),
        ("Location", " • ".join(filter(None, [booking.get("location"), booking["city"]]))),
        ("Star rating", f"{booking['star_rating']} stars" if booking.get("star_rating") is not None else "Not specified"),
        ("Nearest landmark", booking.get("nearest_landmark") or "Not specified"),
        ("Guest", booking["guest_name"]), ("Email", booking["guest_email"]),
        ("Check-in", booking["check_in_date"]), ("Check-out", booking["check_out_date"]),
        ("Stay", f"{booking['nights']} nights • {booking['guests']} guest(s)"),
    ]
    if booking.get("package_ref"):
        lines.insert(0, ("Package Ref", booking["package_ref"]))
    for label, value in lines:
        pdf.setFillColor(colors.HexColor("#64748b")); pdf.setFont("Helvetica-Bold", 9); pdf.drawString(x, y, label.upper())
        pdf.setFillColor(colors.HexColor("#111827")); pdf.setFont("Helvetica", 11); pdf.drawString(x+48*mm, y, str(value)[:90]); y -= 9*mm
    y -= 4*mm
    pdf.setStrokeColor(colors.HexColor("#cbd5e1")); pdf.line(x,y,width-x,y); y -= 10*mm
    total_base = float(booking["price_per_night_inr"]) * int(booking["nights"])
    tax = float(booking["tax_inr"]) * int(booking["nights"])
    for label, amount in [("Base stay",total_base),("Estimated GST" if booking["tax_is_estimated"] else "Tax",tax),("Total paid",booking["total_amount_inr"])]:
        pdf.setFont("Helvetica-Bold" if label == "Total paid" else "Helvetica", 11)
        pdf.drawString(x,y,label); pdf.drawRightString(width-x,y,f"₹ {amount:,.2f}"); y -= 8*mm
    pdf.setFont("Helvetica", 9); pdf.setFillColor(colors.HexColor("#64748b")); pdf.drawString(x,y-3*mm, f"Razorpay Payment ID: {booking.get('razorpay_payment_id') or 'N/A'}")
    pdf.showPage(); pdf.save()
    return buf.getvalue()
