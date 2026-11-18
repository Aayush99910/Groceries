import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useCachedState } from "../cache";
import DeleteButton from "../components/DeleteButton";
import Icon from "../components/Icon";
import StoreSheet from "../components/StoreSheet";
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
 * Two steps that match how shopping actually goes:
 *
 *   1. Say where you are (once per shop). That's a pop-up over this page, not a page
 *      of its own: find stores near you, search by name, or pick a recent one.
 *   2. Add things as they go in the trolley. Each shows up in the basket below
 *      with a running total, so you can see the shop taking shape.
 *
 * The store isn't remembered forever (see App.tsx), so there's no stale default.
 */
export default function AddView({
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
  // The store pop-up. Opens by itself when there's no store to start from.
  const [sheetOpen, setSheetOpen] = useState(!store);
  const [knownStores, setKnownStores] = useState<string[]>([]);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recent, setRecent] = useCachedState<Purchase[] | null>("add-recent", null);
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

  // No store (first visit, or the remembered one expired while the app sat open):
  // ask which one, rather than leaving her on an empty page.
  useEffect(() => {
    if (!store) setSheetOpen(true);
  }, [store]);

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
    setSheetOpen(false);
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
      // Adding something means she's still shopping here: restart the store's clock.
      onStore(store);
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

  // "Trader Joe's · 39324 Argonaut Way": the name on one line, the street under it.
  const [storeName, ...storeRest] = store.split(" \u00b7 ");
  const storeNote = storeRest.join(" \u00b7 ");

  const sheet = sheetOpen && (
    <StoreSheet
      current={store}
      recent={knownStores}
      onPick={chooseStore}
      onClose={() => setSheetOpen(false)}
      onSignedOut={onSignedOut}
    />
  );

  // -------------------------------------------------------------- step 1

  if (!store) {
    return (
      <div className="screen">
        <section className="card store-prompt">
          <div className="empty-icon">
            <Icon name="mapPin" size="1.5em" />
          </div>
          <h2>Where are you shopping?</h2>
          <p className="caption">Pick the store once, then add things as they go in the trolley.</p>
          <button type="button" className="primary inline" onClick={() => setSheetOpen(true)}>
            <Icon name="search" />
            Choose a store
          </button>
        </section>
        {sheet}
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
          <strong>{storeName}</strong>
          {storeNote && <span className="row-sub">{storeNote}</span>}
        </span>
        <button type="button" className="ghost" onClick={() => setSheetOpen(true)}>
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
      {sheet}
    </div>
  );
}
