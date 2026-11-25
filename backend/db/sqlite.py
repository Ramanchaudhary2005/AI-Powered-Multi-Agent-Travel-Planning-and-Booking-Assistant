"""
SQLite transactional store — WAL mode, foreign keys ON.

Call ``init_db()`` at application startup to ensure all tables exist.
"""

from __future__ import annotations

import sqlite3

from backend.config import APP_DB

# ── connection helper ────────────────────────────────────────────────────

def get_connection() -> sqlite3.Connection:
    """Return a SQLite connection with WAL journal and FK enforcement."""
    conn = sqlite3.connect(str(APP_DB))
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.row_factory = sqlite3.Row
    return conn


# ── schema DDL ───────────────────────────────────────────────────────────

_SCHEMA_SQL = """\
-- 1. users
CREATE TABLE IF NOT EXISTS users (
    user_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL,
    email        TEXT    NOT NULL UNIQUE,
    phone        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. agent_sessions  (defined before bookings because bookings.session_id -> agent_sessions)
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER,
    budget       INTEGER,
    status       TEXT    NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE', 'BOOKED', 'CLOSED')),
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id) REFERENCES users (user_id)
);

-- 3. bookings
CREATE TABLE IF NOT EXISTS bookings (
    booking_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    pnr           TEXT    NOT NULL UNIQUE,
    user_id       INTEGER NOT NULL,
    flight_id     INTEGER NOT NULL,
    travel_date   TEXT    NOT NULL,                       -- YYYY-MM-DD
    passenger_count INTEGER NOT NULL,
    total_amount  INTEGER NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'PENDING_PAYMENT'
                          CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'CANCELLED', 'EXPIRED')),
    booked_via    TEXT    NOT NULL
                          CHECK (booked_via IN ('AGENT', 'MANUAL')),
    session_id    INTEGER,
    hold_expires  TEXT,                                   -- ISO-8601 UTC
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (user_id)    REFERENCES users (user_id),
    FOREIGN KEY (session_id) REFERENCES agent_sessions (session_id)
);
CREATE INDEX IF NOT EXISTS idx_bookings_flight_date_status
    ON bookings (flight_id, travel_date, status);

-- 4. passengers
CREATE TABLE IF NOT EXISTS passengers (
    passenger_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id    INTEGER NOT NULL,
    name          TEXT    NOT NULL,
    age           INTEGER NOT NULL,
    gender        TEXT    NOT NULL,
    FOREIGN KEY (booking_id) REFERENCES bookings (booking_id)
);

-- 5. payments
CREATE TABLE IF NOT EXISTS payments (
    payment_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id          INTEGER NOT NULL,
    gateway_order_id    TEXT    NOT NULL UNIQUE,
    gateway_payment_id  TEXT,
    amount              INTEGER NOT NULL,
    status              TEXT    NOT NULL DEFAULT 'CREATED'
                                CHECK (status IN ('CREATED', 'PAID', 'FAILED')),
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (booking_id) REFERENCES bookings (booking_id)
);

-- 6. agent_messages
CREATE TABLE IF NOT EXISTS agent_messages (
    message_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id       INTEGER NOT NULL,
    role             TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
    content          TEXT    NOT NULL,
    ui_payload_json  TEXT,
    created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (session_id) REFERENCES agent_sessions (session_id)
);

-- 7. agent_steps
CREATE TABLE IF NOT EXISTS agent_steps (
    step_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id   INTEGER NOT NULL,
    turn_id      INTEGER NOT NULL,
    step_no      INTEGER NOT NULL,
    tool_name    TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'RUNNING'
                         CHECK (status IN ('RUNNING', 'DONE', 'FAILED')),
    summary      TEXT,
    input_json   TEXT,
    output_json  TEXT,
    created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    FOREIGN KEY (session_id) REFERENCES agent_sessions (session_id)
);
"""


def init_db() -> None:
    """Create all tables and indexes if they don't already exist."""
    conn = get_connection()
    try:
        conn.executescript(_SCHEMA_SQL)
        conn.commit()
    finally:
        conn.close()
