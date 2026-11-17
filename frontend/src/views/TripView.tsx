import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DeleteButton from "../components/DeleteButton";
import Icon from "../components/Icon";
import Suggest from "../components/Suggest";
import {
  ListEntry,
  NotSignedIn,
  Purchase,
  deletePurchase,
  logPurchase,
  money,
  photoUrl,
  recentPurchases,
  sameStore,
  shoppingList,
  suggestItems,
  suggestStores,
} from "../api";

// A "trip" is whatever she bought at this store in the last few hours. Using the
// clock rather than the server's "today" label matters: that label is in UTC, so
// for someone on the US west coast it would flip to "yesterday" mid-afternoon and
// her basket would vanish while she was still shopping.
const TRIP_WINDOW_MS = 8 * 60 * 60 * 1000;

/**
 * "I'm at the shop."
 *
 * The old Log tab was a form with the store as just another field, which made
 * the one thing that never changes mid-trip look as important as the thing that
 * changes every time. Now it's in two steps that match how shopping actually goes:
 *
 *   1. Say where you are (once per trip).
 *   2. Add things as they go in the trolley. Each shows up in the basket below
 *      with a running total, so you can see the trip taking shape.
 */
export default function TripView({
  store,
  onStore,
  refreshKey,
  onLogged,
  notify,
  onSignedOut,
}: {
  store: string;
  onStore: (store: string) => void;
  refreshKey: number;
  onLogged: () => void;
  notify: (message: string) => void;
  onSignedOut: () => void;
}) {
  const [editingStore, setEditingStore] = useState(!store);
  const [storeDraft, setStoreDraft] = useState("");
  const [knownStores, setKnownStores] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recent, setRecent] = useState<Purchase[] | null>(null);
  const [favourites, setFavourites] = useState<ListEntry[]>([]);
  const nameRef = useRef<HTMLDivElement>(null);

  const loadRecent = useCallback(() => {
    recentPurchases(60)
      .then((r) => setRecent(r.purchases))
      .catch((err) => {
        if (err instanceof NotSignedIn) return onSignedOut();
        setRecent([]);
      });
  }, [onSignedOut]);

  useEffect(loadRecent, [loadRecent, refreshKey]);

  useEffect(() => {
    suggestStores("")
      .then((list) => setKnownStores(list.map((o) => o.name)))
      .catch(() => undefined);
    shoppingList()
      .then((r) => setFavourites(r.liked))
      .catch(() => undefined);
  }, [refreshKey]);

  // Revoke the object URL when the preview changes, or it leaks memory.
  useEffect(() => {
    if (!photo) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const itemOptions = useCallback((q: string) => suggestItems(q), []);
  const storeOptions = useCallback((q: string) => suggestStores(q), []);

  // This trip's basket: this store, recent, newest first.
  const basket = useMemo(() => {
    const cutoff = Date.now() - TRIP_WINDOW_MS;
    return (recent ?? []).filter(
      (p) => sameStore(p.store, store) && new Date(p.purchased_at).getTime() >= cutoff
    );
  }, [recent, store]);

  const total = basket.reduce((sum, p) => sum + (p.price_cents ?? 0), 0);
  const unpriced = basket.filter((p) => p.price_cents == null).length;

  // "Usually get here": liked things she has bought at this store and hasn't
  // already put in the basket. One tap fills the form.
  const inBasket = new Set(basket.map((p) => p.item_id));
  const usual = favourites
    .filter((e) => e.stores.some((s) => sameStore(s.store, store)) && !inBasket.has(e.item_id))
    .sort((a, b) => b.likes - a.likes || b.times_bought - a.times_bought)
    .slice(0, 8);

  function chooseStore(next: string) {
    const clean = next.trim();
    if (!clean) return;
    onStore(clean);
    setEditingStore(false);
    setStoreDraft("");
  }

  function fillFrom(entry: ListEntry) {
    const here = entry.stores.find((s) => sameStore(s.store, store));
    setName(entry.name);
    setPrice(here ? (here.cents / 100).toFixed(2) : "");
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("What did you get?");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await logPurchase({ name: name.trim(), store, price, photo });
      notify(`${result.purchase.item_name} added`);
      // Keep the store, clear the rest, ready for the next thing in the trolley.
      setName("");
      setPrice("");
      setPhoto(null);
      // onLogged bumps the refresh key, which reloads the basket.
      onLogged();
      nameRef.current?.querySelector("input")?.focus();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setSaving(false);
    }
  }

  async function remove(purchase: Purchase) {
    // Optimistic: the row goes straight away, and comes back if the call fails.
    setRecent((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    try {
      await deletePurchase(purchase.id);
      notify(`${purchase.item_name} removed`);
      onLogged();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't remove that");
      loadRecent();
    }
  }

  // -------------------------------------------------------------- step 1

  if (editingStore) {
    const choices = knownStores.filter((s) => !sameStore(s, store));
    return (
      <div className="screen">
        <section className="card store-picker">
          <h2>{store ? "Change store" : "Where are you shopping?"}</h2>
          <p className="caption">
            {store
              ? "Your basket follows the store you pick."
              : "Pick it once, then add things as they go in the trolley."}
          </p>

          {choices.length > 0 && (
            <div className="chips wrap">
              {choices.slice(0, 8).map((s) => (
                <button type="button" key={s} className="chip" onClick={() => chooseStore(s)}>
                  <Icon name="store" size="1em" />
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              chooseStore(storeDraft);
            }}
          >
            <Suggest
              label={choices.length > 0 ? "Or a new store" : "Store name"}
              value={storeDraft}
              onChange={setStoreDraft}
              fetchSuggestions={storeOptions}
              placeholder="Trader Joe's"
            />
            <button type="submit" className="primary" disabled={!storeDraft.trim()}>
              {store ? "Use this store" : "Start shopping"}
            </button>
            {store && (
              <button type="button" className="link" onClick={() => setEditingStore(false)}>
                Keep {store}
              </button>
            )}
          </form>
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------- step 2

  return (
    <div className="screen">
      <div className="store-bar">
        <span className="store-bar-icon">
          <Icon name="store" />
        </span>
        <span className="store-bar-text">
          <span className="eyebrow">Shopping at</span>
          <strong>{store}</strong>
        </span>
        <button type="button" className="ghost" onClick={() => setEditingStore(true)}>
          Change
        </button>
      </div>

      {usual.length > 0 && (
        <div className="chip-block">
          <span className="eyebrow">You usually get here</span>
          <div className="chips scroll">
            {usual.map((entry) => {
              const here = entry.stores.find((s) => sameStore(s.store, store));
              return (
                <button type="button" key={entry.item_id} className="chip" onClick={() => fillFrom(entry)}>
                  {entry.name}
                  {here && <span className="chip-count">{here.price}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <form className="form-card" onSubmit={submit}>
        <div ref={nameRef} className="field-lg">
          <Suggest
            label="What did you get?"
            value={name}
            onChange={setName}
            fetchSuggestions={itemOptions}
            placeholder="Strawberries"
          />
        </div>

        {/* Price and photo share a row: both are optional, and together they
            keep the Add button above the fold on a small phone. */}
        <div className="two-up">
          <div className="field">
            <label htmlFor="price">
              Price <span className="muted">· optional</span>
            </label>
            <div className="input-prefix">
              <span>$</span>
              <input
                id="price"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="4.99"
                // Brings up the number pad on her phone instead of a full keyboard.
                inputMode="decimal"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="field">
            <label>Photo</label>
            {preview ? (
              <button
                type="button"
                className="photo-chip has-photo"
                onClick={() => setPhoto(null)}
                aria-label="Remove photo and retake"
              >
                <img src={preview} alt="" />
                <span>Retake</span>
              </button>
            ) : (
              <label className="photo-chip">
                <Icon name="camera" size="1.25em" />
                <span>Add photo</span>
                <input
                  type="file"
                  accept="image/*"
                  // `capture` opens the rear camera straight away on a phone, and
                  // falls back to a normal file picker on a laptop.
                  capture="environment"
                  onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
            )}
          </div>
        </div>

        {error && (
          <p className="error">
            <Icon name="close" />
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={saving}>
          {saving ? (
            "Adding…"
          ) : (
            <>
              <Icon name="plus" />
              Add to basket
            </>
          )}
        </button>
      </form>

      <section>
        <h3 className="group-heading">
          <span>In your basket</span>
          <span className="group-count">
            {basket.length > 0
              ? `${basket.length} item${basket.length === 1 ? "" : "s"}${total > 0 ? ` · ${money(total)}` : ""}`
              : ""}
          </span>
        </h3>

        {recent === null ? (
          <p className="caption center">Loading…</p>
        ) : basket.length === 0 ? (
          <div className="basket-empty">
            <Icon name="cart" size="1.4em" />
            <span>Nothing yet. What you add shows up here.</span>
          </div>
        ) : (
          <>
            <div className="list-card">
              {basket.map((p) => (
                <article className="row" key={p.id}>
                  {photoUrl(p.photo) ? (
                    <img className="thumb thumb-sm" src={photoUrl(p.photo)!} alt="" />
                  ) : (
                    <div className="thumb thumb-sm thumb-empty">
                      <Icon name="cart" />
                    </div>
                  )}
                  <div className="row-body">
                    <strong>{p.item_name}</strong>
                  </div>
                  {p.price ? <span className="price">{p.price}</span> : <span className="row-sub">no price</span>}
                  <DeleteButton label={p.item_name} onDelete={() => remove(p)} />
                </article>
              ))}
            </div>
            {unpriced > 0 && total > 0 && (
              <p className="caption" style={{ marginTop: 8 }}>
                Total doesn't include {unpriced} item{unpriced === 1 ? "" : "s"} with no price.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
