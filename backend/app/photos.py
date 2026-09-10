"""Photo handling.

Deliberately dumb: no recognition, no model, no LLM. A phone photo straight off
the camera is several megabytes, so all we do is shrink it and store it. Its job
is to jog her memory next to "did you like this?".
"""

import io
import uuid

from PIL import Image, ImageOps

from .db import PHOTO_DIR

MAX_EDGE = 900  # plenty for a phone-sized card
JPEG_QUALITY = 80


def save_photo(raw: bytes) -> str:
    """Resize to something sane and write it out. Returns the filename."""
    image = Image.open(io.BytesIO(raw))
    # Phones record rotation in EXIF rather than rotating the pixels.
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")
    image.thumbnail((MAX_EDGE, MAX_EDGE))

    filename = f"{uuid.uuid4().hex}.jpg"
    image.save(PHOTO_DIR / filename, "JPEG", quality=JPEG_QUALITY, optimize=True)
    return filename


def delete_photo(filename: str | None) -> None:
    if not filename:
        return
    (PHOTO_DIR / filename).unlink(missing_ok=True)
