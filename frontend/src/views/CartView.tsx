import { useCallback, useEffect, useMemo, useState } from "react";

import { useCachedState } from "../cache";
import ConfirmDialog from "../components/ConfirmDialog";
import Icon from "../components/Icon";
import PastTripSheet from "../components/PastTripSheet";
import QuickAddSheet from "../components/QuickAddSheet";
import Suggest from "../components/Suggest";
import {
  CartItem,
  NotSignedIn,
  Purchase,
  StorePlace,
  addToCart,
  clearCart,
  money,
  photoUrl,
  recentPurchases,
  removeFromCart,
  sameStore,
  shortStore,
  suggestItems,
} from "../api";

// "Got it" shows what she has bought in the last few hours: this shop. A clock, not
// the server's "today", which is UTC and would flip to "yesterday" mid-afternoon on
// the US west coast, emptying the list while she's still shopping.
const SHOP_WINDOW_MS = 8 * 60 * 60 * 1000;

/** What a planned item will probably cost: here if we know, else where she last got it. */
function estimateCents(item: CartItem, store: string | null): number | null {
  const here = store ? item.stores.find((s) => sameStore(s.store, store)) : undefined;
  if (here) return here.cents;
  const last = item.stores.find((s) => sameStore(s.store, item.last_store));
  if (last) return last.cents;
  return item.best?.cents ?? null;
}

/**
 * That day's shopping list.
 *
 * There is no "start a cart": it begins the moment something is put on it, from the
 * Shop feed, from a past trip, or typed in here, and is just an empty page until then.
 * Each thing is "to get" until she reaches it in the store and ticks it off, which
 * records the purchase (store and price) and moves it to "Got it".
 */
