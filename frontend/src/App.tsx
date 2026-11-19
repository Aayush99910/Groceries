import { useCallback, useEffect, useRef, useState } from "react";

import Icon, { IconName } from "./components/Icon";
import AuthView from "./views/AuthView";
import ProfileView from "./views/ProfileView";
import RateView from "./views/RateView";
import ShopView from "./views/ShopView";
import AddView from "./views/AddView";
import CartView from "./views/CartView";
import { CartItem, StorePlace, User, getCart, logout, me, pendingRatings, photoUrl } from "./api";

type Tab = "shop" | "cart" | "add" | "rate";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "shop", label: "Shop", icon: "sparkle" },
  { key: "cart", label: "Cart", icon: "cart" },
  { key: "add", label: "Add", icon: "plus" },
  { key: "rate", label: "Rate", icon: "thumbUp" },
];

// The store she's at is shared by the Add and Shop tabs.
//
// It is remembered for the length of a shop, NOT forever. It used to be kept
// indefinitely, so a day later the Add tab still said "Trader Joe's" when she was
// standing in Safeway. Now it expires after a shop's worth of hours and she's asked
// again. Each time she adds something the clock restarts.
const STORE_KEY = "groceries.lastStore";
const STORE_TTL_MS = 8 * 60 * 60 * 1000;

function readStore(): StorePlace | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof saved.name === "string" &&
      typeof saved.at === "number" &&
      Date.now() - saved.at < STORE_TTL_MS
    ) {
      // place_id may be absent: saved before branches were tracked, or typed by hand.
      return {
        name: saved.name,
        place_id: typeof saved.place_id === "number" ? saved.place_id : null,
        lat: typeof saved.lat === "number" ? saved.lat : null,
        lon: typeof saved.lon === "number" ? saved.lon : null,
      };
    }
    localStorage.removeItem(STORE_KEY);
    return null;
  } catch {
    // Not JSON: the old plain-text value from before expiry existed. Drop it.
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
    return null;
  }
}

