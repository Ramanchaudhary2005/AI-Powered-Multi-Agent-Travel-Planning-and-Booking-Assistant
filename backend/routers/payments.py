"""
Payments router — Razorpay order creation + verification.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from backend.schemas import (
    PaymentOrderRequest,
    PaymentOrderResponse,
    PaymentVerifyRequest,
    PaymentVerifyResponse,
)
from backend.services import payment_service

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/order", response_model=PaymentOrderResponse, status_code=201)
def create_order(req: PaymentOrderRequest):
    try:
        result = payment_service.create_order(req.booking_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result


@router.post("/verify", response_model=PaymentVerifyResponse)
def verify_payment(req: PaymentVerifyRequest):
    try:
        result = payment_service.verify_payment(
            razorpay_order_id=req.razorpay_order_id,
            razorpay_payment_id=req.razorpay_payment_id,
            razorpay_signature=req.razorpay_signature,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return result
