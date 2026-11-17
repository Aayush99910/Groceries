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
 * "Did you like it?" -- one thing at a time.
 *
 * The first version listed every unrated item as a card and made her scroll and
 * hunt for the right row's buttons. That is the wrong shape for a yes/no
 * question. Here there is exactly one item on screen, big enough to recognise
 * from its photo, with the two answers under your thumb. Answer, and the next
 * one slides in. A progress bar says how many are left, and you can always step
 * back one.
 */
export default function RateView({
  onRated,
  onSignedOut,
  goShop,
  goTrip,
}: {
  onRated: () => void;
  onSignedOut: () => void;
  goShop: () => void;
  goTrip: () => void;
}) {
  const [queue, setQueue] = useState<Purchase[] | null>(null);
  // Newest last. "Back" pops from the end.
  const [history, setHistory] = useState<{ purchase: Purchase; liked: boolean }[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    pendingRatings()
      .then((r) => {
        setQueue(r.purchases);
        setTotal(r.purchases.length);
      })
      .catch((err) => {
        if (err instanceof NotSignedIn) return onSignedOut();
        setError(err instanceof Error ? err.message : "Couldn't load");
      });
  }, []);

  async function rate(purchase: Purchase, liked: boolean) {
    // Optimistic: the next item appears immediately; a failure puts this back.
    setQueue((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    setHistory((h) => [...h, { purchase, liked }]);
    try {
      await ratePurchase(purchase.id, liked);
      onRated();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't save that");
      setQueue((current) => [purchase, ...(current ?? [])]);
      setHistory((h) => h.filter((entry) => entry.purchase.id !== purchase.id));
    }
  }

  async function back() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((current) => [last.purchase, ...(current ?? [])]);
    await unratePurchase(last.purchase.id).catch(() => undefined);
    onRated();
  }

  function later(purchase: Purchase) {
    // Not ready to judge it yet: send it to the back of the line.
    setQueue((current) => [...(current ?? []).filter((p) => p.id !== purchase.id), purchase]);
  }

  async function remove(purchase: Purchase) {
    setQueue((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    setTotal((n) => Math.max(0, n - 1));
    try {
      await deletePurchase(purchase.id);
      onRated();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't delete that");
      setQueue((current) => [purchase, ...(current ?? [])]);
      setTotal((n) => n + 1);
    }
  }

  if (error && !queue) {
    return (
      <p className="error">
        <Icon name="close" />
        {error}
      </p>
    );
  }
  if (queue === null) return <p className="hint loading">Loading…</p>;

  // ---------------------------------------------------------------- done

  if (queue.length === 0) {
    const liked = history.filter((h) => h.liked).length;
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon name="check" size="1.5em" />
        </div>
        <h2>All caught up</h2>
        <p>
          {history.length > 0
            ? `You rated ${history.length} thing${history.length === 1 ? "" : "s"}${
                liked > 0 ? `, and ${liked} made your list.` : "."
              }`
            : "Nothing is waiting to be rated. Add things on the Trip tab and they'll show up here."}
        </p>
        <div className="empty-actions">
          {history.length > 0 ? (
            <button type="button" className="primary inline" onClick={goShop}>
              <Icon name="list" />
              See what to buy
            </button>
          ) : (
            <button type="button" className="primary inline" onClick={goTrip}>
              <Icon name="cart" />
              Start a trip
            </button>
          )}
          {history.length > 0 && (
            <button type="button" className="ghost" onClick={back}>
              <Icon name="undo" />
              Undo {history[history.length - 1].purchase.item_name}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- one item

  const current = queue[0];
  const done = total - queue.length;
  const src = photoUrl(current.photo);
  const details = [current.price, current.store, current.when].filter(Boolean).join(" · ");

  return (
    <div className="screen rate-screen">
      <div className="progress" aria-label={`${done} of ${total} rated`}>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="progress-text">
          {done + 1} of {total}
        </span>
      </div>

      {/* Keyed on the purchase so each new item animates in. */}
      <article className="rate-stage" key={current.id}>
        {src ? (
          <img className="rate-photo" src={src} alt={current.item_name} />
        ) : (
          <div className="rate-photo rate-photo-empty">
            <Icon name="cart" size="2.4em" />
          </div>
        )}
        <div className="rate-info">
          <h2>{current.item_name}</h2>
          <p>{details}</p>
        </div>
      </article>

      {error && (
        <p className="error">
          <Icon name="close" />
          {error}
        </p>
      )}

      <div className="vote-row">
        <button
          type="button"
          className="vote down"
          onClick={() => rate(current, false)}
          aria-label={`Did not like ${current.item_name}`}
        >
          <Icon name="thumbDown" size="1.5em" />
          Skip it
        </button>
        <button
          type="button"
          className="vote up"
          onClick={() => rate(current, true)}
          aria-label={`Liked ${current.item_name}`}
        >
          <Icon name="thumbUp" size="1.5em" />
          Buy again
        </button>
      </div>

      <div className="rate-more">
        <button type="button" className="text-btn" onClick={back} disabled={history.length === 0}>
          <Icon name="chevronLeft" size="1em" />
          Back
        </button>
        {queue.length > 1 && (
          <button type="button" className="text-btn" onClick={() => later(current)}>
            <Icon name="clock" size="1em" />
            Ask me later
          </button>
        )}
        <DeleteButton label={current.item_name} onDelete={() => remove(current)} />
      </div>
    </div>
  );
}
