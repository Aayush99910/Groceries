"""SQLite plumbing: where the file lives, how to open it, how to set it up.

There is no ORM here on purpose. Every query in this project is SQL you can
read, copy into the `sqlite3` CLI, and run by hand.
"""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.environ.get("GROCERY_DATA_DIR", BACKEND_DIR / "data"))
PHOTO_DIR = DATA_DIR / "photos"
DB_PATH = DATA_DIR / "groceries.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def connect() -> sqlite3.Connection:
    """Open a connection with the settings this app wants everywhere."""
    # check_same_thread=False because FastAPI resolves sync dependencies in a
    # worker thread but runs `async def` endpoints on the event loop thread, so
    # the connection legitimately crosses threads. Safe here: every request gets
    # its own connection and closes it, so no two threads share one.
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    # Rows come back index-able by column name: row["name"] instead of row[1].
    conn.row_factory = sqlite3.Row
    # SQLite ignores REFERENCES clauses unless you ask it not to, per connection.
    conn.execute("PRAGMA foreign_keys = ON")
    # Write-ahead logging: readers don't block the writer. Sensible default.
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PHOTO_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(SCHEMA_PATH.read_text())


def get_db():
    """FastAPI dependency: one connection per request, always closed."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: str) -> datetime:
    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
