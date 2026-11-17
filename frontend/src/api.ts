// Every call the app makes, in one place.

export type User = {
  id: number;
  email: string;
  display_name: string | null;
  created_at?: string;
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
}) {
  const body = new FormData();
  body.append("name", input.name);
  body.append("store", input.store);
  body.append("price", input.price);
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
