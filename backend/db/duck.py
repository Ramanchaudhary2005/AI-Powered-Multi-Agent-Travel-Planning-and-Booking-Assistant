"""
DuckDB read-only helper.

Every connection is opened with ``read_only=True`` so that
no runtime code can accidentally mutate the flight catalog.
"""

from __future__ import annotations

import duckdb
from threading import Lock

from backend.config import FLIGHTS_DB

_connection = None
_connection_lock = Lock()


def warm_connection() -> None:
    """Open the catalog once so the first request avoids connection setup."""
    global _connection
    if _connection is None:
        with _connection_lock:
            if _connection is None:
                _connection = duckdb.connect(str(FLIGHTS_DB), read_only=True)


def get_connection() -> duckdb.DuckDBPyConnection:
    """Return an isolated thread-safe cursor on a persistent read-only catalog."""
    warm_connection()
    return _connection.cursor()