export default function App() {
  // undefined = still checking the cookie, null = signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // She lands on what to buy, because that's the screen that saves her the thinking.
  const [tab, setTab] = useState<Tab>("shop");
  const [view, setView] = useState<"tabs" | "profile">("tabs");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(0);
  // What she plans to get. Held here, not in a screen, so the Shop feed can show
  // "In cart", the Cart can list it, and the tab can carry a count.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [store, setStoreState] = useState(readStore);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  // Stable identities matter: the views put these in effect dependencies, and a
  // new function every render would refetch on every render.
  const onSignedOut = useCallback(() => setUser(null), []);

  const setStore = useCallback((next: StorePlace) => {
    setStoreState(next);
    try {
      // place_id and coordinates ride along, so coming back to a remembered store
      // still logs against the same branch rather than starting a new one.
      localStorage.setItem(STORE_KEY, JSON.stringify({ ...next, at: Date.now() }));
    } catch {
      // Private mode: it just won't be remembered.
    }
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // The app can sit open in the background for days. When she comes back, drop a
  // store that has expired in the meantime.
  useEffect(() => {
    function onVisible() {
      if (!document.hidden) setStoreState(readStore());
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    me()
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    pendingRatings()
      .then((r) => setPending(r.purchases.length))
      .catch(() => undefined);
    getCart()
      .then((r) => setCart(r.items))
      .catch(() => undefined);
  }, [refreshKey, user]);

  async function signOut() {
    await logout().catch(() => undefined);
    // Whoever signs in next on this phone shouldn't inherit this store.
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
    setStoreState(null);
    setCart([]);
    setUser(null);
    setView("tabs");
    setTab("shop");
    setToast(null);
  }

  function go(next: Tab) {
    setTab(next);
    setView("tabs");
  }

  if (user === undefined) {
    return (
      <div className="app">
        <p className="hint loading">Loading…</p>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="app">
        <AuthView onSignedIn={setUser} />
      </div>
    );
  }

  const heading: Record<Tab, { title: string; sub: string }> = {
    shop: { title: "For you", sub: "Things you liked, ready for your cart" },
    cart: {
      title: "Your cart",
      sub: cart.length > 0 ? "Tick things off as you shop" : "Plan what to get",
    },
    add: { title: "Add what you bought", sub: store ? "" : "Pick a store to begin" },
    rate: {
      title: "Rate your items",
      sub: pending > 0 ? "" : "Nothing waiting",
    },
  };

  return (
    <div className="app">
      {view === "profile" ? (
        <header className="top-bar">
          <button type="button" className="back-btn" onClick={() => setView("tabs")}>
            <Icon name="chevronLeft" />
            Back
          </button>
          <h1 className="top-title">Profile</h1>
          <span className="top-spacer" aria-hidden />
        </header>
      ) : (
        <header>
          <div className="header-row">
            <div>
              <h1>{heading[tab].title}</h1>
              {heading[tab].sub && <p className="page-sub">{heading[tab].sub}</p>}
            </div>
            <button
              type="button"
              className="avatar"
              onClick={() => setView("profile")}
              aria-label="Your profile"
            >
              {photoUrl(user.avatar ?? null) ? (
                <img src={photoUrl(user.avatar ?? null)!} alt="" />
              ) : (
                (user.display_name || user.email).trim().charAt(0).toUpperCase()
              )}
            </button>
          </div>
        </header>
      )}

      {/* Keyed on the screen only: switching tabs refetches, but rating something
          must not remount RateView out from under its optimistic update. */}
      <main key={view === "profile" ? "profile" : tab} className={view === "profile" ? "no-nav" : undefined}>
        {view === "profile" ? (
          <ProfileView
            user={user}
            onUser={setUser}
            onSignOut={signOut}
            onSignedOut={onSignedOut}
            notify={notify}
          />
        ) : (
          <>
            {tab === "shop" && (
              <ShopView
                refreshKey={refreshKey}
                cart={cart}
                onCart={setCart}
                pending={pending}
                goRate={() => go("rate")}
                goAdd={() => go("add")}
                notify={notify}
                onSignedOut={onSignedOut}
              />
            )}
            {tab === "cart" && (
              <CartView
                cart={cart}
                onCart={setCart}
                store={store}
                onStore={setStore}
                refreshKey={refreshKey}
                onLogged={refresh}
                goShop={() => go("shop")}
                notify={notify}
                onSignedOut={onSignedOut}
              />
            )}
            {tab === "add" && (
              <AddView
                store={store}
                onStore={setStore}
                refreshKey={refreshKey}
                onLogged={refresh}
                notify={notify}
                onSignedOut={onSignedOut}
              />
            )}
            {tab === "rate" && (
              <RateView
                onRated={refresh}
                onSignedOut={onSignedOut}
                goShop={() => go("shop")}
                goAdd={() => go("add")}
              />
            )}
          </>
        )}
      </main>

      {toast && (
        <div className={view === "profile" ? "toast no-nav" : "toast"} role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}

      {/* The profile page is a detail screen: Back is the only way out, so there
          is no tab bar competing with it. */}
      {view === "tabs" && (
        <nav>
          {TABS.map((t) => {
            const active = view === "tabs" && t.key === tab;
            return (
              <button
                key={t.key}
                className={active ? "nav-item active" : "nav-item"}
                aria-current={active ? "page" : undefined}
                onClick={() => go(t.key)}
              >
                <span className="nav-icon">
                  <Icon name={t.icon} size="1em" />
                </span>
                <span className="nav-label">{t.label}</span>
                {t.key === "rate" && pending > 0 && <span className="badge">{pending}</span>}
                {t.key === "cart" && cart.length > 0 && (
                  <span className="badge soft">{cart.length}</span>
                )}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
