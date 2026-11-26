"""Curate hotel CSVs and write a unified flight/hotel quality report.

Run from the repository root with ``python scripts/etl_and_validate.py``.
The DuckDB write only replaces the ``hotels`` table; the existing ``flights``
table is never modified.
"""

from __future__ import annotations

import csv
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median
from typing import Any

import duckdb


ROOT = Path(__file__).resolve().parents[1]
RAW_HOTELS = ROOT / "data" / "raw" / "hotels"
CURATED_DIR = ROOT / "data" / "curated"
HOTELS_PARQUET = CURATED_DIR / "hotels_clean.parquet"
REPORT_PATH = CURATED_DIR / "data_quality_report.json"
FLIGHTS_DB = ROOT / "data" / "flights.duckdb"
CITY_FILES = {
    "bangalore.csv": "Bangalore",
    "chennai.csv": "Chennai",
    "delhi.csv": "Delhi",
    "hyderabad.csv": "Hyderabad",
    "kolkata.csv": "Kolkata",
    "mumbai.csv": "Mumbai",
}
HOTEL_COLUMNS = [
    "hotel_id", "city", "hotel_name", "rating", "rating_description",
    "reviews", "star_rating", "location", "nearest_landmark",
    "distance_to_landmark_km", "price_inr", "tax_inr", "estimated_tax_inr",
    "tax_is_estimated", "total_price_per_night_inr", "is_luxury_outlier",
]


def _number(value: Any) -> float | None:
    if value is None:
        return None
    cleaned = str(value).strip().replace(",", "")
    cleaned = re.sub(r"[^0-9.\-]", "", cleaned)
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _text(value: Any) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _distance_km(value: Any) -> float | None:
    raw = _text(value)
    if not raw:
        return None
    match = re.search(r"([\d.,]+)\s*(km|kilomet(?:er|re)s?|m|meters?)?", raw, re.I)
    if not match:
        return None
    amount = _number(match.group(1))
    if amount is None:
        return None
    unit = (match.group(2) or "km").lower()
    return round(amount / 1000, 4) if unit.startswith("m") and not unit.startswith("km") else amount


def _percent(numerator: int | float, denominator: int | float) -> float:
    return round(100.0 * numerator / denominator, 2) if denominator else 100.0


def _price_summary(values: list[float]) -> dict[str, float | None]:
    if not values:
        return {"min": None, "median": None, "mean": None, "max": None}
    return {
        "min": round(min(values), 2),
        "median": round(median(values), 2),
        "mean": round(mean(values), 2),
        "max": round(max(values), 2),
    }


def _completeness(rows: list[dict[str, Any]], columns: list[str]) -> dict[str, Any]:
    total_values = len(rows) * len(columns)
    filled_total = 0
    per_column: dict[str, float] = {}
    for column in columns:
        filled = sum(row.get(column) is not None and row.get(column) != "" for row in rows)
        filled_total += filled
        per_column[column] = _percent(filled, len(rows))
    return {
        "overall_pct": _percent(filled_total, total_values),
        "per_column_pct": per_column,
    }


