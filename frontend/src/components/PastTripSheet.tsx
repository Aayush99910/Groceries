import { useEffect, useState } from "react";

import Icon from "./Icon";
import {
  CartItem,
  Haul,
  NotSignedIn,
  Purchase,
  addToCart,
  getHaul,
  listHauls,
  photoUrl,
} from "../api";

type Props = {
  /** What's already on the cart, so those can be shown as such and not added twice. */
  cart: CartItem[];
  onClose: () => void;
  /** Called with the updated cart once the chosen things are added. */
  onAdded: (items: CartItem[], count: number) => void;
  onSignedOut: () => void;
};

/** "2026-10-13" as "Oct 13". The date is a plain day, so no time zone to get wrong. */
function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * "Same again as last time."
 *
 * Pick a previous trip, tick what she wants from it, and it goes onto the cart,
 * ready to cross off when she reaches the store. Everything starts ticked, because
 * the usual case is "most of that again"; unticking the odd one is quicker than
 * ticking the rest.
 */
export default function PastTripSheet({ cart, onClose, onAdded, onSignedOut }: Props) {
  const [hauls, setHauls] = useState<Haul[] | null>(null);
  const [chosen, setChosen] = useState<Haul | null>(null);
  const [items, setItems] = useState<Purchase[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCart = new Set(cart.map((c) => c.item_id));

  // Escape closes, and the page behind can't scroll while this is open.
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

  useEffect(() => {
    listHauls()
      .then((r) => setHauls(r.hauls))
      .catch((err) => {
        if (err instanceof NotSignedIn) return onSignedOut();
        setError(err instanceof Error ? err.message : "Couldn't load your trips");
        setHauls([]);
      });
  }, [onSignedOut]);

  async function open(haul: Haul) {
    setChosen(haul);
    setItems(null);
    setError(null);
    try {
      const detail = await getHaul(haul.id);
      // One row per thing, even if it was bought twice that day.
      const seen = new Set<number>();
      const unique = detail.purchases.filter((p) => !seen.has(p.item_id) && seen.add(p.item_id));
      setItems(unique);
      setPicked(new Set(unique.filter((p) => !onCart.has(p.item_id)).map((p) => p.item_id)));
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't open that trip");
      setChosen(null);
    }
  }

  function toggle(id: number) {
    setPicked((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function add() {
    if (picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const result = await addToCart({ itemIds: [...picked] });
      onAdded(result.items, picked.size);
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't add those");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <div
        className="sheet store-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add from a past trip"
      >
        <div className="sheet-grab" aria-hidden />

        <div className="store-sheet-head">
          {chosen ? (
            <button type="button" className="back-btn" onClick={() => setChosen(null)}>
              <Icon name="chevronLeft" />
              Trips
            </button>
          ) : (
            <h2>Add from a past trip</h2>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="store-sheet-body">
          {error && <p className="error">{error}</p>}

          {!chosen && (
            <>
              {hauls === null && (
                <p className="sheet-status">
                  <span className="spinner" aria-hidden /> Loading your trips…
                </p>
              )}
              {hauls && hauls.length === 0 && !error && (
                <p className="sheet-note">
                  No past trips yet. Once you've added things on the Add tab, they'll be here to
                  copy.
                </p>
              )}
              {hauls && hauls.length > 0 && (
                <>
                  <p className="sheet-note">Pick a trip, then choose what you want from it again.</p>
                  <div className="list-card">
                    {hauls.slice(0, 15).map((haul) => (
                      <button
                        type="button"
                        key={haul.id}
                        className="place-row"
                        onClick={() => open(haul)}
                      >
                        <span className="place-icon">
                          <Icon name="store" />
                        </span>
                        <span className="row-body">
                          <strong>{haul.store.split(" · ")[0]}</strong>
                          <span className="row-sub">
                            {dayLabel(haul.shopped_on)} {"·"} {haul.item_count} item
                            {haul.item_count === 1 ? "" : "s"}
                          </span>
                        </span>
                        {haul.total && <span className="place-distance">{haul.total}</span>}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {chosen && (
            <>
              <p className="sheet-note">
                {chosen.store.split(" · ")[0]} {"·"} {dayLabel(chosen.shopped_on)}
              </p>
              {items === null && (
                <p className="sheet-status">
                  <span className="spinner" aria-hidden /> Opening…
                </p>
              )}
              {items && (
                <div className="list-card">
                  {items.map((p) => {
                    const already = onCart.has(p.item_id);
                    const on = picked.has(p.item_id);
                    return (
                      <button
                        type="button"
                        key={p.item_id}
                        className="place-row"
                        disabled={already}
                        aria-pressed={on}
                        onClick={() => toggle(p.item_id)}
                      >
                        <span className={on ? "tick on" : "tick"} aria-hidden>
                          {on && <Icon name="check" size="0.9em" />}
                        </span>
                        {photoUrl(p.photo) ? (
                          <img className="thumb thumb-sm" src={photoUrl(p.photo)!} alt="" />
                        ) : (
                          <span className="thumb thumb-sm thumb-empty">
                            <Icon name="cart" />
                          </span>
                        )}
                        <span className="row-body">
                          <strong>{p.item_name}</strong>
                          <span className="row-sub">{already ? "Already in your cart" : p.price ?? ""}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {chosen && items && (
          <button type="button" className="primary" onClick={add} disabled={busy || picked.size === 0}>
            {busy ? (
              "Adding…"
            ) : picked.size === 0 ? (
              "Pick something to add"
            ) : (
              <>
                <Icon name="plus" />
                Add {picked.size} to cart
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
