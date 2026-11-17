import { useCallback, useEffect, useRef, useState } from "react";

import Icon, { IconName } from "./components/Icon";
import AuthView from "./views/AuthView";
import ProfileView from "./views/ProfileView";
import RateView from "./views/RateView";
import ShopView from "./views/ShopView";
import TripView from "./views/TripView";
import { User, logout, me, pendingRatings } from "./api";

type Tab = "shop" | "trip" | "rate";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "shop", label: "Shop", icon: "list" },
  { key: "trip", label: "Trip", icon: "cart" },
  { key: "rate", label: "Rate", icon: "thumbUp" },
];

// The store she's at is shared by the Shop and Trip tabs, and survives a reload:
// she is in one shop for the whole trip, not twelve.
const STORE_KEY = "groceries.lastStore";

function readStore(): string {
  try {
    return localStorage.getItem(STORE_KEY) ?? "";
  } catch {
    return "";
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
  const [store, setStoreState] = useState(readStore);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();

  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

  // Stable identities matter: the views put these in effect dependencies, and a
  // new function every render would refetch on every render.
  const onSignedOut = useCallback(() => setUser(null), []);

  const setStore = useCallback((next: string) => {
    setStoreState(next);
    try {
      localStorage.setItem(STORE_KEY, next);
    } catch {
      // Private mode: it just won't be remembered.
    }
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
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
  }, [refreshKey, user]);

  async function signOut() {
    await logout().catch(() => undefined);
    // Whoever signs in next on this phone shouldn't inherit this trip.
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
    setStoreState("");
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
    shop: { title: "What to buy", sub: "Things you liked, with what you paid" },
    trip: store
      ? { title: "Your trip", sub: "Add things as they go in the trolley" }
      : { title: "Start a trip", sub: "Pick a store to begin" },
    rate: {
      title: "Rate your items",
      sub: pending > 0 ? "Would you get each one again?" : "Nothing waiting",
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
              <p className="page-sub">{heading[tab].sub}</p>
            </div>
            <button
              type="button"
              className="avatar"
              onClick={() => setView("profile")}
              aria-label="Your profile"
            >
              {(user.display_name || user.email).trim().charAt(0).toUpperCase()}
            </button>
          </div>
        </header>
      )}

      {/* Keyed on the screen only: switching tabs refetches, but rating something
          must not remount RateView out from under its optimistic update. */}
      <main key={view === "profile" ? "profile" : tab}>
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
                store={store}
                onStore={setStore}
                pending={pending}
                goRate={() => go("rate")}
                goTrip={() => go("trip")}
                onAdded={refresh}
                notify={notify}
                onSignedOut={onSignedOut}
              />
            )}
            {tab === "trip" && (
              <TripView
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
                goTrip={() => go("trip")}
              />
            )}
          </>
        )}
      </main>

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" />
          {toast}
        </div>
      )}

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
            </button>
          );
        })}
      </nav>
    </div>
  );
}
