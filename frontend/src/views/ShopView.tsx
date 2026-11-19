import { useEffect, useMemo, useState } from "react";

import { useCachedState } from "../cache";
import Icon from "../components/Icon";
import ItemSheet from "../components/ItemSheet";
import {
  CartItem,
  ListEntry,
  NotSignedIn,
  ShoppingList,
  addToCart,
  photoUrl,
  removeFromCart,
  sameStore,
  shoppingList,
} from "../api";

/**
 * A feed of things she liked, to look through.
 *
 * Shop isn't a list to work down. It's a scroll of photo cards: look at one, think
 * "oh, I fancy that", and put it on the cart with one tap. What she'll actually buy
 * is planned on the Cart tab.
 *
 * The order is the only "recommendation" for now: things she liked and hasn't had
 * for the longest come first. That needs just one purchase per item, so it works
 * with the history she has today. Frequency-based suggestions can't yet (almost
 * nothing has been bought twice). The same feed is where smarter suggestions, from
 * an AI later, would slot in: this screen only knows how to show a list of items.
 */
export default function ShopView({
  refreshKey,
  cart,
  onCart,
  pending,
  goRate,
  goAdd,
  notify,
  onSignedOut,
}: {
  refreshKey: number;
  /** What's on the cart now, so a card can show "In cart". */
  cart: CartItem[];
  onCart: (items: CartItem[]) => void;
  pending: number;
  goRate: () => void;
  goAdd: () => void;
  notify: (message: string) => void;
  onSignedOut: () => void;
}) {
  const [data, setData] = useCachedState<ShoppingList | null>("shop", null);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListEntry | null>(null);
  // Cards whose button is mid-request, so a double tap can't send two.
  const [busy, setBusy] = useState<Set<number>>(new Set());

  useEffect(() => {
    shoppingList()
      .then(setData)
      .catch((err) => {
        // A dead session shouldn't read as a broken page.
        if (err instanceof NotSignedIn) return onSignedOut();
        setError(err instanceof Error ? err.message : "Couldn't load");
      });
  }, [refreshKey]);

  // Liked, and not had for the longest first.
  const feed = useMemo(() => {
    const liked = [...(data?.liked ?? [])];
    liked.sort((a, b) => (a.last_bought_at ?? "").localeCompare(b.last_bought_at ?? ""));
    return liked;
  }, [data]);

  const inCart = useMemo(() => new Map(cart.map((c) => [c.item_id, c])), [cart]);

  async function toggle(entry: ListEntry) {
    if (busy.has(entry.item_id)) return;
    setBusy((current) => new Set(current).add(entry.item_id));
    try {
      const existing = inCart.get(entry.item_id);
      if (existing) {
        onCart((await removeFromCart(existing.id)).items);
      } else {
        onCart((await addToCart({ itemIds: [entry.item_id] })).items);
        notify(`${entry.name} added to your cart`);
      }
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      notify(err instanceof Error ? err.message : "Couldn't update your cart");
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(entry.item_id);
        return next;
      });
    }
  }

  if (error && !data) {
    return (
      <p className="error">
        <Icon name="close" />
        {error}
      </p>
    );
  }
  if (!data) return <p className="hint loading">Loading…</p>;

  return (
    <div className="screen">
      {pending > 0 && (
        <button type="button" className="banner" onClick={goRate}>
          <span className="banner-icon">
            <Icon name="thumbUp" />
          </span>
          <span className="banner-text">
            <strong>
              {pending} thing{pending === 1 ? "" : "s"} to rate
            </strong>
            <span>Tell us what you thought of them</span>
          </span>
          <Icon name="chevronRight" />
        </button>
      )}

      {feed.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="sparkle" size="1.5em" />
          </div>
          <h2>Your feed fills up as you rate</h2>
          <p>
            Add what you buy on the Add tab, rate it once you've tried it, and the things you liked
            show up here to put back on your cart.
          </p>
          <button type="button" className="primary inline" onClick={goAdd}>
            <Icon name="plus" />
            Add something
          </button>
        </div>
      ) : (
        <div className="feed">
          {feed.map((entry) => (
            <FeedCard
              key={entry.item_id}
              entry={entry}
              inCart={inCart.has(entry.item_id)}
              busy={busy.has(entry.item_id)}
              onOpen={() => setDetail(entry)}
              onToggle={() => toggle(entry)}
            />
          ))}
        </div>
      )}

      {detail && (
        <ItemSheet
          name={detail.name}
          photo={detail.photo}
          category={detail.category_label}
          price={detail.last_price}
          store={detail.last_store}
          when={detail.when}
          stores={detail.stores}
          likes={detail.likes}
          dislikes={detail.dislikes}
          timesBought={detail.times_bought}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function FeedCard({
  entry,
  inCart,
  busy,
  onOpen,
  onToggle,
}: {
  entry: ListEntry;
  inCart: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const src = photoUrl(entry.photo);

  // Only worth a flag if it's genuinely cheaper than where she last bought it.
  const lastPrice = entry.stores.find((s) => sameStore(s.store, entry.last_store));
  const cheaper =
    entry.best &&
    !sameStore(entry.best.store, entry.last_store) &&
    (!lastPrice || entry.best.cents < lastPrice.cents)
      ? entry.best
      : null;

  return (
    <article className="feed-card">
      <button type="button" className="feed-photo" onClick={onOpen} aria-label={`See ${entry.name}`}>
        {src ? (
          <img src={src} alt="" draggable={false} loading="lazy" />
        ) : (
          <span className="feed-photo-empty">
            <Icon name="cart" size="2.2em" />
          </span>
        )}
        {entry.when && entry.when !== "today" && (
          <span className="feed-chip">
            <Icon name="clock" size="0.95em" />
            Last had {entry.when}
          </span>
        )}
      </button>

      <div className="feed-body">
        <div className="feed-text">
          <strong>{entry.name}</strong>
          <span className="row-sub">
            {[entry.last_price, entry.last_store].filter(Boolean).join(" · ")}
          </span>
          {cheaper && (
            <span className="cheaper">
              <Icon name="tag" size="0.95em" />
              <span>
                Cheaper at {cheaper.store} {"·"} {cheaper.price}
              </span>
            </span>
          )}
        </div>

        <button
          type="button"
          className={inCart ? "cart-add on" : "cart-add"}
          onClick={onToggle}
          disabled={busy}
          aria-pressed={inCart}
          aria-label={inCart ? `Take ${entry.name} off your cart` : `Add ${entry.name} to your cart`}
        >
          <Icon name={inCart ? "check" : "plus"} />
          {inCart ? "In cart" : "Add"}
        </button>
      </div>
    </article>
  );
}
