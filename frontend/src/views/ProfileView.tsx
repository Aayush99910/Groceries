import { useEffect, useMemo, useState } from "react";

import Icon from "../components/Icon";
import {
  Haul,
  NotSignedIn,
  ShoppingList,
  User,
  changePassword,
  listHauls,
  money,
  shoppingList,
  updateProfile,
} from "../api";

/** "$1,234.50" -> 123450. Hauls report their total as a formatted string. */
function cents(total: string | null): number {
  if (!total) return 0;
  const value = parseFloat(total.replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/**
 * Who you are, what you've done, and your data.
 *
 * The avatar used to open a little menu of download links and a sign-out button,
 * which hid everything useful and told you nothing about yourself. This is a real
 * page: your name and email, a picture of your shopping so far, where you shop,
 * your exports, and the account controls.
 */
export default function ProfileView({
  user,
  onUser,
  onSignOut,
  onSignedOut,
  notify,
}: {
  user: User;
  onUser: (user: User) => void;
  onSignOut: () => void;
  onSignedOut: () => void;
  notify: (message: string) => void;
}) {
  const [hauls, setHauls] = useState<Haul[] | null>(null);
  const [list, setList] = useState<ShoppingList | null>(null);

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(user.display_name ?? "");
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    listHauls()
      .then((r) => setHauls(r.hauls))
      .catch((err) => {
        if (err instanceof NotSignedIn) return onSignedOut();
        setHauls([]);
      });
    shoppingList()
      .then(setList)
      .catch(() => setList(null));
  }, []);

  const name = user.display_name || user.email.split("@")[0];
  const memberSince = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    : null;

  // Everything below is derived from the history she already has; nothing new is
  // stored for it.
  const stats = useMemo(() => {
    if (!hauls) return null;
    const byStore = new Map<string, { name: string; trips: number; cents: number }>();
    for (const haul of hauls) {
      const key = haul.store.replace(/[‘’]/g, "'").trim().toLowerCase();
      const entry = byStore.get(key) ?? { name: haul.store, trips: 0, cents: 0 };
      entry.trips += 1;
      entry.cents += cents(haul.total);
      byStore.set(key, entry);
    }
    return {
      trips: hauls.length,
      items: hauls.reduce((n, h) => n + h.item_count, 0),
      spent: hauls.reduce((n, h) => n + cents(h.total), 0),
      stores: [...byStore.values()].sort((a, b) => b.trips - a.trips || b.cents - a.cents).slice(0, 4),
    };
  }, [hauls]);

  async function saveName(event: React.FormEvent) {
    event.preventDefault();
    setSavingName(true);
    setNameError(null);
    try {
      const result = await updateProfile(nameDraft);
      onUser(result.user);
      setEditingName(false);
      notify("Name updated");
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setNameError(err instanceof Error ? err.message : "Couldn't save that");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setPwError("The two new passwords don't match");
      return;
    }
    setSavingPw(true);
    setPwError(null);
    try {
      await changePassword(current, next);
      setPwOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      notify("Password changed. Other devices were signed out.");
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setPwError(err instanceof Error ? err.message : "Couldn't change it");
    } finally {
      setSavingPw(false);
    }
  }

  const dash = "–";

  return (
    <div className="screen">
      {/* ------------------------------------------------------------ who */}
      <section className="profile-card">
        <div className="avatar-lg" aria-hidden>
          {name.trim().charAt(0).toUpperCase()}
        </div>

        {editingName ? (
          <form className="profile-edit" onSubmit={saveName}>
            <div className="field">
              <label htmlFor="display-name">Your name</label>
              <input
                id="display-name"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                maxLength={60}
                autoComplete="name"
                autoFocus
              />
            </div>
            {nameError && (
              <p className="error">
                <Icon name="close" />
                {nameError}
              </p>
            )}
            <div className="button-row">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setEditingName(false);
                  setNameDraft(user.display_name ?? "");
                  setNameError(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="primary inline" disabled={savingName}>
                {savingName ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <div className="profile-id">
              <h2>{name}</h2>
              <p>{user.email}</p>
              {memberSince && <p className="muted">Member since {memberSince}</p>}
            </div>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setNameDraft(user.display_name ?? "");
                setEditingName(true);
              }}
            >
              <Icon name="pencil" />
              Edit name
            </button>
          </>
        )}
      </section>

      {/* ---------------------------------------------------------- stats */}
      <section>
        <h3 className="group-heading">
          <span>Your shopping</span>
        </h3>
        <div className="stat-grid">
          <Stat value={stats ? String(stats.trips) : dash} label="Trips" />
          <Stat value={stats ? String(stats.items) : dash} label="Items bought" />
          <Stat value={stats ? money(stats.spent) : dash} label="Tracked spend" />
          <Stat value={list ? String(list.liked.length) : dash} label="Favourites" />
        </div>
      </section>

      {stats && stats.stores.length > 0 && (
        <section>
          <h3 className="group-heading">
            <span>Where you shop</span>
          </h3>
          <div className="list-card">
            {stats.stores.map((s) => (
              <div className="row" key={s.name}>
                <span className="setting-icon">
                  <Icon name="store" />
                </span>
                <div className="row-body">
                  <strong>{s.name}</strong>
                  <span className="row-sub">
                    {s.trips} trip{s.trips === 1 ? "" : "s"}
                  </span>
                </div>
                {s.cents > 0 && <span className="price">{money(s.cents)}</span>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- data */}
      <section>
        <h3 className="group-heading">
          <span>Your data</span>
        </h3>
        <div className="list-card">
          {/* Plain links, not fetch(): the browser sends the session cookie with
              the navigation and handles the save dialog itself, so there's no blob
              to build or revoke. Same-origin, so `download` is honoured. */}
          <a className="row setting" href="/api/export.pdf" download>
            <span className="setting-icon">
              <Icon name="download" />
            </span>
            <div className="row-body">
              <strong>PDF report</strong>
              <span className="row-sub">Everything you've bought, printable</span>
            </div>
            <Icon name="chevronRight" />
          </a>
          <a className="row setting" href="/api/export.csv" download>
            <span className="setting-icon">
              <Icon name="download" />
            </span>
            <div className="row-body">
              <strong>Spreadsheet</strong>
              <span className="row-sub">CSV, opens in Excel or Numbers</span>
            </div>
            <Icon name="chevronRight" />
          </a>
          <a className="row setting" href="/api/export.zip" download>
            <span className="setting-icon">
              <Icon name="download" />
            </span>
            <div className="row-body">
              <strong>Full backup</strong>
              <span className="row-sub">A ZIP of your history and photos</span>
            </div>
            <Icon name="chevronRight" />
          </a>
        </div>
      </section>

      {/* -------------------------------------------------------- account */}
      <section>
        <h3 className="group-heading">
          <span>Account</span>
        </h3>
        <div className="list-card">
          <button
            type="button"
            className="row setting"
            aria-expanded={pwOpen}
            onClick={() => {
              setPwOpen((open) => !open);
              setPwError(null);
            }}
          >
            <span className="setting-icon">
              <Icon name="lock" />
            </span>
            <div className="row-body">
              <strong>Change password</strong>
              <span className="row-sub">Signs you out everywhere else</span>
            </div>
            <span className={pwOpen ? "disclosure-chevron open" : "disclosure-chevron"}>
              <Icon name="chevronDown" />
            </span>
          </button>

          {pwOpen && (
            <form className="pw-form" onSubmit={savePassword}>
              <div className="field">
                <label htmlFor="pw-current">Current password</label>
                <input
                  id="pw-current"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pw-new">
                  New password <span className="muted">· at least 8 characters</span>
                </label>
                <input
                  id="pw-new"
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="pw-confirm">Type the new one again</label>
                <input
                  id="pw-confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              {pwError && (
                <p className="error">
                  <Icon name="close" />
                  {pwError}
                </p>
              )}
              <button type="submit" className="primary" disabled={savingPw}>
                {savingPw ? "Saving…" : "Change password"}
              </button>
            </form>
          )}
        </div>
      </section>

      <button type="button" className="signout" onClick={onSignOut}>
        <Icon name="signOut" />
        Sign out
      </button>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
