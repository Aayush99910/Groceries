import { useEffect, useState } from "react";

import DeleteButton from "../components/DeleteButton";
import Icon from "../components/Icon";
import {
  NotSignedIn,
  Purchase,
  deletePurchase,
  pendingRatings,
  photoUrl,
  ratePurchase,
  unratePurchase,
} from "../api";

/**
 * Screen 2: at home, after she has eaten the thing.
 *
 * Two buttons, nothing else to decide. The photo is doing real work here -- it
 * is what makes "did you like this?" answerable a week later. Each card can also
 * be deleted, for things logged by mistake and only noticed later.
 */
export default function RateView({
  onRated,
  onSignedOut,
}: {
  onRated: () => void;
  onSignedOut: () => void;
}) {
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [lastRated, setLastRated] = useState<{ purchase: Purchase; liked: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pendingRatings()
      .then((r) => setPurchases(r.purchases))
      .catch((err) => {
        if (err instanceof NotSignedIn) return onSignedOut();
        setError(err instanceof Error ? err.message : "Couldn't load");
      });
  }, []);

  async function rate(purchase: Purchase, liked: boolean) {
    // Optimistic: the card leaves immediately, undo puts it back.
    setPurchases((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    setLastRated({ purchase, liked });
    try {
      await ratePurchase(purchase.id, liked);
      onRated();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't save that");
      setPurchases((current) => [purchase, ...(current ?? [])]);
      setLastRated(null);
    }
  }

  async function undo() {
    if (!lastRated) return;
    const { purchase } = lastRated;
    setLastRated(null);
    await unratePurchase(purchase.id).catch(() => undefined);
    setPurchases((current) => [purchase, ...(current ?? [])]);
    onRated();
  }

  async function remove(purchase: Purchase) {
    setPurchases((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    try {
      await deletePurchase(purchase.id);
      onRated();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't delete that");
      setPurchases((current) => [purchase, ...(current ?? [])]);
    }
  }

  if (error) {
    return (
      <p className="error">
        <Icon name="close" />
        {error}
      </p>
    );
  }
  if (purchases === null) return <p className="hint">Loading…</p>;

  if (purchases.length === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon name="check" size="1.5em" />
        </div>
        <h2>All caught up</h2>
        <p>Everything from your last haul has a thumbs up or down.</p>
        {lastRated && (
          <button className="ghost" onClick={undo}>
            <Icon name="undo" />
            Undo {lastRated.purchase.item_name}
          </button>
        )}
      </div>
    );
  }

  // Group by trip so it reads like "your Trader Joe's haul", not a flat list.
  const groups = new Map<string, Purchase[]>();
  for (const p of purchases) {
    const key = `${p.store} · ${p.when}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }

  return (
    <div className="stack">
      <p className="hint">
        {purchases.length} thing{purchases.length === 1 ? "" : "s"} to rate. Would you get it
        again?
      </p>

      {lastRated && (
        <div className="notice">
          <span className="notice-label">
            <Icon name={lastRated.liked ? "thumbUp" : "thumbDown"} />
            <span>{lastRated.purchase.item_name}</span>
          </span>
          <button className="ghost" onClick={undo}>
            <Icon name="undo" />
            Undo
          </button>
        </div>
      )}

      {[...groups.entries()].map(([heading, group]) => (
        <section key={heading}>
          <h3 className="section-heading">
            <Icon name="store" size="1em" />
            {heading}
          </h3>
          <div className="stack">
            {group.map((p) => (
              <article className="rate-card" key={p.id}>
                <div className="rate-top">
                  {photoUrl(p.photo) ? (
                    <img className="thumb" src={photoUrl(p.photo)!} alt="" />
                  ) : (
                    <div className="thumb thumb-empty">
                      <Icon name="cart" />
                    </div>
                  )}
                  <div className="row-body">
                    <strong>{p.item_name}</strong>
                    <span className="row-sub">
                      {[p.price, p.store].filter(Boolean).join("\u00a0\u00b7 ")}
                    </span>
                  </div>
                </div>
                <div className="rate-actions">
                  <DeleteButton label={p.item_name} onDelete={() => remove(p)} />
                  <button
                    className="vote down"
                    onClick={() => rate(p, false)}
                    aria-label={`Did not like ${p.item_name}`}
                  >
                    <Icon name="thumbDown" />
                  </button>
                  <button
                    className="vote up"
                    onClick={() => rate(p, true)}
                    aria-label={`Liked ${p.item_name}`}
                  >
                    <Icon name="thumbUp" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
