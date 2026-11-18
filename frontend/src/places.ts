/**
 * Finding a store, from the phone.
 *
 * This used to run on the server (see git history for backend/app/places.py),
 * which is where OpenStreetMap's usage policy would rather it ran: a server can
 * send a User-Agent naming the app, and can enforce one-request-a-second for
 * everybody at once.
 *
 * It had to move here because Nominatim refuses requests from cloud-datacenter
 * IP addresses -- the identical request that works from a laptop returns an error
 * from Render. A phone's address is residential, so it is served normally.
 *
 * The trade is honest: browsers can't set a User-Agent, so these requests
 * identify themselves only as the browser. What's kept from the server version:
 *
 *   * at most one request a second, however fast she types,
 *   * answers cached for a while, so re-opening the picker is free,
 *   * the same shaping and distance sorting, so the UI is unchanged.
 *
 * If this ever gets more than a couple of users, the right move is a geocoding
 * service with a free tier that expects server traffic (LocationIQ, Geoapify):
 * put the key on the server, restore the old endpoint, and this file goes away.
 */

export type Place = {
  id: number | null;
  name: string;
  /** "Trader Joe's · 39324 Argonaut Way": the name plus what tells branches apart. */
  label: string;
  address: string;
  distance_m: number | null;
};

export type Coords = { lat: number; lon: number };

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const MIN_GAP_MS = 1100; // their policy is one request per second
const CACHE_MS = 15 * 60 * 1000;

export class PlacesUnavailable extends Error {
  constructor() {
    super("Store lookup isn't available right now");
    this.name = "PlacesUnavailable";
  }
}

type NominatimRow = {
  place_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name?: string;
  category?: string;
  type?: string;
  address?: Record<string, string>;
};

const cache = new Map<string, { at: number; value: Place[] }>();
// A promise chain, so overlapping calls queue instead of racing. Each link waits
// its turn before firing, which is how the one-a-second rule survives fast typing.
let queue: Promise<unknown> = Promise.resolve();
let lastCall = 0;

function fetchRows(params: Record<string, string | number>): Promise<NominatimRow[]> {
  const run = async (): Promise<NominatimRow[]> => {
    const wait = MIN_GAP_MS - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const query = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      format: "jsonv2",
      addressdetails: "1",
      dedupe: "1",
    });
    try {
      const res = await fetch(`${NOMINATIM}?${query}`, {
        headers: { "Accept-Language": navigator.language || "en" },
        // No cookies to a third party.
        credentials: "omit",
      });
      if (!res.ok) throw new PlacesUnavailable();
      return (await res.json()) as NominatimRow[];
    } catch {
      throw new PlacesUnavailable();
    } finally {
      lastCall = Date.now();
    }
  };
  // Chain onto the queue, and keep the queue alive even if this call fails.
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

async function cached(key: string, build: () => Promise<Place[]>): Promise<Place[]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await build();
  if (cache.size > 100) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** Great-circle distance in metres. */
function distance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180;
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dphi = p2 - p1;
  const dlmb = (lon2 - lon1) * rad;
  const a =
    Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(a));
}

const isShop = (r: NominatimRow) => r.category === "shop" || r.type === "marketplace";

function shape(r: NominatimRow, here: Coords | null): Place {
  const a = r.address ?? {};
  const road = a.road || a.pedestrian || "";
  const street = road ? `${a.house_number ?? ""} ${road}`.trim() : "";
  const city = a.city || a.town || a.village || "";
  const area = a.suburb || a.neighbourhood || city;

  const name = r.name || (r.display_name ?? "").split(",")[0].trim();
  // What tells two branches of one chain apart: the street if we have it, else
  // the neighbourhood.
  const descriptor = street || area;
  const label =
    descriptor && descriptor.toLowerCase() !== name.toLowerCase()
      ? `${name} · ${descriptor}`
      : name;

  return {
    id: r.place_id ?? null,
    name,
    label: label.slice(0, 80),
    address: [street, city || area].filter(Boolean).join(", "),
    distance_m: here ? Math.round(distance(here.lat, here.lon, +r.lat, +r.lon)) : null,
  };
}

/** Nominatim's viewbox: left,top,right,bottom. */
function box(lat: number, lon: number, halfKm: number): string {
  const dlat = halfKm / 111;
  const dlon = halfKm / (111 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  return `${(lon - dlon).toFixed(5)},${(lat + dlat).toFixed(5)},${(lon + dlon).toFixed(5)},${(lat - dlat).toFixed(5)}`;
}

const NEARBY_QUERIES = ["supermarket", "grocery"];

/** Grocery stores around a point, nearest first. */
export async function nearbyStores(at: Coords): Promise<{ places: Place[] }> {
  // ~1 km cells: walking around a shop shouldn't re-query on every step.
  const key = `nearby:${at.lat.toFixed(2)}:${at.lon.toFixed(2)}`;
  const places = await cached(key, async () => {
    const found = new Map<number, NominatimRow>();
    // Start close; if the area is thin (the countryside), look wider.
    for (const halfKm of [3.5, 12]) {
      for (const phrase of NEARBY_QUERIES) {
        const rows = await fetchRows({
          q: phrase,
          viewbox: box(at.lat, at.lon, halfKm),
          bounded: 1,
          limit: 30,
        });
        for (const row of rows) {
          if (isShop(row) && row.place_id != null && !found.has(row.place_id)) {
            found.set(row.place_id, row);
          }
        }
      }
      if (found.size >= 5) break;
    }
    return [...found.values()]
      .map((r) => shape(r, at))
      .sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0))
      .slice(0, 20);
  });
  return { places };
}

/** Shops matching a name, nearest first when we know where she is. */
export async function searchStores(
  q: string,
  at?: Coords | null
): Promise<{ places: Place[] }> {
  const query = q.trim();
  if (query.length < 2) return { places: [] };
  const here = at ?? null;

  const key = `search:${query.toLowerCase()}:${here ? here.lat.toFixed(1) : ""}:${here ? here.lon.toFixed(1) : ""}`;
  const places = await cached(key, async () => {
    const params: Record<string, string | number> = { q: query, limit: 15 };
    // A preference, not a fence: "Trader Joe's" should find the ones near her
    // first, but still find one in another city if that's what she typed.
    if (here) params.viewbox = box(here.lat, here.lon, 40);
    const rows = (await fetchRows(params)).filter(isShop);
    const shaped = rows.map((r) => shape(r, here));
    if (here) shaped.sort((a, b) => (a.distance_m ?? 0) - (b.distance_m ?? 0));
    return shaped.slice(0, 10);
  });
  return { places };
}
