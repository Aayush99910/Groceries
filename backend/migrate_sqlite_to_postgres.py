"""One-off: move the old SQLite database and its photo files into Postgres.

Run once, from the backend directory, with DATABASE_URL pointing at the target:

    ./.venv/bin/python migrate_sqlite_to_postgres.py           # dry run
    ./.venv/bin/python migrate_sqlite_to_postgres.py --write   # actually do it

Two things it is careful about:

* **IDs are preserved.** Foreign keys reference them, so renumbering would
  scramble which purchase belongs to which item. Afterwards the identity
  sequences are fast-forwarded past the highest id, or the next INSERT would
  collide with a row that already exists.
* **Photos were files on disk** with no owner recorded anywhere. The owner is
  recovered by looking at which user's items or purchases referenced the
  filename; a photo nothing references is skipped rather than guessed at.
"""

import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.db import LEGACY_PHOTO_DIR, connect, utcnow_iso  # noqa: E402

SQLITE_PATH = Path(__file__).resolve().parent / "data" / "groceries.db"
WRITE = "--write" in sys.argv


def main() -> None:
    if not SQLITE_PATH.is_file():
        print(f"No SQLite database at {SQLITE_PATH}")
        return

    old = sqlite3.connect(SQLITE_PATH)
    old.row_factory = sqlite3.Row

    users = old.execute("SELECT * FROM users ORDER BY id").fetchall()
    items = old.execute("SELECT * FROM items ORDER BY id").fetchall()
    hauls = old.execute("SELECT * FROM hauls ORDER BY id").fetchall()
    purchases = old.execute("SELECT * FROM purchases ORDER BY id").fetchall()
    sessions = old.execute("SELECT * FROM sessions").fetchall()

    # Which account does each photo file belong to?
    owner: dict[str, int] = {}
    for r in items:
        if r["photo"]:
            owner.setdefault(r["photo"], r["user_id"])
    for r in purchases:
        if r["photo"]:
            owner.setdefault(r["photo"], r["user_id"])

    photos: list[tuple[str, int, bytes]] = []
    missing = 0
    for name, user_id in owner.items():
        path = LEGACY_PHOTO_DIR / name
        if path.is_file():
            photos.append((name, user_id, path.read_bytes()))
        else:
            missing += 1

    total_bytes = sum(len(b) for _, _, b in photos)
    print(f"  users      {len(users)}")
    print(f"  photos     {len(photos)}  ({total_bytes / 1024 / 1024:.1f} MB)"
          + (f"  [{missing} referenced but not on disk]" if missing else ""))
    print(f"  items      {len(items)}")
    print(f"  hauls      {len(hauls)}")
    print(f"  purchases  {len(purchases)}")
    print(f"  sessions   {len(sessions)}  (migrated so signed-in phones stay signed in)")

    if not WRITE:
        print("\n  dry run — re-run with --write to apply")
        return

    with connect() as pg:
        existing = pg.execute("SELECT count(*) AS n FROM users").fetchone()["n"]
        if existing:
            print(f"\n  REFUSING: target already has {existing} users. "
                  "Migrating twice would duplicate everything.")
            return

        # Order matters: every table below references the ones above it.
        for r in users:
            pg.execute(
                """INSERT INTO users (id, email, email_key, display_name, password_hash, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (r["id"], r["email"], r["email_key"], r["display_name"],
                 r["password_hash"], r["created_at"]),
            )

        for name, user_id, blob in photos:
            pg.execute(
                "INSERT INTO photos (id, user_id, bytes, created_at) VALUES (%s, %s, %s, %s)",
                (name, user_id, blob, utcnow_iso()),
            )

        stored = {name for name, _, _ in photos}
        for r in items:
            pg.execute(
                """INSERT INTO items (id, user_id, name, name_key, category, photo, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (r["id"], r["user_id"], r["name"], r["name_key"], r["category"],
                 r["photo"] if r["photo"] in stored else None, r["created_at"]),
            )

        for r in hauls:
            pg.execute(
                """INSERT INTO hauls (id, user_id, store, store_key, shopped_on, created_at)
                   VALUES (%s, %s, %s, %s, %s, %s)""",
                (r["id"], r["user_id"], r["store"], r["store_key"],
                 r["shopped_on"], r["created_at"]),
            )

        for r in purchases:
            pg.execute(
                """INSERT INTO purchases
                       (id, user_id, item_id, haul_id, price_cents, photo,
                        purchased_at, liked, rated_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (r["id"], r["user_id"], r["item_id"], r["haul_id"], r["price_cents"],
                 r["photo"] if r["photo"] in stored else None, r["purchased_at"],
                 # 0/1/NULL becomes a real boolean.
                 None if r["liked"] is None else bool(r["liked"]),
                 r["rated_at"]),
            )

        for r in sessions:
            pg.execute(
                """INSERT INTO sessions (token, user_id, created_at, last_seen_at)
                   VALUES (%s, %s, %s, %s)""",
                (r["token"], r["user_id"], r["created_at"], r["last_seen_at"]),
            )

        # Explicit ids were supplied, so the identity sequences are still at 1.
        for table in ("users", "items", "hauls", "purchases"):
            pg.execute(
                f"""SELECT setval(pg_get_serial_sequence('{table}', 'id'),
                                  COALESCE((SELECT MAX(id) FROM {table}), 1))"""
            )

        pg.commit()
        print("\n  migrated. verifying:")
        for table in ("users", "photos", "items", "hauls", "purchases", "sessions"):
            n = pg.execute(f"SELECT count(*) AS n FROM {table}").fetchone()["n"]
            print(f"    {table:10} {n}")


if __name__ == "__main__":
    main()