def _read_hotels() -> tuple[list[dict[str, Any]], int, int, int]:
    missing = [name for name in CITY_FILES if not (RAW_HOTELS / name).is_file()]
    if missing:
        raise FileNotFoundError(f"Missing required hotel CSV files: {', '.join(missing)}")

    parsed: list[dict[str, Any]] = []
    raw_count = 0
    invalid_count = 0
    for filename, city in CITY_FILES.items():
        with (RAW_HOTELS / filename).open("r", encoding="utf-8-sig", newline="") as source:
            for raw in csv.DictReader(source):
                raw_count += 1
                hotel_name = _text(raw.get("Hotel Name"))
                price = _number(raw.get("Price"))
                if not hotel_name or price is None or price <= 0:
                    invalid_count += 1
                    continue

                tax = _number(raw.get("Tax"))
                if tax is not None and tax < 0:
                    tax = None
                estimated = None
                tax_is_estimated = tax is None
                if tax_is_estimated:
                    estimated = round(price * (0.12 if price <= 7500 else 0.18), 2)
                tax_component = tax if tax is not None else estimated or 0.0
                parsed.append({
                    "city": city,
                    "hotel_name": hotel_name,
                    "rating": _number(raw.get("Rating")),
                    "rating_description": _text(raw.get("Rating Description")),
                    "reviews": max(0, int(_number(raw.get("Reviews")) or 0)),
                    "star_rating": _number(raw.get("Star Rating")),
                    "location": _text(raw.get("Location")),
                    "nearest_landmark": _text(raw.get("Nearest Landmark")),
                    "distance_to_landmark_km": _distance_km(raw.get("Distance to Landmark")),
                    "price_inr": round(price, 2),
                    "tax_inr": round(tax, 2) if tax is not None else None,
                    "estimated_tax_inr": estimated,
                    "tax_is_estimated": tax_is_estimated,
                    "total_price_per_night_inr": round(price + tax_component, 2),
                    "is_luxury_outlier": price > 50000,
                })

    deduplicated: dict[tuple[str, str], dict[str, Any]] = {}
    for row in parsed:
        key = (row["city"].casefold(), row["hotel_name"].casefold())
        # Keep the first appearance in the raw file ordering deterministically.
        deduplicated.setdefault(key, row)
    duplicate_count = len(parsed) - len(deduplicated)
    ordered = sorted(deduplicated.values(), key=lambda row: (row["city"], row["hotel_name"].casefold()))
    for hotel_id, row in enumerate(ordered, 1):
        row["hotel_id"] = hotel_id
    return ordered, raw_count, duplicate_count, invalid_count


