# Flight Booking + AI Agent Prototype — Technical Specification

## 1. System Overview & Core Invariants
- **Two Paths, One Backend**:
  - **Manual Path**: Home Search -> Results -> Passenger Form -> Razorpay Payment -> Confirmed Ticket (PDF).
  - **Agent Path**: Talk with Agent -> Budget Cap + Tool Loop -> Razorpay Payment -> Confirmed Ticket (PDF).
- **Single Source of Truth**: Both Manual APIs and Agent Tools MUST call the exact same Python service functions under `backend/services/`. Zero duplicated business logic.
- **Strict LLM Role**: Gemini (`google-genai` SDK) ONLY understands intent, chooses tools, and writes natural-language replies. ALL calculations (`days_left`, fares, ranking scores, seat availability, budget guard, PNR generation, payment verification) MUST be pure Python.
- **Database Split**:
  - **DuckDB (`data/flights.duckdb`)**: Read-only flight catalog loaded once from CSV. ALWAYS open with `read_only=True` inside FastAPI. NEVER run `UPDATE`/`INSERT`/`DELETE` on DuckDB at runtime.
  - **SQLite (`data/app.db`)**: Read/write transactional store with `PRAGMA journal_mode=WAL;` and `PRAGMA foreign_keys=ON;`.

## 2. Tech Stack
- **Backend**: Python 3.11+, FastAPI, Uvicorn, Pydantic v2, DuckDB, SQLite (`sqlite3` or SQLAlchemy), `google-genai`, `razorpay`, `reportlab`, `python-dotenv`.
- **Frontend**: React (Vite), Tailwind CSS, React Router. Use `fetch()` + `ReadableStream` (`getReader()`) for POST SSE streaming (NEVER native `EventSource`).

## 3. Dataset & ETL Rules (`data/airlines_flights_data.csv`)
- **Rows**: 300,153 flights across **6 cities** (`Delhi`, `Mumbai`, `Bangalore`, `Kolkata`, `Hyderabad`, `Chennai`), 30 routes, `days_left` from `1` to `49`, 2 classes (`Economy`, `Business`).
- **Raw CSV Columns**: `index, airline, flight, source_city, departure_time, stops, arrival_time, destination_city, class, duration, days_left, price`.
- **Valid Enums**:
  - `cities`: `["Delhi", "Mumbai", "Bangalore", "Kolkata", "Hyderabad", "Chennai"]`
  - `departure_time` & `arrival_time`: `["Early_Morning", "Morning", "Afternoon", "Evening", "Night", "Late_Night"]`
  - `stops`: `["zero", "one", "two_or_more"]`
  - `class`: `["Economy", "Business"]`
- **Mandatory Cleaning During Ingestion (`scripts/load_flights.py`)**:
  - `flight_id = CAST(index AS INTEGER) + 1`
  - Rename `flight` -> `flight_code`, `duration` -> `duration_hrs`.
  - Fix Excel-corrupted Indigo flight codes:
    - If `flight LIKE '6.00E-%'` -> replace `'6.00E-'` with `'6E-'`
    - If `flight = '0.00E+00'` -> `'6E-' || CAST(9000 + (CAST(index AS INTEGER) % 900) AS VARCHAR)`
  - Derived columns:
    - `stops_count`: `zero -> 0`, `one -> 1`, `two_or_more -> 2`
    - `seats_available`: `((CAST(index AS INTEGER) * 7) % 15) + 6` (deterministic 6–20 seats)
    - `dep_clock` & `arr_clock`: deterministic HH:MM strings derived from the departure bucket (`Early_Morning` 04:00–07:59, `Morning` 08:00–11:59, `Afternoon` 12:00–15:59, `Evening` 16:00–19:59, `Night` 20:00–23:59, `Late_Night` 00:00–03:59) + `duration_hrs`.
  - Composite index: `CREATE INDEX idx_flights_search ON flights (source_city, destination_city, days_left, class, price);`

## 4. SQLite Schema (`data/app.db`)
- `users`: `user_id (PK)`, `name`, `email (UNIQUE)`, `phone`, `created_at`
- `bookings`: `booking_id (PK)`, `pnr (UNIQUE)`, `user_id (FK)`, `flight_id (INT)`, `travel_date (TEXT YYYY-MM-DD)`, `passenger_count (INT)`, `total_amount (INT)`, `status ('PENDING_PAYMENT'|'CONFIRMED'|'CANCELLED'|'EXPIRED')`, `booked_via ('AGENT'|'MANUAL')`, `session_id (FK nullable)`, `hold_expires (TEXT ISO8601 UTC)`, `created_at`
  - Index on `(flight_id, travel_date, status)`.
- `passengers`: `passenger_id (PK)`, `booking_id (FK)`, `name`, `age`, `gender`
- `payments`: `payment_id (PK)`, `booking_id (FK)`, `gateway_order_id (UNIQUE)`, `gateway_payment_id`, `amount (INT)`, `status ('CREATED'|'PAID'|'FAILED')`, `created_at`
- `agent_sessions`: `session_id (PK)`, `user_id (FK nullable)`, `budget (INT nullable)`, `status ('ACTIVE'|'BOOKED'|'CLOSED')`, `created_at`
- `agent_messages`: `message_id (PK)`, `session_id (FK)`, `role ('user'|'assistant')`, `content`, `ui_payload_json (TEXT nullable)`, `created_at`
- `agent_steps`: `step_id (PK)`, `session_id (FK)`, `turn_id`, `step_no`, `tool_name`, `status ('RUNNING'|'DONE'|'FAILED')`, `summary`, `input_json`, `output_json`, `created_at`

