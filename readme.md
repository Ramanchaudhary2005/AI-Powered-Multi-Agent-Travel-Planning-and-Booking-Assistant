<div align="center">

# ✈️ FlightAgent India

**AI-Powered Multi-Agent Travel Planning & Flight Booking Assistant**

[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-Vite-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://vitejs.dev/)
[![Gemini AI](https://img.shields.io/badge/Google%20Gemini-2.5%20Flash-4285F4?style=for-the-badge&logo=google&logoColor=white)](https://ai.google.dev/)
[![Razorpay](https://img.shields.io/badge/Razorpay-Test%20Mode-0C2451?style=for-the-badge&logo=razorpay&logoColor=white)](https://razorpay.com/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)

*Search, rank, compare, and book Indian domestic flights either manually or conversationally through **SkyAgent**—with real-time SSE tool streaming, budget guardrails, Google OAuth profiles, and Razorpay checkout.*

</div>

---

## ✨ Key Features

### 🤖 SkyAgent (Conversational AI & Tool Loop)
- **Multi-Step Tool Execution:** Powered by Google Gemini (`gemini-2.5-flash` with automatic retry and fallback), SkyAgent parses natural-language queries (e.g., *"Find cheapest non-stop Delhi to Mumbai flight next week"*) and orchestrates `search_flights`, `rank_flights`, and booking creation autonomously.
- **Live Agent Activity Stream (SSE):** Streams real-time tool execution steps (`#1 search_flights`, `#2 rank_flights`, status badges, and raw JSON inspection) via Server-Sent Events directly to the sidebar.
- **Weighted Score Ranking:** Automatically scores flight options and renders interactive UI cards highlighted with **Best Overall** and **Cheapest** badges, live seat availability, and one-click selection.
- **Session Budget Cap Guardrail:** Set a strict INR budget cap per session; the backend enforces spending limits before booking creation and recommends budget-compliant alternatives.

### 🔍 Manual Search & Checkout
- **Domestic Flight Search:** Filter and explore Indian domestic routes with airline details, departure/arrival times, duration, stop counts, and INR pricing.
- **Razorpay Payment Gateway:** Integrated with Razorpay Checkout (Test Mode) supporting order creation, payment verification, graceful cancellation/retry handling, PNR generation, and downloadable **PDF E-Tickets**.

### 👤 Personalized Travel Account (Google OAuth 2.0)
- **Passwordless Google Sign-In:** One-click login via Google Identity Services (`@react-oauth/google`) backed by server-side ID token verification (`google-auth`) and stateless HS256 JWT sessions (`PyJWT`).
- **My Profile & Completion Tracker:** Manage General Information (First & Middle Name, Last Name, Gender, DOB, Nationality, Marital Status, Anniversary, City, State) and Contact Details (verified Google Email + Mobile Number).
- **Co-Travellers Manager:** Save family, friends, or frequent co-travellers and auto-fill passenger forms in a single click during checkout.
- **Flight Wishlist:** Bookmark flights directly from Manual Search or SkyAgent cards and jump straight into booking from `/wishlist`.
- **My Bookings:** Centralized view of past and confirmed trips with PNR status and ticket downloads.

---

## 🏗️ System Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                   Frontend (React + Vite)                   │
│  Manual Search │ SkyAgent SSE Chat │ Profile & Wishlist     │
│  Google OAuth  │ Ranked Cards UI   │ Razorpay Checkout      │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST API + SSE Stream (Bearer JWT)
┌──────────────────────────────▼──────────────────────────────┐
│                  Backend (FastAPI + Uvicorn)                │
│                                                             │
│  ├── Auth Router       ──► Google ID Token Verify + PyJWT   │
│  ├── Profile/Wishlist  ──► Safe SQLite Migrations (app.db)  │
│  ├── Agent Orchestrator──► Gemini Tool Loop (SSE + Fallback)│
│  ├── Flight Engine     ──► Search, Filter & Weighted Ranker │
│  └── Payments Router   ──► Razorpay SDK + PDF E-Ticket Gen  │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
     ┌─────────▼─────────┐           ┌─────────▼─────────┐
     │  SQLite (app.db)  │           │   External APIs   │
     │ • users           │           │ • Google Gemini   │
     │ • bookings        │           │ • Google OAuth    │
     │ • co_travellers   │           │ • Razorpay API    │
     │ • wishlist        │           └───────────────────┘
     └───────────────────┘
```

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React, Vite, JavaScript/JSX, Tailwind CSS, `@react-oauth/google`, `react-markdown`, EventSource/SSE |
| **Backend** | Python 3.11+, FastAPI, Uvicorn, Pydantic |
| **AI & Agents** | Google GenAI SDK (`google-genai`), Gemini 2.5 Flash / Flash-Lite, Server-Sent Events (SSE) |
| **Database** | SQLite (`data/app.db`) for transactional user/booking data, DuckDB / CSV flight inventory |
| **Auth & Security** | Google OAuth 2.0 (`google-auth`), JSON Web Tokens (`PyJWT`) |
| **Payments** | Razorpay Python SDK & Razorpay Web Checkout (Test Mode) |

---

## 📂 Project Structure

```text
AI-Powered Multi-Agent Travel Planning and Booking Assistant/
├── backend/
│   ├── agent/
│   │   ├── orchestrator.py     # Gemini tool-calling loop, SSE streaming & fallback
│   │   └── tools.py            # search_flights, rank_flights & booking tools
│   ├── db/
│   │   └── sqlite_db.py        # SQLite connection & non-destructive schema migrations
│   ├── routers/
│   │   ├── agent.py            # SSE chat & session endpoints
│   │   ├── auth.py             # Google OAuth & JWT verification endpoints
│   │   ├── bookings.py         # Booking lifecycle & PDF ticket routes
│   │   ├── flights.py          # Manual search & filtering routes
│   │   ├── payments.py         # Razorpay order creation & verification
│   │   ├── profile.py          # User profile & co-travellers CRUD
│   │   └── wishlist.py         # Saved flights endpoints
│   ├── services/
│   │   ├── auth_service.py     # Token validation & user upsert logic
│   │   └── payment_service.py  # Razorpay client wrapper
│   ├── config.py               # Environment variable loader
│   └── main.py                 # FastAPI app entry point & CORS config
├── frontend/
│   ├── src/                    # React pages, components, AuthContext & API clients
│   ├── .env.example            # Frontend env template
│   └── package.json
├── data/                       # Local SQLite DB & flight dataset (gitignored)
├── .env.example                # Backend env template
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites
- **Python 3.11+** (tested on Python 3.13)
- **Node.js 18+** & **npm**
- API keys for **Google Gemini**, **Razorpay (Test Mode)**, and a **Google OAuth 2.0 Web Client ID**

### 1. Clone the Repository
```bash
git clone [https://github.com/](https://github.com/)<your-username>/<your-repo-name>.git
cd "AI-Powered Multi-Agent Travel Planning and Booking Assistant"
```

### 2. Configure Environment Variables

Create a root `.env` file (copy from `.env.example`):
```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=your_razorpay_test_secret

GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
JWT_SECRET=your_strong_random_jwt_secret
```

Create `frontend/.env` (copy from `frontend/.env.example`):
```env
VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
```

> **Google Cloud Console Setup:** Under **Google Auth Platform → Clients**, create a **Web application** OAuth Client ID and add `http://localhost:5173` and `http://127.0.0.1:5173` to **Authorized JavaScript origins** (without trailing slashes). Add your email under **Audience → Test users** while in Testing mode.

### 3. Run the Backend (FastAPI)
```bash
# Install dependencies
python -m pip install -r requirements.txt
# Or install core packages directly:
python -m pip install fastapi uvicorn google-genai razorpay setuptools PyJWT google-auth requests python-dotenv

# Start the API server on port 8000
python -m uvicorn backend.main:app --reload --port 8000
```
Interactive Swagger API docs will be available at `http://localhost:8000/docs`.

### 4. Run the Frontend (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
Open **`http://localhost:5173`** in your browser.

---

## 🔌 Core API Endpoints

| Domain | Method & Endpoint | Description |
| :--- | :--- | :--- |
| **Agent** | `POST /api/agent/message` | Stream SkyAgent reasoning, tool executions, and flight cards over SSE |
| **Auth** | `POST /api/auth/google` | Verify Google ID token, upsert user, and return JWT |
| **Auth** | `GET /api/auth/me` | Fetch authenticated user session & profile completion percentage |
| **Profile** | `GET / PUT /api/profile` | Read or update General Information and Contact Details |
| **Co-Travellers** | `GET / POST / PUT / DELETE /api/profile/co-travellers` | Manage saved co-travellers for 1-click checkout fill |
| **Wishlist** | `GET / POST / DELETE /api/wishlist` | Bookmark and retrieve saved flights |
| **Bookings** | `GET / POST /api/bookings` | Create bookings (with budget checks) and fetch booking history |
| **Payments** | `POST /api/payments/order` | Create a Razorpay Test Mode order for a booking |

---

## 💳 Testing Payments Safely

This project uses **Razorpay Test Mode** (`rzp_test_...`). **Never enter real card details.**
- **UPI (Fastest):** Choose UPI in the Razorpay popup and enter `success@razorpay` to simulate an instant successful payment (or `failure@razorpay` to test failure recovery).
- **Netbanking:** Pick any test bank and click **Success** on the Razorpay mock screen to confirm booking and download the PDF E-Ticket.

---

## 📸 Screenshots

> *Add your screenshots in `docs/screenshots/` and update the links below.*

| SkyAgent Live Tool Loop & Ranked Cards | Razorpay Checkout & E-Ticket |
| :---: | :---: |
| ![SkyAgent UI](docs/screenshots/skyagent-chat.png) | ![Razorpay Checkout](docs/screenshots/razorpay-checkout.png) |

| My Profile & Co-Travellers | Saved Flights Wishlist |
| :---: | :---: |
| ![Profile Page](docs/screenshots/profile.png) | ![Wishlist Page](docs/screenshots/wishlist.png) |

---

## 🗺️ Roadmap

- [x] Indian domestic flight search & weighted score ranking
- [x] SkyAgent Gemini tool loop with real-time SSE activity panel
- [x] Session budget cap guardrails
- [x] Razorpay Test Mode checkout & PDF E-Ticket generation
- [x] Google OAuth 2.0 Sign-In, My Profile, Co-Travellers & Wishlist
- [ ] Personal Travel & Spending Analytics Dashboard (total spend, routes, AI vs Manual breakdown)
- [ ] Multi-city itineraries & round-trip booking support

---

## 👨‍💻 Author

**Raman Kumar**  
Built with FastAPI, React, Google Gemini, and Razorpay.

---

## 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.