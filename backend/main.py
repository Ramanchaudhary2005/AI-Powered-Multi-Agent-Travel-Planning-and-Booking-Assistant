"""
FastAPI application entry-point.

Start with:
    uvicorn backend.main:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager
import logging
from time import perf_counter

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.sqlite import init_db
from backend.routers import agent, analytics, auth, bookings, flights, hotels, payments, profile, wishlist, hotel_bookings, packages, insights
from backend.db import duck
from backend.services import hotel_service, ml_service

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure SQLite schema exists
    init_db()
    try:
        duck.warm_connection()
    except Exception:
        logger.exception("Unable to pre-warm the DuckDB catalog")
    try:
        ml_service.warm_model()
    except Exception:
        logger.exception("Unable to pre-warm the optional fare model")
    try:
        hotel_service.warm_hotel_cache()
    except Exception:
        logger.exception("Unable to pre-warm the optional hotel inventory")
    yield


app = FastAPI(
    title="Flight Booking API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def add_process_time_header(request, call_next):
    started = perf_counter()
    response = await call_next(request)
    response.headers["X-Process-Time-Ms"] = f"{(perf_counter() - started) * 1000:.2f}"
    return response

# ── CORS (permissive for local dev) ──────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────────────────────
app.include_router(flights.router)
app.include_router(bookings.router)
app.include_router(payments.router)
app.include_router(agent.router)
app.include_router(auth.router)
app.include_router(profile.router)
app.include_router(wishlist.router)
app.include_router(analytics.router)
app.include_router(hotels.router)
app.include_router(hotel_bookings.router)
app.include_router(packages.router)
app.include_router(insights.router)
