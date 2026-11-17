"""Postgres plumbing: where the database is, how to open it, how to set it up.

There is no ORM here on purpose. Every query in this project is SQL you can
read, paste into `psql`, and run by hand.

This used to be SQLite on local disk. It moved to Postgres because the app now
runs on a host with an *ephemeral* filesystem -- anything written to disk is
wiped on every deploy and restart -- so the database had to live somewhere that
outlives the container.
"""

import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# Kept only so the one-off SQLite->Postgres migration can find the old photos.
LEGACY_DATA_DIR = Path(os.environ.get("GROCERY_DATA_DIR", BACKEND_DIR / "data"))
LEGACY_PHOTO_DIR = LEGACY_DATA_DIR / "photos"


def _load_env_file() -> None:
    """Read backend/.env into the environment, without overriding real env vars.

    Locally the connection string lives in a gitignored .env. On a host it comes
    from the platform's environment, which must win -- hence setdefault.
    """
    path = BACKEND_DIR / ".env"
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


_load_env_file()


def database_url() -> str:
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise RuntimeError(
            "DATABASE_URL is not set. Locally: put it in backend/.env. "
            "On a host: set it as an environment variable."
        )
    return url


def connect() -> psycopg.Connection:
    """Open a connection with the settings this app wants everywhere."""
    # dict_row makes rows subscriptable by column name -- row["name"] -- which is
    # what the old sqlite3.Row did, so the query code didn't have to change.
    return psycopg.connect(database_url(), row_factory=dict_row, connect_timeout=15)


def init_db() -> None:
    with connect() as conn:
        conn.execute(SCHEMA_PATH.read_text())
        conn.commit()


def get_db():
    """FastAPI dependency: one connection per request, always closed."""
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()


def utcnow_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


def parse_iso(value: str):
    from datetime import datetime, timezone

    dt = datetime.fromisoformat(value)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