## 5. Shared Services (`backend/services/`)
1. **Live Seats Calculation**:
   - Before every search/booking, expire stale holds: `UPDATE bookings SET status='EXPIRED' WHERE status='PENDING_PAYMENT' AND hold_expires < UTC_NOW`.
   - `live_seats_left = duckdb.seats_available - SUM(passenger_count of CONFIRMED or unexpired PENDING_PAYMENT bookings for same flight_id + travel_date)`.
2. **`flight_service.py`**:
   - Convert `travel_date` -> `days_left = (travel_date - date.today()).days`. Reject if `< 1` or `> 49`.
   - `search_flights(...)`: Filter DuckDB by route, `days_left`, class, optional `max_price`, `stops`, `departure_time`. Attach `live_seats_left` and keep `live_seats_left >= passengers`. Return top 50 sorted by price asc.
   - `find_alternatives(...)`: If 0 matches, relax in order: (1) `days_left ± 2` (clamped 1..49), (2) relax `stops`, (3) relax `class` (`Business` -> `Economy`). Always return `relaxed_fields` list and human-readable explanation.
3. **`ranking_service.py`**:
   - Min-max normalize candidate list: `score = 0.45 * price_norm + 0.30 * duration_norm + 0.15 * stops_penalty + 0.10 * time_penalty` (`stops_penalty`: 0 / 0.5 / 1.0; `time_penalty`: 0 if matches preference else 0.5).
   - Return `best_pick` (lowest score) + `top_3` with badges (`Best Overall`, `Cheapest`, `Fastest`).
4. **`booking_service.py`**:
   - Use SQLite `BEGIN IMMEDIATE` transaction.
   - Verify `flight_id` exists in DuckDB, re-check `live_seats_left >= len(passengers)`, compute authoritative `total_amount = duckdb.price * len(passengers)`.
   - Generate unique 6-char uppercase alphanumeric PNR, set `hold_expires = now_utc + 10 minutes`, insert `bookings` + `passengers`.
5. **`payment_service.py`**:
   - `create_order(booking_id)`: Create Razorpay test order (`amount = total_amount * 100` paise, `currency = "INR"`, `receipt = pnr`). Support a `MOCK_RAZORPAY=true` env fallback for local testing if keys aren't set yet.
   - `verify_payment(...)`: Verify HMAC-SHA256 signature (`order_id|payment_id` with `RAZORPAY_KEY_SECRET`), idempotently mark payment `PAID` and booking `CONFIRMED`.
6. **`ticket_service.py`**:
   - Generate 1-page PDF e-ticket via ReportLab for `CONFIRMED` bookings only.

## 6. Agent Layer (`backend/agent/`)
- **5 Tools**:
  1. `search_flights`
  2. `rank_flights`
  3. `find_alternatives`
  4. `create_booking`
  5. `create_payment_order`
- **Budget Guard (`budget_guard.py`)**: Hard Python enforcement inside `create_booking` and `create_payment_order`. If `session.budget` is set and `total_amount > session.budget`, block execution and return `{"status": "BLOCKED_BY_BUDGET_GUARD", "total_amount": ..., "budget": ...}` to Gemini.
- **Orchestrator (`orchestrator.py`)**:
  - Max 6 tool iterations per user turn.
  - Stream SSE events on `POST /api/agent/message`:
    - `event: step_update` (emitted on `RUNNING`, `DONE`, `FAILED`, persisted to `agent_steps`)
    - `event: ui_card` (emitted for `RANKED_FLIGHTS` or `PAYMENT_ORDER`)
    - `event: assistant_message` (final Gemini response, persisted to `agent_messages` with `ui_payload_json`)
    - `event: done`

## 7. API Endpoints
- `GET /api/flights/meta`
- `POST /api/flights/search`, `GET /api/flights/{id}?travel_date=YYYY-MM-DD`
- `POST /api/bookings`, `GET /api/bookings/{pnr}`, `GET /api/bookings?email=...`, `GET /api/bookings/{pnr}/ticket.pdf`
- `POST /api/payments/order`, `POST /api/payments/verify`
- `POST /api/agent/session`, `PATCH /api/agent/session/{id}/budget`, `POST /api/agent/message` (SSE), `GET /api/agent/session/{id}/steps`

## 8. Folder Structure
flight-booking-agent/
├── SPEC.md
├── .env.example
├── data/
│   └── airlines_flights_data.csv
├── scripts/
│   └── load_flights.py
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── schemas.py
│   ├── db/ (duck.py, sqlite.py)
│   ├── services/ (flight_service.py, ranking_service.py, booking_service.py, payment_service.py, ticket_service.py)
│   ├── agent/ (orchestrator.py, tools.py, budget_guard.py)
│   └── routers/ (flights.py, bookings.py, payments.py, agent.py)
└── frontend/ (React + Vite + Tailwind)