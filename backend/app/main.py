"""The API.

Three things happen in this app:

  1. In the store, log what was bought   -> POST /api/purchases
  2. Later at home, rate what was eaten  -> POST /api/purchases/{id}/rate
  3. Next trip, open the list            -> GET  /api/shopping-list

Everything else exists to keep those three fast, to stop item names from drifting
into duplicates, and to keep each account's history to itself.

Every data route depends on `current_user` and filters by user_id. That is the
only thing standing between two accounts, so it is not optional anywhere.
"""

import csv
import io
import json
import os
import re
import psycopg
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import auth
from .db import get_db, init_db, parse_iso, utcnow_iso
from .pdf_export import build_pdf
from .photos import delete_photo, load_photo, save_photo
from .places import PlacesUnavailable, find_nearby, search_places
from .seed import CATEGORY_LABELS, CATEGORY_ORDER, COMMON_ITEMS, guess_category
from .text import format_price, key_for, normalize, parse_price_cents, rank_matches

MAX_PHOTO_BYTES = 12 * 1024 * 1024

# Set GROCERY_HTTPS=1 once this is served over TLS (any real host gives you TLS).
# It marks the session cookie Secure, so the browser refuses to send it over
# plain http. Off by default because a Secure cookie is silently dropped on the
# http:// LAN setup, which would look like "login does nothing".
COOKIE_SECURE = os.environ.get("GROCERY_HTTPS", "").strip() in {"1", "true", "yes"}
_PHOTO_NAME_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()  # creates data/groceries.db and the tables on first run
    yield


app = FastAPI(title="Groceries", version="0.2.0", lifespan=lifespan)

# Vite's dev server runs on a different port, so the browser needs permission --
# and allow_credentials, or the session cookie won't be sent.
# Extra origins for the deployed frontend, comma-separated, e.g.
#   GROCERY_ALLOWED_ORIGINS=https://groceries.netlify.app
# Usually unnecessary: Netlify proxies /api and /photos server-side (see
# netlify.toml), so the browser sees one origin and never sends a CORS preflight.
_EXTRA_ORIGINS = [
    o.strip() for o in os.environ.get("GROCERY_ALLOWED_ORIGINS", "").split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *_EXTRA_ORIGINS],
    allow_origin_regex=r"http://(192\.168|10\.)[\d.]+:5173",  # phone on your wifi
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz(db: psycopg.Connection = Depends(get_db)):
    """Liveness for the host's health check.

    Touches the database on purpose: a process that is running but can't reach
    Postgres is not actually healthy, and saying so lets the host restart it.
    """
    db.execute("SELECT 1")
    return {"ok": True}


# --------------------------------------------------------------------------
# who is asking
# --------------------------------------------------------------------------


def current_user(
    groceries_session: str | None = Cookie(None),
    db: psycopg.Connection = Depends(get_db),
):
    """The logged-in account, or a 401. Every data route depends on this."""
    user = auth.user_for_session(db, groceries_session)
    if user is None:
        raise HTTPException(401, "Please sign in")
    return user


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        auth.COOKIE_NAME,
        token,
        max_age=auth.SESSION_DAYS * 24 * 3600,
        httponly=True,  # page scripts can't read it, so XSS can't steal it
        samesite="lax",
        path="/",
        secure=COOKIE_SECURE,
    )


class Credentials(BaseModel):
    email: str
    password: str
    display_name: str | None = None


def _public_user(user) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "display_name": user["display_name"],
        "created_at": user["created_at"],
        # A photo id, served from /photos/{id} like any other (so it's private to
        # her account). None until she adds one.
        "avatar": user["avatar"],
    }


@app.post("/api/auth/signup")
def signup(
    body: Credentials,
    response: Response,
    request: Request,
    db: psycopg.Connection = Depends(get_db),
):
    if not auth.email_looks_valid(body.email):
        raise HTTPException(400, "That doesn't look like an email address")
    problem = auth.password_problem(body.password)
    if problem:
        raise HTTPException(400, problem)
    if auth.find_user_by_email(db, body.email):
        raise HTTPException(409, "There's already an account with that email")

    user = auth.create_user(db, body.email, body.password, body.display_name)
    auth.clear_failures(request.client.host if request.client else "?")
    _set_session_cookie(response, auth.create_session(db, user["id"]))
    return {"user": _public_user(user)}


