import { useCallback, useEffect, useState } from "react";

import Icon, { IconName } from "./components/Icon";
import AuthView from "./views/AuthView";
import ListView from "./views/ListView";
import LogView from "./views/LogView";
import RateView from "./views/RateView";
import { User, logout, me, pendingRatings } from "./api";

type Tab = "list" | "log" | "rate";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "list", label: "Shop", icon: "list" },
  { key: "log", label: "Log", icon: "plus" },
  { key: "rate", label: "Rate", icon: "thumbUp" },
];

export default function App() {
  // undefined = still checking the cookie, null = signed out.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  // She lands on the list, because that's the screen that saves her the thinking.
  const [tab, setTab] = useState<Tab>("list");
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);

  const refresh = useCallback(() => setRefreshKey((n) => n + 1), []);

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
    setUser(null);
    setMenuOpen(false);
    setTab("list");
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

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <div>
            <h1>
              {tab === "list" && "Shopping list"}
              {tab === "log" && "Log an item"}
              {tab === "rate" && "Rate your haul"}
            </h1>
            <p className="page-sub">
              {tab === "list" && "Things you liked, ready to buy again"}
              {tab === "log" && "Add what's going in the trolley"}
              {tab === "rate" && "Would you get it again?"}
            </p>
          </div>
          <button
            className="avatar"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Account"
          >
            {(user.display_name || user.email).trim().charAt(0).toUpperCase()}
          </button>
        </div>
        {menuOpen && (
          <div className="account-menu">
            <span className="account-email">{user.display_name || user.email}</span>
            <div className="account-actions">
              {/* Plain links, not fetch(): the browser sends the session cookie
                  with the navigation and handles the save dialog itself, so
                  there's no blob to build or revoke. Same-origin, so `download`
                  is honoured. */}
              <a className="ghost" href="/api/export.pdf" download>
                <Icon name="download" />
                PDF
              </a>
              <a className="ghost" href="/api/export.csv" download>
                <Icon name="download" />
                Spreadsheet
              </a>
              <a className="ghost" href="/api/export.zip" download>
                <Icon name="download" />
                Everything
              </a>
              <button className="ghost" onClick={signOut}>
                <Icon name="signOut" />
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* Keyed on the tab only: switching tabs refetches, but rating something
          must not remount RateView out from under its optimistic update. */}
      <main key={tab}>
        {tab === "list" && <ListView refreshKey={refreshKey} onSignedOut={() => setUser(null)} />}
        {tab === "log" && <LogView onLogged={refresh} onSignedOut={() => setUser(null)} />}
        {tab === "rate" && <RateView onRated={refresh} onSignedOut={() => setUser(null)} />}
      </main>

      <nav>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={t.key === tab ? "nav-item active" : "nav-item"}
            onClick={() => setTab(t.key)}
          >
            <span className="nav-icon">
              <Icon name={t.icon} size="1em" />
            </span>
            <span className="nav-label">{t.label}</span>
            {t.key === "rate" && pending > 0 && <span className="badge">{pending}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
