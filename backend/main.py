"""
FastAPI application entry-point.

Start with:
    uvicorn backend.main:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.sqlite import init_db
from backend.routers import agent, bookings, flights, payments


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure SQLite schema exists
    init_db()
    yield


app = FastAPI(
    title="Flight Booking API",
    version="0.1.0",
    lifespan=lifespan,
)

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
