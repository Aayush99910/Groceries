import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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

// Matches the track's side padding in the stylesheet: the first card sits this far
// in from the screen edge, and scroll positions are measured from there.
const PAD = 20;

// How long a card takes to fade out before it's removed from the row.
const LEAVE_MS = 220;

/**
 * "Did you like it?" -- a row of cards you swipe through.
 *
 * Every unrated item is a card in one horizontal row, with the next card peeking in
 * from the edge so it's obvious there's more. Swipe to look through them; the
 * Skip it / Buy again buttons act on whichever card is in front. (Swiping only
 * browses. It never rates anything, so a slip of the thumb can't record an answer.)
 *
 * Choosing an answer, or deleting, asks "are you sure?" in an iOS-style pop-up
 * first. The most recent rating is shown under the buttons with an Undo beside it,
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
  // Newest last. `index` is where the card sat, so Undo puts it back in place.
  const [history, setHistory] = useState<{ purchase: Purchase; liked: boolean; index: number }[]>(
    []
  );
  const [total, setTotal] = useState(0);
  // Which card is centred, from the scroll position.
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trackRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  // Set when the row should scroll to a card once React has rendered it.
  const pendingScroll = useRef<number | null>(null);

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

  const cards = useCallback(
    () => (trackRef.current ? (Array.from(trackRef.current.children) as HTMLElement[]) : []),
    []
  );

  const scrollToIndex = useCallback(
    (i: number, smooth = true) => {
      const track = trackRef.current;
      const card = cards()[i];
      if (!track || !card) return;
      track.scrollTo({ left: card.offsetLeft - PAD, behavior: smooth ? "smooth" : "auto" });
    },
    [cards]
  );

  // Work out which card is in front. Throttled to one check per frame.
  function onScroll() {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const track = trackRef.current;
      if (!track) return;
      let best = 0;
      let bestDistance = Infinity;
      cards().forEach((card, i) => {
        const distance = Math.abs(card.offsetLeft - PAD - track.scrollLeft);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      });
      setIndex(best);
    });
  }

  // After the list changes: keep `index` valid, and honour a requested scroll.
  useLayoutEffect(() => {
    if (!queue) return;
    if (pendingScroll.current !== null) {
      scrollToIndex(pendingScroll.current);
      setIndex(pendingScroll.current);
      pendingScroll.current = null;
    } else if (index > queue.length - 1) {
      setIndex(Math.max(0, queue.length - 1));
    }
  }, [queue, index, scrollToIndex]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  async function rate(purchase: Purchase, liked: boolean, at: number) {
    // Optimistic: the card goes immediately; a failure puts it back where it was.
    setQueue((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    setHistory((h) => [...h, { purchase, liked, index: at }]);
    setError(null);
    try {
      await ratePurchase(purchase.id, liked);
      onRated();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't save that");
      restore(purchase, at);
      setHistory((h) => h.filter((entry) => entry.purchase.id !== purchase.id));
    }
  }

  function restore(purchase: Purchase, at: number) {
    pendingScroll.current = at;
    setQueue((current) => {
      const next = [...(current ?? [])];
      next.splice(Math.min(at, next.length), 0, purchase);
      return next;
    });
  }

  async function undo() {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    setError(null);
    restore(last.purchase, last.index);
    await unratePurchase(last.purchase.id).catch(() => undefined);
    onRated();
  }

  async function remove(purchase: Purchase, at: number) {
    setQueue((current) => (current ?? []).filter((p) => p.id !== purchase.id));
    setTotal((n) => Math.max(0, n - 1));
    setError(null);
    try {
      await deletePurchase(purchase.id);
      onRated();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't delete that");
      restore(purchase, at);
      setTotal((n) => n + 1);
    }
  }

  /** Fade the card out first, so it doesn't just blink away. */
  function leaveThen(purchase: Purchase, action: () => void) {
    setLeaving(purchase.id);
    setTimeout(() => {
      setLeaving(null);
      action();
    }, LEAVE_MS);
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

  // ---------------------------------------------------------------- the row

  const at = Math.min(index, queue.length - 1);
  const current = queue[at];
  const done = total - queue.length;

  return (
    <div className="screen rate-screen">
      {/* Says what to do, in words. This used to be left for people to work out. */}
      <div className="how-to">
        <span className="how-to-icon" aria-hidden>
          <Icon name="chevronLeft" size="0.9em" />
          <Icon name="chevronRight" size="0.9em" />
        </span>
        {queue.length > 1 ? (
          <p>
            <strong>Swipe</strong> to browse.{" "}
            <span className="how-to-more">
              Tap <strong>Buy again</strong> if you'd get it again, or <strong>Skip it</strong> if
              not.
            </span>
          </p>
        ) : (
          <p>
            Last one. Tap <strong>Buy again</strong> if you'd get it again, or{" "}
            <strong>Skip it</strong> if not.
          </p>
        )}
      </div>

      <div className="progress" aria-label={`${done} of ${total} rated`}>
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <span className="progress-text">{queue.length} left</span>
      </div>

      <div
        className="carousel"
        ref={trackRef}
        onScroll={onScroll}
        role="group"
        aria-roledescription="carousel"
        aria-label="Items to rate"
      >
        {queue.map((purchase, i) => {
          const src = photoUrl(purchase.photo);
          const details = [purchase.price, purchase.store, purchase.when]
            .filter(Boolean)
            .join(" · ");
          return (
            <article
              key={purchase.id}
              className={leaving === purchase.id ? "slide leaving" : "slide"}
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${queue.length}`}
            >
              {src ? (
                <img className="rate-photo" src={src} alt={purchase.item_name} draggable={false} />
              ) : (
                <div className="rate-photo rate-photo-empty">
                  <Icon name="cart" size="2.4em" />
                </div>
              )}
              <div className="rate-info">
                <h2>{purchase.item_name}</h2>
                <p>{details}</p>
              </div>
            </article>
          );
        })}
      </div>

      {/* Where you are in the row, with buttons for anyone who can't swipe. */}
      <div className="pager">
        <button
          type="button"
          className="pager-btn"
          onClick={() => scrollToIndex(at - 1)}
          disabled={at === 0}
          aria-label="Previous item"
        >
          <Icon name="chevronLeft" />
        </button>
        {queue.length <= 8 ? (
          <span className="dots" aria-hidden>
            {queue.map((p, i) => (
              <span key={p.id} className={i === at ? "dot on" : "dot"} />
            ))}
          </span>
        ) : (
          <span className="pager-text">
            {at + 1} of {queue.length}
          </span>
        )}
        <button
          type="button"
          className="pager-btn"
          onClick={() => scrollToIndex(at + 1)}
          disabled={at >= queue.length - 1}
          aria-label="Next item"
        >
          <Icon name="chevronRight" />
        </button>
      </div>

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
        <button
          type="button"
          className="text-btn danger-text"
          onClick={() => setAsking({ kind: "delete", purchase: current })}
        >
          <Icon name="trash" size="1em" />
          Delete this one
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
          title={
            asking.liked
              ? `Buy ${asking.purchase.item_name} again?`
              : `Skip ${asking.purchase.item_name}?`
          }
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
                leaveThen(purchase, () => rate(purchase, liked, at));
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
                leaveThen(purchase, () => remove(purchase, at));
              },
            },
          ]}
        />
      )}
    </div>
  );
}