export default function CartView({
  cart,
  onCart,
  store,
  onStore,
  refreshKey,
  onLogged,
  goShop,
  notify,
  onSignedOut,
}: {
  cart: CartItem[];
  onCart: (items: CartItem[]) => void;
  /** The store she's at, if she has said. */
  store: StorePlace | null;
  onStore: (store: StorePlace) => void;
  refreshKey: number;
  onLogged: () => void;
  goShop: () => void;
  notify: (message: string) => void;
  onSignedOut: () => void;
}) {
  const [recent, setRecent] = useCachedState<Purchase[] | null>("cart-recent", null);
  const [name, setName] = useState("");
  // Bumped after each add so the field starts afresh, with its suggestion list closed.
  const [fieldKey, setFieldKey] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticking, setTicking] = useState<CartItem | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    recentPurchases(60)
      .then((r) => setRecent(r.purchases))
      .catch((err) => {
        if (err instanceof NotSignedIn) return onSignedOut();
        setRecent([]);
      });
  }, [refreshKey]);

  const itemOptions = useCallback((q: string) => suggestItems(q), []);

  // Bought during this shop, newest first.
  const got = useMemo(() => {
    const cutoff = Date.now() - SHOP_WINDOW_MS;
    return (recent ?? []).filter((p) => new Date(p.purchased_at).getTime() >= cutoff);
  }, [recent]);
  const gotTotal = got.reduce((sum, p) => sum + (p.price_cents ?? 0), 0);

  const storeName = store?.name ?? null;
  const estimates = cart.map((item) => estimateCents(item, storeName));
  const estimate = estimates.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  const unpriced = estimates.filter((c) => c == null).length;

  // Every store any planned thing has been bought at, for the "Got it" pop-up's chips.
  const knownStores = useMemo(() => {
    const names = new Set<string>();
    if (storeName) names.add(storeName);
    for (const item of cart) for (const s of item.stores) names.add(s.store);
    return [...names];
  }, [cart, storeName]);

  async function addByName(event: React.FormEvent) {
    event.preventDefault();
    const typed = name.trim();
    if (!typed) return;
    setAdding(true);
    setError(null);
    try {
      onCart((await addToCart({ name: typed })).items);
      setName("");
      setFieldKey((n) => n + 1);
      notify(`${typed} added to your cart`);
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setError(err instanceof Error ? err.message : "Couldn't add that");
    } finally {
      setAdding(false);
    }
  }

  async function remove(item: CartItem) {
    // Optimistic: it goes at once, and the server's answer replaces the list.
    onCart(cart.filter((c) => c.id !== item.id));
    try {
      onCart((await removeFromCart(item.id)).items);
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      onCart(cart);
      notify(err instanceof Error ? err.message : "Couldn't remove that");
    }
  }

  async function clearAll() {
    setConfirmClear(false);
    const before = cart;
    onCart([]);
    try {
      await clearCart();
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      onCart(before);
      notify(err instanceof Error ? err.message : "Couldn't clear your cart");
    }
  }

  return (
    <div className="screen">
      <form className="inline-form" onSubmit={addByName}>
        <Suggest
          key={fieldKey}
          label="Add to your cart"
          value={name}
          onChange={setName}
          fetchSuggestions={itemOptions}
          placeholder="Milk, eggs…"
        />
        <button type="submit" className="primary inline" disabled={!name.trim() || adding}>
          Add
        </button>
      </form>
      {error && (
        <p className="error">
          <Icon name="close" />
          {error}
        </p>
      )}

      <div className="cart-actions">
        <button type="button" className="ghost" onClick={() => setPastOpen(true)}>
          <Icon name="clock" />
          From a past trip
        </button>
        {cart.length > 0 && (
          <button type="button" className="text-btn danger-text" onClick={() => setConfirmClear(true)}>
            Clear cart
          </button>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="empty compact">
          <div className="empty-icon">
            <Icon name="cart" size="1.5em" />
          </div>
          <h2>Your cart is empty</h2>
          <p>
            Add things you plan to get. They'll be here to tick off when you reach the store.
          </p>
          <button type="button" className="primary inline" onClick={goShop}>
            <Icon name="sparkle" />
            Look through your feed
          </button>
        </div>
      ) : (
        <section>
          <h3 className="group-heading">
            <span>To get</span>
            <span className="group-count">
              {cart.length}
              {estimate > 0 && ` · about ${money(estimate)}`}
            </span>
          </h3>
          <div className="list-card">
            {cart.map((item) => {
              const cents = estimateCents(item, storeName);
              return (
                <article className="row" key={item.id}>
                  <button
                    type="button"
                    className="tick"
                    aria-label={`Got ${item.name}`}
                    onClick={() => setTicking(item)}
                  />
                  {photoUrl(item.photo) ? (
                    <img className="thumb" src={photoUrl(item.photo)!} alt="" />
                  ) : (
                    <div className="thumb thumb-empty">
                      <Icon name="cart" />
                    </div>
                  )}
                  <div className="row-body">
                    <strong className="clamp2">{item.name}</strong>
                    {/* The estimate lives under the name, not in a column of its own: a
                        price column left only a few letters of the name on a small phone. */}
                    <span className="row-sub">
                      {cents != null
                        ? `about ${money(cents)}`
                        : item.times_bought > 0
                          ? "No price yet"
                          : "Not bought before"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Take ${item.name} off your cart`}
                    onClick={() => remove(item)}
                  >
                    <Icon name="close" />
                  </button>
                </article>
              );
            })}
          </div>
          {unpriced > 0 && estimate > 0 && (
            <p className="caption" style={{ marginTop: 8 }}>
              The estimate leaves out {unpriced} thing{unpriced === 1 ? "" : "s"} with no price yet.
            </p>
          )}
        </section>
      )}

      {got.length > 0 && (
        <section>
          <h3 className="group-heading">
            <span>Got it</span>
            <span className="group-count">
              {got.length}
              {gotTotal > 0 && ` · ${money(gotTotal)}`}
            </span>
          </h3>
          <div className="list-card">
            {got.map((p) => (
              <article className="row got" key={p.id}>
                {photoUrl(p.photo) ? (
                  <img className="thumb thumb-sm" src={photoUrl(p.photo)!} alt="" />
                ) : (
                  <div className="thumb thumb-sm thumb-empty">
                    <Icon name="cart" />
                  </div>
                )}
                <div className="row-body">
                  <strong>{p.item_name}</strong>
                  <span className="row-sub">{shortStore(p.store)}</span>
                </div>
                {p.price ? <span className="price">{p.price}</span> : <span className="row-sub">no price</span>}
              </article>
            ))}
          </div>
        </section>
      )}

      {ticking && (
        <QuickAddSheet
          entry={ticking}
          defaultStore={storeName ?? ""}
          place={store}
          eyebrow="Got it?"
          knownStores={knownStores}
          onClose={() => setTicking(null)}
          onSignedOut={onSignedOut}
          onAdded={(boughtAt) => {
            // Buying it takes it off the cart on the server; mirror that now so the
            // row doesn't linger while the refresh is on its way.
            onCart(cart.filter((c) => c.id !== ticking.id));
            // Where she is follows what she just did, and keeps its branch id if it's
            // the store she had already picked.
            onStore(store && sameStore(store.name, boughtAt) ? store : { name: boughtAt });
            notify(`${ticking.name} ticked off`);
            setTicking(null);
            onLogged();
          }}
        />
      )}

      {pastOpen && (
        <PastTripSheet
          cart={cart}
          onClose={() => setPastOpen(false)}
          onSignedOut={onSignedOut}
          onAdded={(items, count) => {
            onCart(items);
            setPastOpen(false);
            notify(`${count} thing${count === 1 ? "" : "s"} added to your cart`);
          }}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear your cart?"
          message={`This takes all ${cart.length} thing${cart.length === 1 ? "" : "s"} off your cart. It doesn't delete anything you've already bought.`}
          onCancel={() => setConfirmClear(false)}
          actions={[
            { label: "Cancel", onPress: () => setConfirmClear(false) },
            { label: "Clear cart", tone: "destructive", onPress: clearAll },
          ]}
        />
      )}
    </div>
  );
}
