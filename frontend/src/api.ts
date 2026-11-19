// Every call the app makes, in one place.

export type User = {
  id: number;
  email: string;
  display_name: string | null;
  created_at?: string;
  /** A photo id (see photoUrl), or null if she hasn't added a picture. */
  avatar?: string | null;
};

export type Purchase = {
  id: number;
  item_id: number;
  item_name: string;
  category: string;
  store: string;
  photo: string | null;
  price: string | null;
  price_cents: number | null;
  purchased_at: string;
  when: string;
  liked: boolean | null;
};

export type StorePrice = { store: string; price: string; cents: number };

export type ListEntry = {
  item_id: number;
  name: string;
  category: string;
  category_label: string;
  photo: string | null;
  times_bought: number;
  likes: number;
  dislikes: number;
  last_store: string | null;
  last_price: string | null;
  when: string;
  stores: StorePrice[];
  best: StorePrice | null;
};

export type ShoppingList = {
  liked: ListEntry[];
  liked_grouped: { category: string; label: string; items: ListEntry[] }[];
  disliked: ListEntry[];
  unrated: ListEntry[];
};

export type Haul = {
  id: number;
  store: string;
  shopped_on: string;
  item_count: number;
  unrated: number;
  total: string | null;
};

/** Thrown when the session has gone. The app catches this and shows the login screen. */
export class NotSignedIn extends Error {
  constructor() {
    super("Please sign in");
    this.name = "NotSignedIn";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new NotSignedIn();
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Something went wrong (${res.status})`);
  }
  return res.json() as Promise<T>;
}

// credentials: "include" on every request, or the session cookie isn't sent when
// the frontend is served from a different origin than the API.
const withCookies: RequestInit = { credentials: "include" };

function postJson(url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    ...withCookies,
    method: "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export function photoUrl(photo: string | null): string | null {
  return photo ? `/photos/${photo}` : null;
}

// ---------------------------------------------------------------- accounts

export async function me() {
  return json<{ user: User | null }>(await fetch("/api/auth/me", withCookies));
}

export async function login(email: string, password: string) {
  return json<{ user: User }>(await postJson("/api/auth/login", { email, password }));
}

export async function signup(email: string, password: string, displayName: string) {
  return json<{ user: User }>(
    await postJson("/api/auth/signup", {
      email,
      password,
      display_name: displayName || null,
    })
  );
}

export async function updateProfile(displayName: string) {
  return json<{ user: User }>(
    await fetch("/api/auth/me", {
      ...withCookies,
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ display_name: displayName }),
    })
  );
}

export async function uploadAvatar(file: File) {
  const body = new FormData();
  body.append("photo", file);
  return json<{ user: User }>(
    await fetch("/api/auth/avatar", { ...withCookies, method: "POST", body })
  );
}

export async function removeAvatar() {
  return json<{ user: User }>(
    await fetch("/api/auth/avatar", { ...withCookies, method: "DELETE" })
  );
}

export async function changePassword(currentPassword: string, newPassword: string) {
  return json<{ ok: boolean }>(
    await postJson("/api/auth/password", {
      current_password: currentPassword,
      new_password: newPassword,
    })
  );
}

export async function logout() {
  return json<{ ok: boolean }>(await postJson("/api/auth/logout"));
}

// ---------------------------------------------------------------- groceries

export async function logPurchase(input: {
  name: string;
  store: string;
  price: string;
  photo: File | null;
  /** Which branch, when she picked it off the map rather than typing a name. */
  place?: StorePlace | null;
}) {
  const body = new FormData();
  body.append("name", input.name);
  body.append("store", input.store);
  body.append("price", input.price);
  // Optional: a hand-typed store sends none of these and behaves as it always did.
  if (input.place?.place_id != null) {
    body.append("place_id", String(input.place.place_id));
    if (input.place.lat != null) body.append("lat", String(input.place.lat));
    if (input.place.lon != null) body.append("lon", String(input.place.lon));
  }
  if (input.photo) body.append("photo", input.photo);
  return json<{ purchase: Purchase; haul: { id: number; store: string; item_count: number } }>(
    await fetch("/api/purchases", { ...withCookies, method: "POST", body })
  );
}

/** A name offered by autocomplete. `known` = she has bought it before. */
export type SuggestOption = { name: string; known: boolean };

export async function suggestItems(q: string): Promise<SuggestOption[]> {
  const r = await json<{ suggestions: string[]; known: boolean[] }>(
    await fetch(`/api/suggest/items?q=${encodeURIComponent(q)}`, withCookies)
  );
  return r.suggestions.map((name, i) => ({ name, known: r.known[i] ?? false }));
}

export async function suggestStores(q: string): Promise<SuggestOption[]> {
  const r = await json<{ suggestions: string[] }>(
    await fetch(`/api/suggest/stores?q=${encodeURIComponent(q)}`, withCookies)
  );
  // Every store in this list is one she has shopped at before.
  return r.suggestions.map((name) => ({ name, known: true }));
}

export async function recentPurchases(limit = 15) {
  return json<{ purchases: Purchase[] }>(
    await fetch(`/api/purchases/recent?limit=${limit}`, withCookies)
  );
}

export async function pendingRatings() {
  return json<{ purchases: Purchase[] }>(await fetch("/api/rate/pending", withCookies));
}

export async function ratePurchase(id: number, liked: boolean) {
  return json<{ purchase: Purchase }>(await postJson(`/api/purchases/${id}/rate`, { liked }));
}

export async function unratePurchase(id: number) {
  return json<{ ok: boolean }>(await postJson(`/api/purchases/${id}/unrate`));
}

export async function deletePurchase(id: number) {
  return json<{ ok: boolean }>(
    await fetch(`/api/purchases/${id}`, { ...withCookies, method: "DELETE" })
  );
}

export async function shoppingList() {
  return json<ShoppingList>(await fetch("/api/shopping-list", withCookies));
}

export async function listHauls() {
  return json<{ hauls: Haul[] }>(await fetch("/api/hauls", withCookies));
}

// ---------------------------------------------------------------- finding a store

/** A shop from the map search. `label` is what gets saved as the store's name. */
// Store lookup moved into the page: Nominatim refuses cloud-datacenter IPs, so
// the request has to come from the phone. See places.ts for the full reasoning.
// Re-exported here so existing imports from "../api" keep working.
export type { Place, Coords } from "./places";
export { nearbyStores, searchStores, PlacesUnavailable } from "./places";

/**
 * A chosen store, as the app remembers it.
 *
 * `name` is what she reads. `place_id` is OpenStreetMap's permanent number for
 * that shop and is what the server uses as the store's identity -- the label can
 * come back worded differently between lookups, the number can't. A store typed
 * by hand has a name and nothing else.
 */
export type StorePlace = {
  name: string;
  place_id?: number | null;
  lat?: number | null;
  lon?: number | null;
};


const MILES_REGIONS = new Set(["US", "GB", "LR", "MM"]);

/** "0.4 mi" or "650 m", in whichever units her phone's region uses. */
export function distanceLabel(meters: number | null): string {
  if (meters == null) return "";
  let miles = false;
  try {
    const region = new Intl.Locale(navigator.language).region;
    miles = !!region && MILES_REGIONS.has(region);
  } catch {
    // Unknown locale: metric.
  }
  if (miles) {
    const feet = meters * 3.28084;
    return feet < 500 ? `${Math.round(feet / 10) * 10} ft` : `${(meters / 1609.344).toFixed(1)} mi`;
  }
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

// ---------------------------------------------------------------- exports

export type ExportKind = "pdf" | "csv" | "zip";

const EXPORT_TYPES: Record<ExportKind, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  zip: "application/zip",
};

/**
 * Fetch an export as a file, rather than navigating to it.
 *
 * A plain <a download> link doesn't work in an app added to the iPhone Home
 * Screen: iOS ignores the attribute, so a PDF opens in a viewer with no browser
 * chrome and no way back, and a ZIP has nowhere to go. Having the file in hand
 * lets us give it to the share sheet instead (see saveFile).
 */
export async function fetchExport(kind: ExportKind): Promise<File> {
  const res = await fetch(`/api/export.${kind}`, withCookies);
  if (res.status === 401) throw new NotSignedIn();
  if (!res.ok) throw new Error("Couldn't prepare that file. Try again in a moment.");
  const blob = await res.blob();
  // Prefer the server's filename; fall back to a dated one.
  const header = res.headers.get("content-disposition") ?? "";
  const named = /filename="?([^";]+)"?/i.exec(header)?.[1];
  const name = named ?? `groceries-${new Date().toISOString().slice(0, 10)}.${kind}`;
  return new File([blob], name, { type: blob.type || EXPORT_TYPES[kind] });
}

/**
 * - "shared": the share sheet opened and closed (she saved it, or chose not to).
 * - "cancelled": she dismissed the sheet.
 * - "downloaded": a normal browser download (desktop, or no share sheet).
 * - "needs-tap": Safari refused to open the sheet because too long had passed
 *   since her tap; the caller shows a "Save" button and calls this again.
 */
export type SaveResult = "shared" | "cancelled" | "downloaded" | "needs-tap";

/** Hand a file to the phone's share sheet (Save to Files, AirDrop...) or download it. */
export async function saveFile(file: File): Promise<SaveResult> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return "shared";
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      if (err instanceof DOMException && err.name === "NotAllowedError") return "needs-tap";
      // Anything else: fall through to a plain download.
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

// ---------------------------------------------------------------- helpers

/** "$4.99" from cents. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Two spellings of one store are the same store: iOS types a curly apostrophe
 * where a laptop types a straight one, and the server already treats them alike.
 * Compare the same way here.
 */
export function sameStore(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) =>
    (v ?? "").replace(/[‘’]/g, "'").trim().toLowerCase();
  return norm(a) !== "" && norm(a) === norm(b);
}
