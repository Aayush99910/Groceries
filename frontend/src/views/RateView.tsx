import { useEffect, useState } from "react";

import ConfirmDialog from "../components/ConfirmDialog";
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

/** What the pop-up is currently asking about, if anything. */
type Asking =
  | { kind: "rate"; purchase: Purchase; liked: boolean }
  | { kind: "delete"; purchase: Purchase };

/**
 * "Did you like it?" -- one thing at a time.
 *
 * One item is on screen, big enough to recognise from its photo. Choosing an
 * answer (or deleting) asks "are you sure?" in an iOS-style pop-up first, because
 * both are easy to hit by accident and the delete can't be taken back.
 *
 * The most recent rating is shown under the buttons with an Undo right beside it,
 * so it's obvious what Undo will do and which item it brings back.
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
  // Newest last. Undo pops from the end.
  const [history, setHistory] = useState<{ purchase: Purchase; liked: boolean }[]>([]);
  const [total, setTotal] = useState(0);
  const [asking, setAsking] = useState<Asking | null>(null);
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
    setError(null);
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

  async function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setQueue((current) => [last.purchase, ...(current ?? [])]);
    setError(null);
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
    setError(null);
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

  const last = history[history.length - 1];

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
          {last && (
            <button type="button" className="ghost" onClick={undo}>
              <Icon name="undo" />
              Undo {last.purchase.item_name}
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
          onClick={() => setAsking({ kind: "rate", purchase: current, liked: false })}
          aria-label={`Skip ${current.item_name}`}
        >
          <Icon name="thumbDown" />
          Skip it
        </button>
        <button
          type="button"
          className="vote up"
          onClick={() => setAsking({ kind: "rate", purchase: current, liked: true })}
          aria-label={`Buy ${current.item_name} again`}
        >
          <Icon name="thumbUp" />
          Buy again
        </button>
      </div>

      <div className="rate-more">
        {queue.length > 1 && (
          <button type="button" className="text-btn" onClick={() => later(current)}>
            <Icon name="clock" size="1em" />
            Ask me later
          </button>
        )}
        <button
          type="button"
          className="text-btn danger-text"
          onClick={() => setAsking({ kind: "delete", purchase: current })}
        >
          <Icon name="trash" size="1em" />
          Delete
        </button>
      </div>

      {/* What you just did, and the way to take it back. Sits below everything
          else so it appearing never shifts the buttons you're about to tap. */}
      {last && (
        <div className="last-action" role="status">
          <span className={last.liked ? "last-icon up" : "last-icon down"}>
            <Icon name={last.liked ? "thumbUp" : "thumbDown"} size="1em" />
          </span>
          <span className="last-text">
            <strong>{last.purchase.item_name}</strong>
            <span>{last.liked ? "Marked buy again" : "Marked skip"}</span>
          </span>
          <button type="button" className="text-btn" onClick={undo}>
            <Icon name="undo" size="1em" />
            Undo
          </button>
        </div>
      )}

      {asking?.kind === "rate" && (
        <ConfirmDialog
          title={asking.liked ? `Buy ${asking.purchase.item_name} again?` : `Skip ${asking.purchase.item_name}?`}
          message={
            asking.liked
              ? "It goes on your Shop list, with what you paid for it."
              : "It moves to the things you didn't like, and stays off your main list."
          }
          onCancel={() => setAsking(null)}
          actions={[
            { label: "Cancel", onPress: () => setAsking(null) },
            {
              label: asking.liked ? "Buy again" : "Skip it",
              tone: "primary",
              onPress: () => {
                const { purchase, liked } = asking;
                setAsking(null);
                rate(purchase, liked);
              },
            },
          ]}
        />
      )}

      {asking?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${asking.purchase.item_name}?`}
          message="This removes it from your history, along with its price. It can't be undone."
          onCancel={() => setAsking(null)}
          actions={[
            { label: "Cancel", onPress: () => setAsking(null) },
            {
              label: "Delete",
              tone: "destructive",
              onPress: () => {
                const { purchase } = asking;
                setAsking(null);
                remove(purchase);
              },
            },
          ]}
        />
      )}
    </div>
  );
}
