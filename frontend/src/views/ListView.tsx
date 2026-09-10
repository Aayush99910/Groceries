import { useEffect, useState } from "react";

import Icon from "../components/Icon";
import { ListEntry, NotSignedIn, ShoppingList, photoUrl, shoppingList } from "../api";

type Bucket = "liked" | "unrated" | "disliked";

const TABS: { key: Bucket; label: string; blurb: string }[] = [
  { key: "liked", label: "Buy again", blurb: "Things you liked, with what you paid." },
  { key: "unrated", label: "Not rated", blurb: "Bought, but never given a thumbs up or down." },
  { key: "disliked", label: "Skip", blurb: "You didn't like these. Walk past them." },
];

/**
 * Screen 3: "let's go grocery today".
 *
 * The whole point of the app: she opens this in the shop and doesn't have to
 * think. Liked things, grouped by aisle, with the store and price she last paid.
 * Ticking things off is local-only -- checking a box is not a purchase, logging
 * one is, and conflating the two would poison the history.
 */
export default function ListView({
  refreshKey,
  onSignedOut,
}: {
  refreshKey: number;
  onSignedOut: () => void;
}) {
  const [data, setData] = useState<ShoppingList | null>(null);
  const [tab, setTab] = useState<Bucket>("liked");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    shoppingList()
      .then(setData)
      .catch((err) => {
        // A dead session shouldn't read as a broken page.
        if (err instanceof NotSignedIn) return onSignedOut();
        setError(err instanceof Error ? err.message : "Couldn't load");
      });
  }, [refreshKey]);

  function toggle(id: number) {
    setTicked((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (error) {
    return (
      <p className="error">
        <Icon name="close" />
        {error}
      </p>
    );
  }
  if (!data) return <p className="hint">Loading…</p>;

  const counts: Record<Bucket, number> = {
    liked: data.liked.length,
    unrated: data.unrated.length,
    disliked: data.disliked.length,
  };

  if (counts.liked + counts.unrated + counts.disliked === 0) {
    return (
      <div className="empty">
        <div className="empty-icon">
          <Icon name="cart" size="1.5em" />
        </div>
        <h2>Nothing logged yet</h2>
        <p>
          Log a few things from your next shop, rate them once you've eaten them, and this
          list builds itself.
        </p>
      </div>
    );
  }

  const active = TABS.find((t) => t.key === tab)!;
  const entries = data[tab];

  return (
    <div className="stack">
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={t.key === tab ? "tab active" : "tab"}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <p className="hint">{active.blurb}</p>

      {tab === "liked" && ticked.size > 0 && (
        <div className="notice">
          <span className="notice-label">
            <Icon name="cart" />
            <span>{ticked.size} in the trolley — log them on the Log tab</span>
          </span>
          <button className="ghost" onClick={() => setTicked(new Set())}>
            Clear
          </button>
        </div>
      )}

      {entries.length === 0 && <p className="hint">Nothing here yet.</p>}

      {tab === "liked"
        ? data.liked_grouped.map((group) => (
            <section key={group.category}>
              <h3 className="section-heading">{group.label}</h3>
              <div className="stack">
                {group.items.map((entry) => (
                  <Row
                    key={entry.item_id}
                    entry={entry}
                    ticked={ticked.has(entry.item_id)}
                    onToggle={() => toggle(entry.item_id)}
                  />
                ))}
              </div>
            </section>
          ))
        : entries.map((entry) => (
            <Row key={entry.item_id} entry={entry} muted={tab === "disliked"} />
          ))}
    </div>
  );
}

function Row({
  entry,
  ticked,
  onToggle,
  muted,
}: {
  entry: ListEntry;
  ticked?: boolean;
  onToggle?: () => void;
  muted?: boolean;
}) {
  // Cheapest store is only worth calling out if she has actually seen it
  // somewhere cheaper than the place she last bought it.
  const cheaper =
    entry.best && entry.last_store && entry.best.store !== entry.last_store ? entry.best : null;

  const subtitle = [
    entry.last_price ? `${entry.last_price} at ${entry.last_store}` : entry.last_store,
    entry.when,
  ]
    .filter(Boolean)
    .join("\u00a0\u00b7 ");

  return (
    <article
      className={`list-row${ticked ? " ticked" : ""}${muted ? " muted-row" : ""}`}
      onClick={onToggle}
      role={onToggle ? "button" : undefined}
    >
      {onToggle && (
        <div className={`tick${ticked ? " on" : ""}`}>{ticked && <Icon name="check" size="0.9em" />}</div>
      )}
      {photoUrl(entry.photo) ? (
        <img className="thumb" src={photoUrl(entry.photo)!} alt="" />
      ) : (
        <div className="thumb thumb-empty">
          <Icon name="cart" />
        </div>
      )}
      <div className="row-body">
        <strong>{entry.name}</strong>
        <span className="row-sub">{subtitle}</span>
        {cheaper && (
          <span className="cheaper">
            <Icon name="tag" size="0.95em" />
            {cheaper.price} at {cheaper.store}
          </span>
        )}
      </div>
      <div className="row-meta">
        {entry.likes > 0 && (
          <span className="up">
            <Icon name="thumbUp" size="0.95em" />
            {entry.likes}
          </span>
        )}
        {entry.dislikes > 0 && (
          <span className="down">
            <Icon name="thumbDown" size="0.95em" />
            {entry.dislikes}
          </span>
        )}
      </div>
    </article>
  );
}
