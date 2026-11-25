"""
Centralised configuration — reads .env once and exposes typed settings.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# ── paths ────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).resolve().parent.parent          # project root
DATA_DIR = ROOT_DIR / "data"
FLIGHTS_DB = DATA_DIR / "flights.duckdb"
APP_DB = DATA_DIR / "app.db"

# ── load .env (no-op if file is missing) ─────────────────────────────────
load_dotenv(ROOT_DIR / ".env")

# ── Gemini ───────────────────────────────────────────────────────────────
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# ── Razorpay ─────────────────────────────────────────────────────────────
RAZORPAY_KEY_ID: str = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET: str = os.getenv("RAZORPAY_KEY_SECRET", "")
MOCK_RAZORPAY: bool = os.getenv("MOCK_RAZORPAY", "false").lower() in ("true", "1", "yes")

# Google sign-in and application JWTs
GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
JWT_SECRET: str = os.getenv("JWT_SECRET", "dev-only-change-me-before-deploying")
