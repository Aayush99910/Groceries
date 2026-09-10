"""Delete photo files that no row points at any more.

Deleting a single purchase cleans up its own photo, but a cascade (deleting an
account, say) removes the rows without touching the files on disk. Run this
occasionally; it never deletes anything still referenced.

    cd backend && ./.venv/bin/python prune_photos.py          # show what it would do
    cd backend && ./.venv/bin/python prune_photos.py --delete  # actually delete
"""

import sqlite3
import sys

from app.db import DB_PATH, PHOTO_DIR


def main() -> None:
    dry_run = "--delete" not in sys.argv

    conn = sqlite3.connect(DB_PATH)
    referenced = {r[0] for r in conn.execute("SELECT photo FROM items WHERE photo IS NOT NULL")}
    referenced |= {r[0] for r in conn.execute("SELECT photo FROM purchases WHERE photo IS NOT NULL")}
    conn.close()

    on_disk = sorted(p for p in PHOTO_DIR.glob("*.jpg"))
    orphans = [p for p in on_disk if p.name not in referenced]

    freed = sum(p.stat().st_size for p in orphans)
    print(f"{len(on_disk)} files on disk, {len(referenced)} referenced, {len(orphans)} orphaned")

    if not orphans:
        return

    for path in orphans:
        print(f"  {'would delete' if dry_run else 'deleting'} {path.name}")
        if not dry_run:
            path.unlink()

    print(f"{'would free' if dry_run else 'freed'} {freed / 1024:.0f} KB")
    if dry_run:
        print("re-run with --delete to remove them")


if __name__ == "__main__":
    main()