@app.post("/api/auth/login")
def login(
    body: Credentials,
    response: Response,
    request: Request,
    db: psycopg.Connection = Depends(get_db),
):
    client = request.client.host if request.client else "?"
    wait = auth.lockout_remaining(client)
    if wait:
        raise HTTPException(429, f"Too many attempts. Try again in {wait // 60 + 1} min")

    user = auth.find_user_by_email(db, body.email)
    # Same message either way: saying "no such account" tells an attacker which
    # emails are registered.
    if not user or not auth.verify_password(body.password, user["password_hash"]):
        auth.record_failure(client)
        raise HTTPException(401, "Wrong email or password")

    auth.clear_failures(client)
    _set_session_cookie(response, auth.create_session(db, user["id"]))
    return {"user": _public_user(user)}


class ProfileUpdate(BaseModel):
    display_name: str | None = None


@app.patch("/api/auth/me")
def update_me(
    body: ProfileUpdate,
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    name = (body.display_name or "").strip()
    if len(name) > 60:
        raise HTTPException(400, "That name is too long")
    row = db.execute(
        "UPDATE users SET display_name = %s WHERE id = %s RETURNING *",
        (name or None, user["id"]),
    ).fetchone()
    db.commit()
    return {"user": _public_user(row)}


@app.post("/api/auth/avatar")
async def set_avatar(
    photo: UploadFile = File(...),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    """Set or replace the profile picture."""
    raw = await photo.read()
    if not raw:
        raise HTTPException(400, "That file was empty")
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(413, "That photo is too big")
    try:
        new_id = save_photo(db, user["id"], raw, square=True)
    except Exception:
        raise HTTPException(400, "Couldn't read that photo")

    old_id = user["avatar"]
    row = db.execute(
        "UPDATE users SET avatar = %s WHERE id = %s RETURNING *", (new_id, user["id"])
    ).fetchone()
    db.commit()
    # The old picture would otherwise sit in the table forever, unreferenced.
    delete_photo(db, old_id)
    return {"user": _public_user(row)}


@app.delete("/api/auth/avatar")
def remove_avatar(
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    old_id = user["avatar"]
    row = db.execute(
        "UPDATE users SET avatar = NULL WHERE id = %s RETURNING *", (user["id"],)
    ).fetchone()
    db.commit()
    delete_photo(db, old_id)
    return {"user": _public_user(row)}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/auth/password")
def change_password(
    body: PasswordChange,
    request: Request,
    groceries_session: str | None = Cookie(None),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    # 400, never 401: the frontend treats 401 as "your session is gone" and would
    # bounce her to the login screen for simply mistyping her current password.
    client = request.client.host if request.client else "?"
    wait = auth.lockout_remaining(client)
    if wait:
        raise HTTPException(429, f"Too many attempts. Try again in {wait // 60 + 1} min")
    if not auth.verify_password(body.current_password, user["password_hash"]):
        auth.record_failure(client)
        raise HTTPException(400, "Your current password isn't right")
    problem = auth.password_problem(body.new_password)
    if problem:
        raise HTTPException(400, problem)

    db.execute(
        "UPDATE users SET password_hash = %s WHERE id = %s",
        (auth.hash_password(body.new_password), user["id"]),
    )
    # Every other signed-in device is signed out: if the old password had leaked,
    # changing it should actually lock that person out. This device stays in.
    db.execute(
        "DELETE FROM sessions WHERE user_id = %s AND token <> %s",
        (user["id"], groceries_session),
    )
    db.commit()
    auth.clear_failures(client)
    return {"ok": True}


@app.post("/api/auth/logout")
def logout(
    response: Response,
    groceries_session: str | None = Cookie(None),
    db: psycopg.Connection = Depends(get_db),
):
    auth.destroy_session(db, groceries_session)
    response.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(
    groceries_session: str | None = Cookie(None),
    db: psycopg.Connection = Depends(get_db),
):
    """Never 401s -- the frontend calls this on load to decide which screen to show."""
    user = auth.user_for_session(db, groceries_session)
    return {"user": _public_user(user) if user else None}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------


def _days_ago_phrase(iso: str) -> str:
    days = (datetime.now(timezone.utc) - parse_iso(iso)).days
    if days <= 0:
        return "today"
    if days == 1:
        return "yesterday"
    if days < 14:
        return f"{days} days ago"
    if days < 60:
        return f"{days // 7} weeks ago"
    return f"{days // 30} months ago"


def _find_or_create_item(
    db: psycopg.Connection, user_id: int, name: str, photo: str | None
) -> dict:
    """One row per thing, per account. Where duplicate prevention lands."""
    display = normalize(name)
    if not display:
        raise HTTPException(400, "Item name can't be empty")

    key = key_for(display)
    row = db.execute(
        "SELECT * FROM items WHERE user_id = %s AND name_key = %s", (user_id, key)
    ).fetchone()
    if row:
        # Freshen the display photo so the newest picture is the one shown.
        if photo:
            db.execute("UPDATE items SET photo = %s WHERE id = %s", (photo, row["id"]))
            db.commit()
            row = db.execute("SELECT * FROM items WHERE id = %s", (row["id"],)).fetchone()
        return row

    row = db.execute(
        """INSERT INTO items (user_id, name, name_key, category, photo, created_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING *""",
        (user_id, display, key, guess_category(display), photo, utcnow_iso()),
    ).fetchone()
    db.commit()
    return row


def store_key_for(display: str, place_id: str | None) -> str:
    """What makes two trips "the same store".

    OpenStreetMap's place_id when we have one, because it is stable: the same shop
    looked up twice is the same store even if the address comes back worded
    differently. Stores she typed by hand have no place_id and fall back to the
    normalised name, which is what the whole app did before.

    The osm: prefix keeps the two kinds of key from ever colliding.
    """
    return f"osm:{place_id}" if place_id else key_for(display)


def _find_or_create_haul(
    db: psycopg.Connection,
    user_id: int,
    store: str,
    place_id: str | None = None,
    lat: float | None = None,
    lon: float | None = None,
) -> dict:
    """A trip is 'one store, one day' -- inferred, so nobody taps 'start trip'."""
    display = normalize(store) or "Unknown store"
    key = store_key_for(display, place_id)
    today = datetime.now().date().isoformat()

    row = db.execute(
        "SELECT * FROM hauls WHERE user_id = %s AND store_key = %s AND shopped_on = %s",
        (user_id, key, today),
    ).fetchone()
    if row:
        # The label can improve between lookups (a street where there was only a
        # neighbourhood). Keep the better one; the key is what holds identity.
        if place_id and (not row["place_id"] or len(display) > len(row["store"])):
            row = db.execute(
                """UPDATE hauls SET store = %s, place_id = %s, lat = %s, lon = %s
                   WHERE id = %s RETURNING *""",
                (display, place_id, lat, lon, row["id"]),
            ).fetchone()
            db.commit()
        return row

    row = db.execute(
        """INSERT INTO hauls (user_id, store, store_key, shopped_on, created_at,
                              place_id, lat, lon)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
           RETURNING *""",
        (user_id, display, key, today, utcnow_iso(), place_id, lat, lon),
    ).fetchone()
    db.commit()
    return row


def _purchase_payload(row: dict) -> dict:
    return {
        "id": row["id"],
        "item_id": row["item_id"],
        "item_name": row["item_name"],
        "category": row["category"],
        "store": row["store"],
        "photo": row["photo"] or row["item_photo"],
        "price": format_price(row["price_cents"]),
        "price_cents": row["price_cents"],
        "purchased_at": row["purchased_at"],
        "when": _days_ago_phrase(row["purchased_at"]),
        "liked": None if row["liked"] is None else bool(row["liked"]),
    }


_PURCHASE_SELECT = """
    SELECT p.*, i.name AS item_name, i.category, i.photo AS item_photo, h.store
    FROM purchases p
    JOIN items i ON i.id = p.item_id
    JOIN hauls h ON h.id = p.haul_id
"""


# --------------------------------------------------------------------------
# 1. logging a purchase, in the store
# --------------------------------------------------------------------------


@app.post("/api/purchases")
async def log_purchase(
    name: str = Form(...),
    store: str = Form(...),
    price: str | None = Form(None),
    photo: UploadFile | None = File(None),
    # Which branch, when she picked it off the map rather than typing it. Optional
    # on purpose: a hand-typed store still works exactly as before.
    place_id: str | None = Form(None),
    lat: float | None = Form(None),
    lon: float | None = Form(None),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    """Log one thing just bought. The date comes from here, not from her."""
    photo_name: str | None = None
    if photo is not None and photo.filename:
        raw = await photo.read()
        if len(raw) > MAX_PHOTO_BYTES:
            raise HTTPException(413, "That photo is too big")
        if raw:
            try:
                photo_name = save_photo(db, user["id"], raw)
            except Exception:
                raise HTTPException(400, "Couldn't read that photo")

    item = _find_or_create_item(db, user["id"], name, photo_name)
    haul = _find_or_create_haul(db, user["id"], store, place_id, lat, lon)

    new_id = db.execute(
        """INSERT INTO purchases (user_id, item_id, haul_id, price_cents, photo, purchased_at)
           VALUES (%s, %s, %s, %s, %s, %s)
           RETURNING id""",
        (user["id"], item["id"], haul["id"], parse_price_cents(price), photo_name, utcnow_iso()),
    ).fetchone()["id"]
    db.commit()

    count = db.execute(
        "SELECT COUNT(*) AS n FROM purchases WHERE haul_id = %s", (haul["id"],)
    ).fetchone()["n"]
    row = db.execute(_PURCHASE_SELECT + " WHERE p.id = %s", (new_id,)).fetchone()

    return {
        "purchase": _purchase_payload(row),
        "haul": {"id": haul["id"], "store": haul["store"], "item_count": count},
    }


@app.get("/api/suggest/items")
def suggest_items(
    q: str = Query("", max_length=80),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    """Autocomplete. Her own history first, then common groceries.

    Picking from this list is the difference between one 'Milk' with real history
    and three near-duplicates with none.
    """
    known = [
        r["name"]
        for r in db.execute(
            "SELECT name FROM items WHERE user_id = %s ORDER BY name", (user["id"],)
        ).fetchall()
    ]
    known_keys = {key_for(n) for n in known}
    fallback = [n for n in COMMON_ITEMS if key_for(n) not in known_keys]

    mine = rank_matches(q, known, limit=6)
    theirs = rank_matches(q, fallback, limit=6)
    combined = mine + [n for n in theirs if n not in mine]
    return {"suggestions": combined[:8], "known": [n in known for n in combined[:8]]}


class NearbyQuery(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)


class PlaceSearch(BaseModel):
    q: str = Field(..., min_length=2, max_length=80)
    lat: float | None = Field(None, ge=-90, le=90)
    lon: float | None = Field(None, ge=-180, le=180)


# These are POST on purpose, though they only read. A GET puts the coordinates (and
# what she typed) in the URL, and URLs get written to access logs, here and at every
# layer in front of us. A body doesn't.
@app.post("/api/places/nearby")
def places_nearby(body: NearbyQuery, user=Depends(current_user)):
    """Grocery stores near a point, nearest first. Sign-in required, so this isn't an
    open proxy to the lookup service. Coordinates are never stored or logged."""
    try:
        return {"places": find_nearby(body.lat, body.lon)}
    except PlacesUnavailable:
        # 502, not 401: the frontend reads 401 as "your session is gone".
        raise HTTPException(502, "Store lookup isn't available right now")


@app.post("/api/places/search")
def places_search(body: PlaceSearch, user=Depends(current_user)):
    """Shops matching a name, nearest first when lat/lon are given."""
    try:
        return {"places": search_places(body.q.strip(), body.lat, body.lon)}
    except PlacesUnavailable:
        raise HTTPException(502, "Store lookup isn't available right now")


@app.get("/api/suggest/stores")
def suggest_stores(
    q: str = Query("", max_length=80),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    stores = [
        r["store"]
        for r in db.execute(
            # MAX(store) rather than a bare `store`: the grouping key is
            # store_key (the normalised form), and Postgres requires every
            # selected column to be grouped or aggregated. SQLite allowed the
            # bare column and silently picked an arbitrary row.
            """SELECT MAX(store) AS store, MAX(created_at) AS recent FROM hauls
               WHERE user_id = %s GROUP BY store_key ORDER BY recent DESC""",
            (user["id"],),
        ).fetchall()
    ]
    return {"suggestions": rank_matches(q, stores, limit=6) if q else stores[:6]}


# --------------------------------------------------------------------------
# 2. rating the haul, at home
# --------------------------------------------------------------------------


@app.get("/api/hauls")
def list_hauls(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT h.id, h.store, h.shopped_on,
                  COUNT(p.id) AS item_count,
                  SUM(CASE WHEN p.liked IS NULL THEN 1 ELSE 0 END) AS unrated,
                  SUM(COALESCE(p.price_cents, 0)) AS total_cents
           FROM hauls h
           LEFT JOIN purchases p ON p.haul_id = h.id
           WHERE h.user_id = %s
           GROUP BY h.id
           HAVING COUNT(p.id) > 0
           ORDER BY h.shopped_on DESC, h.id DESC""",
        (user["id"],),
    ).fetchall()
    return {
        "hauls": [
            {
                "id": r["id"],
                "store": r["store"],
                "shopped_on": r["shopped_on"],
                "item_count": r["item_count"],
                "unrated": r["unrated"],
                "total": format_price(r["total_cents"]) if r["total_cents"] else None,
            }
            for r in rows
        ]
    }


@app.get("/api/hauls/{haul_id}")
def get_haul(
    haul_id: int, user=Depends(current_user), db: psycopg.Connection = Depends(get_db)
):
    haul = db.execute(
        "SELECT * FROM hauls WHERE id = %s AND user_id = %s", (haul_id, user["id"])
    ).fetchone()
    if not haul:
        raise HTTPException(404, "No such haul")
    rows = db.execute(
        _PURCHASE_SELECT + " WHERE p.haul_id = %s ORDER BY p.id DESC", (haul_id,)
    ).fetchall()
    return {
        "haul": {"id": haul["id"], "store": haul["store"], "shopped_on": haul["shopped_on"]},
        "purchases": [_purchase_payload(r) for r in rows],
    }


@app.get("/api/purchases/recent")
def recent_purchases(
    limit: int = Query(15, ge=1, le=100),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    """The last few things logged, newest first.

    Shown under the Log form so a mistyped entry can be deleted immediately,
    while she still remembers making it.
    """
    rows = db.execute(
        _PURCHASE_SELECT
        + " WHERE p.user_id = %s ORDER BY p.purchased_at DESC, p.id DESC LIMIT %s",
        (user["id"], limit),
    ).fetchall()
    return {"purchases": [_purchase_payload(r) for r in rows]}


@app.get("/api/rate/pending")
def pending_ratings(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    """"Rate your last haul" -- everything bought but not yet judged."""
    rows = db.execute(
        _PURCHASE_SELECT
        + """ WHERE p.user_id = %s AND p.liked IS NULL
              ORDER BY p.purchased_at DESC, p.id DESC""",
        (user["id"],),
    ).fetchall()
    return {"purchases": [_purchase_payload(r) for r in rows]}


class Rating(BaseModel):
    liked: bool


@app.post("/api/purchases/{purchase_id}/rate")
def rate_purchase(
    purchase_id: int,
    rating: Rating,
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    # The user_id in the WHERE clause is what stops one account rating another's
    # purchases by guessing an id.
    updated = db.execute(
        "UPDATE purchases SET liked = %s, rated_at = %s WHERE id = %s AND user_id = %s",
        (rating.liked, utcnow_iso(), purchase_id, user["id"]),
    ).rowcount
    db.commit()
    if not updated:
        raise HTTPException(404, "No such purchase")
    row = db.execute(_PURCHASE_SELECT + " WHERE p.id = %s", (purchase_id,)).fetchone()
    return {"purchase": _purchase_payload(row)}


@app.post("/api/purchases/{purchase_id}/unrate")
def unrate_purchase(
    purchase_id: int, user=Depends(current_user), db: psycopg.Connection = Depends(get_db)
):
    """Undo, because a mis-tap shouldn't be permanent."""
    updated = db.execute(
        "UPDATE purchases SET liked = NULL, rated_at = NULL WHERE id = %s AND user_id = %s",
        (purchase_id, user["id"]),
    ).rowcount
    db.commit()
    if not updated:
        raise HTTPException(404, "No such purchase")
    return {"ok": True}


@app.delete("/api/purchases/{purchase_id}")
def delete_purchase(
    purchase_id: int, user=Depends(current_user), db: psycopg.Connection = Depends(get_db)
):
    row = db.execute(
        "SELECT photo FROM purchases WHERE id = %s AND user_id = %s", (purchase_id, user["id"])
    ).fetchone()
    if not row:
        raise HTTPException(404, "No such purchase")
    db.execute("DELETE FROM purchases WHERE id = %s", (purchase_id,))
    db.commit()
    # Only drop the file if nothing still points at it for display.
    still_used = db.execute(
        "SELECT 1 FROM items WHERE photo = %s UNION SELECT 1 FROM purchases WHERE photo = %s",
        (row["photo"], row["photo"]),
    ).fetchone()
    if not still_used:
        delete_photo(db, row["photo"])
    return {"ok": True}


# --------------------------------------------------------------------------
# 3. the shopping list, next trip
# --------------------------------------------------------------------------


@app.get("/api/shopping-list")
def shopping_list(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    """What she liked, what she didn't, and where each thing was cheapest.

    Two buckets plus the not-yet-rated. Prices come from what was actually paid,
    per store.
    """
    rows = db.execute(
        """SELECT i.id, i.name, i.category, i.photo,
                  COUNT(p.id) AS times_bought,
                  SUM(CASE WHEN p.liked IS TRUE  THEN 1 ELSE 0 END) AS likes,
                  SUM(CASE WHEN p.liked IS FALSE THEN 1 ELSE 0 END) AS dislikes,
                  MAX(p.purchased_at) AS last_purchased_at
           FROM items i
           JOIN purchases p ON p.item_id = i.id
           WHERE i.user_id = %s
           GROUP BY i.id
           ORDER BY likes DESC, last_purchased_at DESC""",
        (user["id"],),
    ).fetchall()

    # Cheapest price seen per item per store.
    price_rows = db.execute(
        # Same grouping rule as above: h.store must be aggregated because the
        # group is (item, store_key).
        """SELECT p.item_id, MAX(h.store) AS store,
                  MIN(p.price_cents) AS cheapest
           FROM purchases p
           JOIN hauls h ON h.id = p.haul_id
           WHERE p.user_id = %s AND p.price_cents IS NOT NULL
           GROUP BY p.item_id, h.store_key
           ORDER BY cheapest ASC""",
        (user["id"],),
    ).fetchall()

    prices: dict[int, list[dict]] = {}
    for r in price_rows:
        prices.setdefault(r["item_id"], []).append(
            {"store": r["store"], "price": format_price(r["cheapest"]), "cents": r["cheapest"]}
        )

    last_rows = db.execute(
        """SELECT p.item_id, h.store, p.price_cents
           FROM purchases p
           JOIN hauls h ON h.id = p.haul_id
           WHERE p.id IN (
               SELECT MAX(id) FROM purchases WHERE user_id = %s GROUP BY item_id
           )""",
        (user["id"],),
    ).fetchall()
    last_seen = {r["item_id"]: r for r in last_rows}

    liked: list[dict] = []
    disliked: list[dict] = []
    unrated: list[dict] = []

    for r in rows:
        last = last_seen.get(r["id"])
        entry = {
            "item_id": r["id"],
            "name": r["name"],
            "category": r["category"],
            "category_label": CATEGORY_LABELS.get(r["category"], CATEGORY_LABELS["other"]),
            "photo": r["photo"],
            "times_bought": r["times_bought"],
            "likes": r["likes"],
            "dislikes": r["dislikes"],
            "last_store": last["store"] if last else None,
            "last_price": format_price(last["price_cents"]) if last else None,
            "when": _days_ago_phrase(r["last_purchased_at"]),
            "stores": prices.get(r["id"], []),
        }
        entry["best"] = entry["stores"][0] if entry["stores"] else None

        if r["likes"] > r["dislikes"]:
            liked.append(entry)
        elif r["dislikes"] > 0:
            disliked.append(entry)
        else:
            unrated.append(entry)

    def grouped(entries: list[dict]) -> list[dict]:
        buckets: dict[str, list[dict]] = {}
        for e in entries:
            buckets.setdefault(e["category"], []).append(e)
        return [
            {"category": c, "label": CATEGORY_LABELS[c], "items": buckets[c]}
            for c in CATEGORY_ORDER
            if c in buckets
        ]

    return {
        "liked": liked,
        "liked_grouped": grouped(liked),
        "disliked": disliked,
        "unrated": unrated,
    }


# --------------------------------------------------------------------------
# tidying up the inevitable duplicates
# --------------------------------------------------------------------------


@app.get("/api/items")
def list_items(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT i.*, COUNT(p.id) AS times_bought
           FROM items i LEFT JOIN purchases p ON p.item_id = i.id
           WHERE i.user_id = %s
           GROUP BY i.id ORDER BY i.name""",
        (user["id"],),
    ).fetchall()
    return {
        "items": [
            {
                "id": r["id"],
                "name": r["name"],
                "category": r["category"],
                "photo": r["photo"],
                "times_bought": r["times_bought"],
            }
            for r in rows
        ]
    }


@app.post("/api/items/{source_id}/merge-into/{target_id}")
def merge_items(
    source_id: int,
    target_id: int,
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    """Fold "Milk 2%" into "Milk", history and all.

    Autocomplete prevents most duplicates; this cleans up the rest.
    """
    if source_id == target_id:
        raise HTTPException(400, "An item can't be merged into itself")

    source = db.execute(
        "SELECT * FROM items WHERE id = %s AND user_id = %s", (source_id, user["id"])
    ).fetchone()
    target = db.execute(
        "SELECT * FROM items WHERE id = %s AND user_id = %s", (target_id, user["id"])
    ).fetchone()
    if not source or not target:
        raise HTTPException(404, "No such item")

    db.execute("UPDATE purchases SET item_id = %s WHERE item_id = %s", (target_id, source_id))
    if not target["photo"] and source["photo"]:
        db.execute("UPDATE items SET photo = %s WHERE id = %s", (source["photo"], target_id))
    db.execute("DELETE FROM items WHERE id = %s", (source_id,))
    db.commit()
    return {"ok": True, "merged_into": target["name"]}


@app.patch("/api/items/{item_id}")
def rename_item(
    item_id: int,
    name: str | None = Form(None),
    category: str | None = Form(None),
    user=Depends(current_user),
    db: psycopg.Connection = Depends(get_db),
):
    item = db.execute(
        "SELECT * FROM items WHERE id = %s AND user_id = %s", (item_id, user["id"])
    ).fetchone()
    if not item:
        raise HTTPException(404, "No such item")

    if name:
        display = normalize(name)
        key = key_for(display)
        clash = db.execute(
            "SELECT id FROM items WHERE user_id = %s AND name_key = %s AND id != %s",
            (user["id"], key, item_id),
        ).fetchone()
        if clash:
            raise HTTPException(409, f"'{display}' already exists — merge them instead")
        db.execute("UPDATE items SET name = %s, name_key = %s WHERE id = %s", (display, key, item_id))
    if category:
        db.execute("UPDATE items SET category = %s WHERE id = %s", (category, item_id))
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# photos and the built frontend
# --------------------------------------------------------------------------


@app.get("/photos/{filename}")
def get_photo(
    filename: str, user=Depends(current_user), db: psycopg.Connection = Depends(get_db)
):
    """Served through a route rather than StaticFiles so it can be authorised.

    Two checks: the name must be one we generated (which is also what stops
    "../../groceries.db" style paths), and the photo must belong to this account.
    Random filenames alone would be obscurity, not access control.
    """
    if not _PHOTO_NAME_RE.match(filename):
        raise HTTPException(404, "No such photo")

    # Ownership is now the photos row itself -- load_photo filters on user_id,
    # so a wrong owner is indistinguishable from a missing photo.
    data = load_photo(db, user["id"], filename)
    if data is None:
        raise HTTPException(404, "No such photo")
    return Response(
        content=data,
        media_type="image/jpeg",
        # Content-addressed ids never change, so let the browser keep them.
        headers={"Cache-Control": "private, max-age=86400"},
    )


# --------------------------------------------------------------------------
# taking your data with you
# --------------------------------------------------------------------------

_EXPORT_SQL = """
    SELECT p.id, p.purchased_at, h.shopped_on, h.store, i.name AS item_name,
           i.category, p.price_cents, p.liked, p.rated_at, p.photo AS purchase_photo,
           i.photo AS item_photo
    FROM purchases p
    JOIN items i ON i.id = p.item_id
    JOIN hauls h ON h.id = p.haul_id
    WHERE p.user_id = %s
    ORDER BY p.purchased_at DESC, p.id DESC
"""


def _export_rows(db: psycopg.Connection, user_id: int) -> list[dict]:
    return db.execute(_EXPORT_SQL, (user_id,)).fetchall()


def _export_filename(user, extension: str) -> str:
    stamp = datetime.now().date().isoformat()
    return f"groceries-{stamp}.{extension}"


def _csv_text(rows) -> str:
    """One row per purchase, in the order a spreadsheet wants them."""
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        ["date", "store", "item", "category", "price", "price_cents", "rating", "photo"]
    )
    for r in rows:
        writer.writerow(
            [
                r["shopped_on"],
                r["store"],
                r["item_name"],
                r["category"],
                # Both: the formatted one reads well, the integer survives
                # spreadsheet autoformatting and stays exact.
                format_price(r["price_cents"]) or "",
                r["price_cents"] if r["price_cents"] is not None else "",
                {None: "not rated", 0: "disliked", 1: "liked"}[r["liked"]],
                r["purchase_photo"] or r["item_photo"] or "",
            ]
        )
    return buffer.getvalue()


@app.get("/api/export.csv")
def export_csv(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    """Every purchase as a spreadsheet."""
    text = _csv_text(_export_rows(db, user["id"]))
    return Response(
        content=text,
        media_type="text/csv; charset=utf-8",
        headers={
            # `attachment` is what makes the browser save it instead of showing it.
            "Content-Disposition": f'attachment; filename="{_export_filename(user, "csv")}"'
        },
    )


@app.get("/api/export.pdf")
def export_pdf(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    """The readable one -- opens straight in Safari on a phone."""
    pdf = build_pdf(
        _export_rows(db, user["id"]),
        user["email"],
        lambda name: load_photo(db, user["id"], name),
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{_export_filename(user, "pdf")}"'
        },
    )


@app.get("/api/export.zip")
def export_zip(user=Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    """Everything: the spreadsheet, the raw JSON, and every photo.

    This is the backup. The database lives on one disk, and one copy of anything
    is not a backup -- downloading this is how the data survives the machine.
    """
    rows = _export_rows(db, user["id"])

    records = [
        {
            "purchased_at": r["purchased_at"],
            "shopped_on": r["shopped_on"],
            "store": r["store"],
            "item": r["item_name"],
            "category": r["category"],
            "price_cents": r["price_cents"],
            "price": format_price(r["price_cents"]),
            "liked": None if r["liked"] is None else bool(r["liked"]),
            "rated_at": r["rated_at"],
            "photo": r["purchase_photo"] or r["item_photo"],
        }
        for r in rows
    ]

    buffer = io.BytesIO()
    # Photos are already JPEG, so deflate buys almost nothing on them -- but the
    # CSV and JSON compress well and the whole archive is a couple of megabytes.
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("groceries.csv", _csv_text(rows))
        archive.writestr(
            "groceries.json",
            json.dumps(
                {
                    "exported_at": utcnow_iso(),
                    "account": user["email"],
                    "purchases": records,
                },
                indent=2,
            ),
        )

        # Dedupe: several purchases of one item can share a display photo.
        seen: set[str] = set()
        for r in rows:
            for name in (r["purchase_photo"], r["item_photo"]):
                if not name or name in seen:
                    continue
                seen.add(name)
                data = load_photo(db, user["id"], name)
                if data:
                    archive.writestr(f"photos/{name}", data)

    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{_export_filename(user, "zip")}"'
        },
    )


# Serve the built React app if it exists, so `npm run build` gives you one
# server to put on your wifi for her phone.
_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/")
    def _index():
        return FileResponse(_DIST / "index.html")
