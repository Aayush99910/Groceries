"""Find a store by where she is, or by name.

Backed by OpenStreetMap's free Nominatim search. No API key, no account, no cost,
which suits an app for two people. In exchange it asks for good manners, so this
module does three things on purpose:

  * identifies itself with a User-Agent (browsers can't set one, which is one reason
    this runs on the server and not in the page),
  * makes at most one request a second, however many people ask at once, and
  * caches answers for a while, so tapping "near me" twice doesn't hit it twice.

Her coordinates are used only to build the search box. They are never stored and
never logged.
"""

import json
import math
import threading
import time
import urllib.parse
import urllib.request
from urllib.error import HTTPError, URLError

NOMINATIM = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "Groceries-app/1.0 (personal grocery tracker)"
CACHE_SECONDS = 15 * 60
MIN_GAP_SECONDS = 1.05  # their policy is one request per second

# What counts as somewhere you'd buy groceries.
NEARBY_QUERIES = ("supermarket", "grocery")


class PlacesUnavailable(Exception):
    """The lookup service didn't answer. The caller turns this into a friendly error."""


_lock = threading.Lock()
_last_call = 0.0
_cache: dict[tuple, tuple[float, list[dict]]] = {}


def _fetch(params: dict) -> list[dict]:
    """One polite request. Serialised, so the one-a-second rule holds across threads."""
    global _last_call
    query = urllib.parse.urlencode(
        {**params, "format": "jsonv2", "addressdetails": 1, "dedupe": 1}
    )
    request = urllib.request.Request(
        f"{NOMINATIM}?{query}",
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en"},
    )
    with _lock:
        wait = MIN_GAP_SECONDS - (time.monotonic() - _last_call)
        if wait > 0:
            time.sleep(wait)
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)
        except (URLError, HTTPError, TimeoutError, ValueError) as exc:
            raise PlacesUnavailable(str(exc)) from exc
        finally:
            _last_call = time.monotonic()


def _cached(key: tuple, build) -> list[dict]:
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and now - hit[0] < CACHE_SECONDS:
        return hit[1]
    value = build()
    if len(_cache) > 200:  # tiny app, tiny cache: drop the oldest and move on
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]))
    _cache[key] = (now, value)
    return value


def _distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlmb / 2) ** 2
    return 6_371_000 * 2 * math.asin(math.sqrt(a))


def _is_shop(result: dict) -> bool:
    return result.get("category") == "shop" or result.get("type") == "marketplace"


def _shape(result: dict, here: tuple[float, float] | None) -> dict:
    address = result.get("address", {})
    road = address.get("road") or address.get("pedestrian") or ""
    street = f"{address.get('house_number', '')} {road}".strip() if road else ""
    city = address.get("city") or address.get("town") or address.get("village") or ""
    area = address.get("suburb") or address.get("neighbourhood") or city

    name = result.get("name") or result.get("display_name", "").split(",")[0].strip()
    # What tells two branches of one chain apart: the street if we have it, else the
    # neighbourhood. This is what makes "Trader Joe's" at two addresses two stores.
    descriptor = street or area
    label = f"{name} · {descriptor}" if descriptor and descriptor.lower() != name.lower() else name

    place = {
        "id": result.get("place_id"),
        "name": name,
        "label": label[:80],
        "address": ", ".join(part for part in (street, city or area) if part),
        "distance_m": None,
    }
    if here:
        place["distance_m"] = round(
            _distance_m(here[0], here[1], float(result["lat"]), float(result["lon"]))
        )
    return place


def _box(lat: float, lon: float, half_km: float) -> str:
    """Nominatim's viewbox: left,top,right,bottom."""
    dlat = half_km / 111.0
    dlon = half_km / (111.0 * max(math.cos(math.radians(lat)), 0.01))
    return f"{lon - dlon:.5f},{lat + dlat:.5f},{lon + dlon:.5f},{lat - dlat:.5f}"


def find_nearby(lat: float, lon: float) -> list[dict]:
    """Grocery stores around a point, nearest first."""

    def build() -> list[dict]:
        found: dict[int, dict] = {}
        # Start close; if the area is thin (the countryside), look wider.
        for half_km in (3.5, 12):
            for phrase in NEARBY_QUERIES:
                rows = _fetch(
                    {"q": phrase, "viewbox": _box(lat, lon, half_km), "bounded": 1, "limit": 30}
                )
                for row in rows:
                    if _is_shop(row) and row.get("place_id") not in found:
                        found[row["place_id"]] = row
            if len(found) >= 5:
                break
        places = [_shape(row, (lat, lon)) for row in found.values()]
        places.sort(key=lambda p: p["distance_m"])
        return places[:20]

    # ~1 km cells: someone walking round a store shouldn't re-query on every step.
    return _cached(("nearby", round(lat, 2), round(lon, 2)), build)


def search_places(query: str, lat: float | None, lon: float | None) -> list[dict]:
    """Shops matching a name, nearest first when we know where she is."""
    query = query.strip()
    if len(query) < 2:
        return []
    here = (lat, lon) if lat is not None and lon is not None else None

    def build() -> list[dict]:
        params = {"q": query, "limit": 15}
        if here:
            # A preference, not a fence: "Trader Joe's" should find the ones near her
            # first, but still find one in another city if that's what she typed.
            params["viewbox"] = _box(here[0], here[1], 40)
        rows = [row for row in _fetch(params) if _is_shop(row)]
        places = [_shape(row, here) for row in rows]
        if here:
            places.sort(key=lambda p: p["distance_m"])
        return places[:10]

    key = ("search", query.strip().lower(), round(lat, 1) if here else None, round(lon, 1) if here else None)
    return _cached(key, build)