def _write_hotels(rows: list[dict[str, Any]]) -> None:
    CURATED_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(FLIGHTS_DB))
    try:
        con.execute("BEGIN TRANSACTION")
        con.execute("DROP TABLE IF EXISTS hotels")
        con.execute("""
            CREATE TABLE hotels (
                hotel_id INTEGER PRIMARY KEY,
                city VARCHAR NOT NULL,
                hotel_name VARCHAR NOT NULL,
                rating DOUBLE,
                rating_description VARCHAR,
                reviews INTEGER NOT NULL,
                star_rating DOUBLE,
                location VARCHAR,
                nearest_landmark VARCHAR,
                distance_to_landmark_km DOUBLE,
                price_inr DOUBLE NOT NULL,
                tax_inr DOUBLE,
                estimated_tax_inr DOUBLE,
                tax_is_estimated BOOLEAN NOT NULL,
                total_price_per_night_inr DOUBLE NOT NULL,
                is_luxury_outlier BOOLEAN NOT NULL
            )
        """)
        values = [tuple(row[column] for column in HOTEL_COLUMNS) for row in rows]
        placeholders = ", ".join("?" for _ in HOTEL_COLUMNS)
        con.executemany(f"INSERT INTO hotels VALUES ({placeholders})", values)
        parquet_sql_path = str(HOTELS_PARQUET).replace("'", "''")
        con.execute(f"COPY hotels TO '{parquet_sql_path}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise
    finally:
        con.close()


def _flight_quality(con: duckdb.DuckDBPyConnection) -> dict[str, Any]:
    columns = [row[0] for row in con.execute("DESCRIBE flights").fetchall()]
    cursor = con.execute("SELECT * FROM flights")
    rows = [dict(zip(columns, values)) for values in cursor.fetchall()]
    curated_count = len(rows)

    source_csv = ROOT / "data" / "airlines_flights_data.csv"
    raw_count = curated_count
    if source_csv.is_file():
        with source_csv.open("r", encoding="utf-8-sig", newline="") as source:
            raw_count = sum(1 for _ in csv.DictReader(source))

    duplicate_key_count = 0
    if "flight_id" in columns:
        duplicate_key_count = curated_count - len({row.get("flight_id") for row in rows})
    duplicates_removed = max(duplicate_key_count, raw_count - curated_count, 0)
    invalid = 0
    for row in rows:
        if (row.get("flight_id") is None or float(row.get("price") or 0) <= 0
                or not _text(row.get("source_city")) or not _text(row.get("destination_city"))):
            invalid += 1
    prices = [float(row["price"]) for row in rows if row.get("price") is not None and float(row["price"]) > 0]
    completeness = _completeness(rows, columns)
    routes = {(row.get("source_city"), row.get("destination_city")) for row in rows
              if row.get("source_city") and row.get("destination_city")}
    metrics = {
        "total_raw_rows": raw_count,
        "total_curated_rows": curated_count,
        "duplicates_removed": duplicates_removed,
        "duplicate_rate_pct": round(100 * duplicates_removed / raw_count, 2) if raw_count else 0.0,
        "completeness_pct": completeness,
        "validity_pass_rate_pct": _percent(curated_count - invalid, curated_count),
        "quarantined_rows": invalid,
        "luxury_outliers_flagged": 0,
        "cities_covered": sorted({str(row.get("source_city")) for row in rows if row.get("source_city")}
                                  | {str(row.get("destination_city")) for row in rows if row.get("destination_city")}),
        "routes_or_properties_count": len(routes),
        "price_summary": _price_summary(prices),
        "price_summary_inr": _price_summary(prices),
    }
    return metrics


def _hotel_quality(rows: list[dict[str, Any]], raw_count: int, duplicates: int,
                   quarantined: int) -> dict[str, Any]:
    prices = [float(row["price_inr"]) for row in rows]
    completeness = _completeness(rows, HOTEL_COLUMNS)
    return {
        "total_raw_rows": raw_count,
        "total_curated_rows": len(rows),
        "duplicates_removed": duplicates,
        "duplicate_rate_pct": round(100 * duplicates / raw_count, 2) if raw_count else 0.0,
        "completeness_pct": completeness,
        "validity_pass_rate_pct": _percent(raw_count - quarantined, raw_count),
        "quarantined_rows": quarantined,
        "luxury_outliers_flagged": sum(row["is_luxury_outlier"] for row in rows),
        "cities_covered": sorted({row["city"] for row in rows}),
        "routes_or_properties_count": len(rows),
        "price_summary": _price_summary(prices),
        "price_summary_inr": _price_summary(prices),
        "tax_is_estimated_count": sum(row["tax_is_estimated"] for row in rows),
    }


def main() -> None:
    if not FLIGHTS_DB.is_file():
        raise FileNotFoundError(f"Flight catalog not found: {FLIGHTS_DB}")
    hotels, hotel_raw_count, hotel_duplicates, hotel_quarantined = _read_hotels()
    _write_hotels(hotels)

    con = duckdb.connect(str(FLIGHTS_DB), read_only=True)
    try:
        tables = {row[0] for row in con.execute("SHOW TABLES").fetchall()}
        if "flights" not in tables:
            raise RuntimeError("The DuckDB catalog does not contain the required flights table")
        flights_quality = _flight_quality(con)
        hotel_count = con.execute("SELECT COUNT(*) FROM hotels").fetchone()[0]
    finally:
        con.close()
    if hotel_count != len(hotels):
        raise RuntimeError(f"Hotel table count mismatch: expected {len(hotels)}, found {hotel_count}")

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    report = {
        "generated_at": generated_at,
        "datasets": {
            "flights": {"generated_at": generated_at, **flights_quality},
            "hotels": {"generated_at": generated_at,
                       **_hotel_quality(hotels, hotel_raw_count, hotel_duplicates, hotel_quarantined)},
        },
    }
    CURATED_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Hotels curated: {len(hotels)} rows (from {hotel_raw_count}; duplicates {hotel_duplicates}; quarantined {hotel_quarantined})")
    print(f"Hotels table: {FLIGHTS_DB} ({hotel_count} rows)")
    print(f"Hotel Parquet: {HOTELS_PARQUET}")
    print(f"Data quality report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
