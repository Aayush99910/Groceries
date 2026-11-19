import { useEffect, useState } from "react";

import Icon from "./Icon";
import {
  ListEntry,
  NotSignedIn,
  Purchase,
  StorePlace,
  logPurchase,
  photoUrl,
  sameStore,
} from "../api";

type Props = {
  entry: ListEntry;
  /** The store she's currently shopping at, if she's picked one. */
  defaultStore: string;
  /** The branch she's at, if she picked it off the map. Sent along when the store
   *  chosen here is that one, so the purchase lands on the same store (and prices
   *  don't split) instead of looking like a second, hand-typed one. */
  place?: StorePlace | null;
  /** The small line above the name. "Buying again" from a list; "Got it?" from the cart. */
  eyebrow?: string;
  /** Every store she has shopped at, for one-tap choosing. */
  knownStores: string[];
  onClose: () => void;
  onAdded: (store: string, purchase: Purchase) => void;
  onSignedOut: () => void;
};

/** "4.99" for an input, from cents. */
function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * "I'm buying this again, right now."
 *
 * The Shop list is things she already likes, so logging one shouldn't mean
 * retyping its name and price on another tab. This is the shortcut: the store is
 * already chosen, the price is what she paid there last time, and one tap logs it.
 * Everything is still editable, because prices move.
 */
export default function QuickAddSheet({
  entry,
  defaultStore,
  place,
  eyebrow = "Buying again",
  knownStores,
  onClose,
  onAdded,
  onSignedOut,
}: Props) {
  const startStore = defaultStore || entry.last_store || "";
  const [store, setStore] = useState(startStore);
  const [price, setPrice] = useState(() => priceAt(startStore));
  const [priceTouched, setPriceTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function priceAt(forStore: string): string {
    const here = entry.stores.find((s) => sameStore(s.store, forStore));
    if (here) return dollars(here.cents);
    return entry.best ? dollars(entry.best.cents) : "";
  }

  // Escape closes, and the page behind must not scroll while this is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  function chooseStore(next: string) {
    setStore(next);
    // Follow the store's price, unless she has already typed her own.
    if (!priceTouched) setPrice(priceAt(next));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!store.trim()) {
      setError("Which store are you at?");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await logPurchase({
        name: entry.name,
        store: store.trim(),
        price,
        photo: null,
        place: place && sameStore(place.name, store) ? place : null,
      });
      onAdded(store.trim(), result.purchase);
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't add that");
      setSaving(false);
    }
  }

  const src = photoUrl(entry.photo);
  const choices = knownStores.slice(0, 6);

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <form
        className="sheet quick-sheet"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-label={`Add ${entry.name} to your basket`}
      >
        <div className="sheet-grab" aria-hidden />
        <div className="quick-head">
          {src ? (
            <img className="thumb thumb-lg" src={src} alt="" />
          ) : (
            <div className="thumb thumb-lg thumb-empty">
              <Icon name="cart" size="1.3em" />
            </div>
          )}
          <div className="row-body">
            <span className="eyebrow">{eyebrow}</span>
            <strong className="quick-name">{entry.name}</strong>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="field">
          <label htmlFor="qa-store">Store</label>
          {choices.length > 0 && (
            <div className="chips wrap">
              {choices.map((s) => (
                <button
                  type="button"
                  key={s}
                  className={sameStore(s, store) ? "chip on" : "chip"}
                  onClick={() => chooseStore(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <input
            id="qa-store"
            value={store}
            onChange={(e) => chooseStore(e.target.value)}
            placeholder="Which store?"
            autoComplete="off"
            autoCapitalize="words"
          />
        </div>

        <div className="field">
          <label htmlFor="qa-price">
            Price <span className="muted">· what you paid last time</span>
          </label>
          <div className="input-prefix">
            <span>$</span>
            <input
              id="qa-price"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setPriceTouched(true);
              }}
              placeholder="4.99"
              inputMode="decimal"
              autoComplete="off"
            />
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
              {store.trim() ? `Add to ${store.trim()}` : "Add to my basket"}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
