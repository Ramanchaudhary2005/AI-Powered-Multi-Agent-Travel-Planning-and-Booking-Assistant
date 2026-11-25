#!/usr/bin/env python
"""
ETL: Ingest airlines_flights_data.csv → data/flights.duckdb

Implements every cleaning & enrichment rule from SPEC.md §3.
Run from the project root:
    python scripts/load_flights.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import duckdb

# ── Paths ────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "airlines_flights_data.csv"
DB_PATH = ROOT / "data" / "flights.duckdb"


# ── Clock helpers ────────────────────────────────────────────────────────
# Bucket → deterministic base hour (start of the 4-hour window)
_BUCKET_BASE = {
    "Early_Morning": 4,
    "Morning": 8,
    "Afternoon": 12,
    "Evening": 16,
    "Night": 20,
    "Late_Night": 0,
}


def _clock_sql(bucket_col: str, index_col: str) -> str:
    """
    Build a SQL CASE expression that maps a time-bucket column to a
    deterministic HH:MM string.

    The minute component is ``(index % 60)`` so each row gets a unique
    but reproducible clock value within its bucket window.
    """
    parts = []
    for bucket, base_h in _BUCKET_BASE.items():
        # hour offset: (index % 4) gives 0-3 → stays inside the 4-hour window
        parts.append(
            f"WHEN {bucket_col} = '{bucket}' THEN "
            f"LPAD(CAST(({base_h} + (CAST({index_col} AS INTEGER) % 4)) AS VARCHAR), 2, '0') "
            f"|| ':' || "
            f"LPAD(CAST((CAST({index_col} AS INTEGER) % 60) AS VARCHAR), 2, '0')"
        )
    return "CASE " + " ".join(parts) + " END"


def _arr_clock_sql(dep_clock: str, duration_col: str) -> str:
    """
    Compute arrival clock as dep_clock + duration_hrs (wrapping past 24).

    dep_clock is already a 'HH:MM' string; duration is decimal hours.
    """
    return (
        f"LPAD(CAST(("
        f"  CAST(SUBSTRING({dep_clock}, 1, 2) AS INTEGER) "
        f"  + CAST(FLOOR({duration_col}) AS INTEGER)"
        f") % 24 AS VARCHAR), 2, '0') "
        f"|| ':' || "
        f"LPAD(CAST(("
        f"  CAST(SUBSTRING({dep_clock}, 4, 2) AS INTEGER) "
        f"  + CAST(ROUND(({duration_col} - FLOOR({duration_col})) * 60) AS INTEGER)"
        f") % 60 AS VARCHAR), 2, '0')"
    )


def main() -> None:
    if not CSV_PATH.exists():
        print(f"ERROR: CSV not found at {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    # Remove stale DB so we start fresh
    if DB_PATH.exists():
        DB_PATH.unlink()

    con = duckdb.connect(str(DB_PATH))

    # ── 1. Load raw CSV into a staging table ─────────────────────────────
    con.execute(
        f"""
        CREATE TABLE raw AS
        SELECT * FROM read_csv_auto('{CSV_PATH.as_posix()}',
                                     header=true,
                                     all_varchar=true);
        """
    )

    # ── 2. Build the clean flights table ─────────────────────────────────
    dep_clock_expr = _clock_sql("departure_time", "\"index\"")

    # We use a CTE so dep_clock is available for arr_clock computation
    # in a single CREATE TABLE statement.
    arr_clock_from_dep = _arr_clock_sql("dep_clock", "duration_hrs")

    con.execute(
        f"""
        CREATE TABLE flights AS
        WITH stage AS (
            SELECT
                CAST("index" AS INTEGER) + 1                    AS flight_id,
                airline,

                -- Fix Indigo flight codes
                CASE
                    WHEN flight LIKE '6.00E-%'
                        THEN REPLACE(flight, '6.00E-', '6E-')
                    WHEN flight = '0.00E+00'
                        THEN '6E-' || CAST(9000 + (CAST("index" AS INTEGER) % 900) AS VARCHAR)
                    ELSE flight
                END                                              AS flight_code,

                source_city,
                departure_time,
                stops,
                arrival_time,
                destination_city,
                class,
                CAST(duration AS DOUBLE)                         AS duration_hrs,
                CAST(days_left AS INTEGER)                       AS days_left,
                CAST(price AS INTEGER)                           AS price,

                -- stops_count
                CASE stops
                    WHEN 'zero'         THEN 0
                    WHEN 'one'          THEN 1
                    WHEN 'two_or_more'  THEN 2
                END                                              AS stops_count,

                -- seats_available (deterministic 6-20)
                ((CAST("index" AS INTEGER) * 7) % 15) + 6       AS seats_available,

                -- dep_clock
                {dep_clock_expr}                                 AS dep_clock
            FROM raw
        )
        SELECT
            stage.*,
            {arr_clock_from_dep}                                 AS arr_clock
        FROM stage;
        """
    )

    # Drop the raw staging table
    con.execute("DROP TABLE raw;")

    # ── 3. Composite index ───────────────────────────────────────────────
    con.execute(
        """
        CREATE INDEX idx_flights_search
        ON flights (source_city, destination_city, days_left, class, price);
        """
    )

    # ── 4. Verification ─────────────────────────────────────────────────
    total_rows = con.execute("SELECT COUNT(*) FROM flights;").fetchone()[0]
    unique_cities = con.execute(
        """
        SELECT COUNT(DISTINCT city) FROM (
            SELECT source_city AS city FROM flights
            UNION
            SELECT destination_city AS city FROM flights
        );
        """
    ).fetchone()[0]
    malformed = con.execute(
        """
        SELECT COUNT(*) FROM flights
        WHERE flight_code LIKE '%.%E%'
           OR flight_code LIKE '%0.00E%';
        """
    ).fetchone()[0]

    # Sample some corrected Indigo codes
    sample = con.execute(
        "SELECT flight_code FROM flights WHERE airline = 'Indigo' LIMIT 5;"
    ).fetchall()

    con.close()

    print("=" * 55)
    print("  Flight ETL — Verification Report")
    print("=" * 55)
    print(f"  Total rows loaded     : {total_rows:>10,}")
    print(f"  Unique cities         : {unique_cities:>10}")
    print(f"  Malformed codes left  : {malformed:>10}")
    print(f"  Sample Indigo codes   : {[r[0] for r in sample]}")
    print(f"  DuckDB file           : {DB_PATH}")
    print("=" * 55)

    if total_rows != 300_153:
        print(f"WARNING: Expected 300,153 rows but got {total_rows}", file=sys.stderr)
        sys.exit(1)
    if malformed != 0:
        print(f"WARNING: {malformed} malformed flight codes remain!", file=sys.stderr)
        sys.exit(1)

    print("  ✓ All checks passed.")


if __name__ == "__main__":
    main()
