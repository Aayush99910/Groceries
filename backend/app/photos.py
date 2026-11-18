"""Photo handling.

Deliberately dumb: no recognition, no model, no LLM. A phone photo straight off
the camera is several megabytes, so all we do is shrink it and store it. Its job
is to jog her memory next to "did you like this?".

Photos live in Postgres as BYTEA rather than on disk, because the host's
filesystem is ephemeral -- wiped on every deploy. See the comment on the `photos`
table in schema.sql for why a database column beats object storage at this size,
and when that stops being true.
"""

import io
import uuid

import psycopg
from PIL import Image, ImageOps

from .db import utcnow_iso

MAX_EDGE = 900  # plenty for a phone-sized card
JPEG_QUALITY = 80


def resize(raw: bytes) -> bytes:
    """Shrink a phone photo to something worth storing. Returns JPEG bytes."""
    image = Image.open(io.BytesIO(raw))
    # Phones record rotation in EXIF rather than rotating the pixels.
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE))

    out = io.BytesIO()
    image.save(out, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return out.getvalue()


AVATAR_EDGE = 360  # shown at most ~90px wide; 4x covers retina with room to spare


def resize_square(raw: bytes) -> bytes:
    """Centre-crop to a square and shrink: what a profile picture wants."""
    image = Image.open(io.BytesIO(raw))
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image = ImageOps.fit(image, (AVATAR_EDGE, AVATAR_EDGE), method=Image.LANCZOS)

    out = io.BytesIO()
    image.save(out, "JPEG", quality=85, optimize=True)
    return out.getvalue()


def save_photo(db: psycopg.Connection, user_id: int, raw: bytes, square: bool = False) -> str:
    """Resize and store. Returns the id, which is what item/purchase rows hold.

    `square` crops to a centred square, for profile pictures."""
    photo_id = f"{uuid.uuid4().hex}.jpg"
    db.execute(
        "INSERT INTO photos (id, user_id, bytes, created_at) VALUES (%s, %s, %s, %s)",
        (photo_id, user_id, resize_square(raw) if square else resize(raw), utcnow_iso()),
    )
    db.commit()
    return photo_id


def load_photo(db: psycopg.Connection, user_id: int, photo_id: str) -> bytes | None:
    """The bytes, but only if they belong to this account."""
    row = db.execute(
        "SELECT bytes FROM photos WHERE id = %s AND user_id = %s", (photo_id, user_id)
    ).fetchone()
    return bytes(row["bytes"]) if row else None


def delete_photo(db: psycopg.Connection, photo_id: str | None) -> None:
    """Items and purchases reference photos with ON DELETE SET NULL, so removing
    a photo quietly detaches it from anything still pointing at it."""
    if not photo_id:
        return
    db.execute("DELETE FROM photos WHERE id = %s", (photo_id,))
    db.commit()
