"""
DuckDB read-only helper.

Every connection is opened with ``read_only=True`` so that
no runtime code can accidentally mutate the flight catalog.
"""

from __future__ import annotations

import duckdb

from backend.config import FLIGHTS_DB


def get_connection() -> duckdb.DuckDBPyConnection:
    """Return a **read-only** DuckDB connection to the flights catalog."""
    return duckdb.connect(str(FLIGHTS_DB), read_only=True)
