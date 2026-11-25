"""Quick verification: init SQLite + verify both databases."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.db.sqlite import init_db
from backend.db import duck

# ── SQLite ───────────────────────────────────────────────────────────────
init_db()
print("SQLite init_db() complete.")

import sqlite3
conn = sqlite3.connect("data/app.db")
tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").fetchall()
print("Tables:", [t[0] for t in tables])
indexes = conn.execute("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name;").fetchall()
print("Indexes:", [i[0] for i in indexes])
conn.close()

# ── DuckDB (read-only) ──────────────────────────────────────────────────
dcon = duck.get_connection()
cols = dcon.execute("SELECT column_name FROM information_schema.columns WHERE table_name='flights' ORDER BY ordinal_position;").fetchall()
print("\nDuckDB flights columns:", [c[0] for c in cols])
sample = dcon.execute("SELECT flight_id, flight_code, dep_clock, arr_clock, seats_available, stops_count FROM flights LIMIT 5;").fetchall()
for r in sample:
    print(f"  flight_id={r[0]}  code={r[1]}  dep={r[2]}  arr={r[3]}  seats={r[4]}  stops={r[5]}")
dcon.close()
print("\n✓ Both databases verified successfully.")
