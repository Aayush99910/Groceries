import { useCallback, useEffect, useRef, useState } from "react";

import DeleteButton from "../components/DeleteButton";
import Icon from "../components/Icon";
import Suggest from "../components/Suggest";
import {
  NotSignedIn,
  Purchase,
  deletePurchase,
  logPurchase,
  photoUrl,
  recentPurchases,
  suggestItems,
  suggestStores,
} from "../api";

const STORE_KEY = "groceries.lastStore";

/**
 * Screen 1: standing in the aisle.
 *
 * The store name is sticky between items -- she is in one shop, not twelve, so
 * typing it once per trip instead of once per item is most of the win here.
 *
 * Underneath the form is "just added", the last few things logged, each with a
 * delete button. A mistyped entry is easiest to fix in the ten seconds after
 * making it, which is exactly when this list is on screen.
 */
export default function LogView({
  onLogged,
  onSignedOut,
}: {
  onLogged: () => void;
  onSignedOut: () => void;
}) {
  const [store, setStore] = useState(() => localStorage.getItem(STORE_KEY) ?? "");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [recent, setRecent] = useState<Purchase[]>([]);
  const nameRef = useRef<HTMLDivElement>(null);

  const loadRecent = useCallback(() => {
    recentPurchases(8)
      .then((r) => setRecent(r.purchases))
      .catch(() => undefined);
  }, []);

  useEffect(loadRecent, [loadRecent]);

  useEffect(() => {
    if (store.trim()) localStorage.setItem(STORE_KEY, store.trim());
  }, [store]);

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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast]);

  const itemOptions = useCallback((q: string) => suggestItems(q), []);
  const storeOptions = useCallback((q: string) => suggestStores(q), []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      setError("What did you get?");
      return;
    }
    if (!store.trim()) {
      setError("Which store?");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await logPurchase({ name: name.trim(), store: store.trim(), price, photo });
      const count = result.haul.item_count;
      setToast(
        `${result.purchase.item_name} added — ${count} item${count === 1 ? "" : "s"} from ${result.haul.store}`
      );
      // Keep the store, clear the rest, ready for the next thing in the trolley.
      setName("");
      setPrice("");
      setPhoto(null);
      loadRecent();
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
    setRecent((current) => current.filter((p) => p.id !== purchase.id));
    try {
      await deletePurchase(purchase.id);
      setToast(`${purchase.item_name} deleted`);
      onLogged();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't delete that");
      loadRecent();
    }
  }

  return (
    <div className="stack">
      <form className="stack" onSubmit={submit}>
        <Suggest
          label="Store"
          value={store}
          onChange={setStore}
          fetchSuggestions={storeOptions}
          placeholder="Trader Joe's"
        />

        <div ref={nameRef}>
          <Suggest
            label="What is it?"
            value={name}
            onChange={setName}
            fetchSuggestions={itemOptions}
            placeholder="Strawberries"
          />
        </div>

        <div className="field">
          <label htmlFor="price">
            Price <span className="muted">— roughly is fine, or skip it</span>
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
            <div className="photo-preview">
              <img src={preview} alt="" />
              <button type="button" className="ghost" onClick={() => setPhoto(null)}>
                <Icon name="camera" />
                Retake
              </button>
            </div>
          ) : (
            <label className="photo-drop">
              <Icon name="camera" size="1.4em" />
              <span>Take a photo</span>
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

        {error && (
          <p className="error">
            <Icon name="close" />
            {error}
          </p>
        )}

        <button type="submit" className="primary" disabled={saving}>
          {saving ? (
            "Saving…"
          ) : (
            <>
              <Icon name="plus" />
              Add to this haul
            </>
          )}
        </button>
      </form>

      {recent.length > 0 && (
        <section>
          <h3 className="section-heading">
            <Icon name="undo" size="1em" />
            Just added
          </h3>
          <div className="stack">
            {recent.map((p) => (
              <article className="recent-row" key={p.id}>
                {photoUrl(p.photo) ? (
                  <img className="thumb thumb-sm" src={photoUrl(p.photo)!} alt="" />
                ) : (
                  <div className="thumb thumb-sm thumb-empty">
                    <Icon name="cart" />
                  </div>
                )}
                <div className="row-body">
                  <strong>{p.item_name}</strong>
                  <span className="row-sub">
                    {[p.price, p.store, p.when].filter(Boolean).join("\u00a0\u00b7 ")}
                  </span>
                </div>
                <DeleteButton label={p.item_name} onDelete={() => remove(p)} />
              </article>
            ))}
          </div>
        </section>
      )}

      {toast && (
        <div className="toast">
          <Icon name="check" />
          {toast}
        </div>
      )}
    </div>
  );
}
