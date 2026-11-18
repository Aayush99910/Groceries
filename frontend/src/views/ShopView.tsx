import { useEffect, useMemo, useState } from "react";

import { useCachedState } from "../cache";
import Icon from "../components/Icon";
import ItemSheet from "../components/ItemSheet";
import QuickAddSheet from "../components/QuickAddSheet";
import { ListEntry, NotSignedIn, ShoppingList, photoUrl, sameStore, shoppingList } from "../api";

/**
 * "What should I buy?"
 *
 * This used to be called the shopping list, but it isn't one -- it's everything
 * she has liked, and there was nothing to do with it except tick local boxes that
 * meant nothing. Now it answers the real question: *I'm at this store, what do I
 * usually get here, and what does it cost?*
 *
 *   - Pick a store (or "All") and see only what she has bought and liked there,
 *     at the price she paid there.
 *   - The + on a row adds it to her basket in two taps, price prefilled.
 *   - Things waiting for a rating live on the Rate tab, so this screen doesn't
 *     carry its own confusing "not rated" bucket; a banner points the way.
 */
export default function ShopView({
  refreshKey,
  store,
  onStore,
  pending,
  goRate,
  goAdd,
  onAdded,
  notify,
  onSignedOut,
}: {
  refreshKey: number;
  /** The store she's currently shopping at (shared with the Add tab). */
  store: string;
  onStore: (store: string) => void;
  pending: number;
  goRate: () => void;
  goAdd: () => void;
  onAdded: () => void;
  notify: (message: string) => void;
  onSignedOut: () => void;
}) {
  const [data, setData] = useCachedState<ShoppingList | null>("shop", null);
  const [error, setError] = useState<string | null>(null);
  // null = "All stores".
  const [filter, setFilter] = useState<string | null>(null);
  const [detail, setDetail] = useState<ListEntry | null>(null);
  const [quick, setQuick] = useState<ListEntry | null>(null);
  // Items added to the basket this session, so the + turns into a tick.
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [showSkipped, setShowSkipped] = useState(false);

  useEffect(() => {
    shoppingList()
      .then(setData)
      .catch((err) => {
        // A dead session shouldn't read as a broken page.
        if (err instanceof NotSignedIn) return onSignedOut();
        setError(err instanceof Error ? err.message : "Couldn't load");
      });
  }, [refreshKey]);

  // Every store she has bought a liked thing at, busiest first.
  const stores = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of data?.liked ?? []) {
      for (const s of entry.stores) counts.set(s.store, (counts.get(s.store) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [data]);

  const allStores = useMemo(() => {
    const names = new Set<string>();
    for (const bucket of [data?.liked, data?.unrated, data?.disliked]) {
      for (const entry of bucket ?? []) for (const s of entry.stores) names.add(s.store);
    }
    // The store she's at now goes first.
    return [...names].sort((a, b) => Number(sameStore(b, store)) - Number(sameStore(a, store)));
  }, [data, store]);

  if (error) {
    return (
      <p className="error">
        <Icon name="close" />
        {error}
      </p>
    );
  }
  if (!data) return <p className="hint loading">Loading…</p>;

  const everything = data.liked.length + data.disliked.length;

  // A filter pointing at a store that no longer has anything (after a delete)
  // falls back to "All" instead of showing an empty screen.
  const activeFilter = filter && stores.some(([name]) => sameStore(name, filter)) ? filter : null;

  const groups = data.liked_grouped
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (entry) => !activeFilter || entry.stores.some((s) => sameStore(s.store, activeFilter))
      ),
    }))
    .filter((group) => group.items.length > 0);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);

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

      {everything === 0 ? (
        <div className="empty">
          <div className="empty-icon">
            <Icon name="cart" size="1.5em" />
          </div>
          <h2>Your list builds itself</h2>
          <p>
            Add what you buy on the Add tab, rate it once you've tried it, and the things you
            liked show up here, with what you paid at each store.
          </p>
          <button type="button" className="primary inline" onClick={goAdd}>
            <Icon name="plus" />
            Add something
          </button>
        </div>
      ) : (
        <>
          {stores.length > 0 && (
            <div className="chip-block">
              <span className="eyebrow">Store</span>
              <div className="chips scroll" role="tablist" aria-label="Filter by store">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!activeFilter}
                  className={!activeFilter ? "chip on" : "chip"}
                  onClick={() => setFilter(null)}
                >
                  All stores
                </button>
                {stores.map(([name, count]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sameStore(name, activeFilter)}
                    key={name}
                    className={sameStore(name, activeFilter) ? "chip on" : "chip"}
                    onClick={() => setFilter(name)}
                  >
                    {name}
                    <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.liked.length === 0 ? (
            <p className="caption center">
              Nothing liked yet. Rate a few things and the good ones land here.
            </p>
          ) : (
            <>
              <p className="caption">
                {activeFilter
                  ? `${shown} you liked at ${activeFilter} \u00b7 tap + to add to your basket`
                  : `${shown} you liked \u00b7 tap + to add to your basket`}
              </p>

              {groups.map((group) => (
                <section key={group.category}>
                  <h3 className="group-heading">
                    <span>{group.label}</span>
                    <span className="group-count">{group.items.length}</span>
                  </h3>
                  <div className="list-card">
                    {group.items.map((entry) => (
                      <ItemRow
                        key={entry.item_id}
                        entry={entry}
                        store={activeFilter}
                        added={added.has(entry.item_id)}
                        onOpen={() => setDetail(entry)}
                        onAdd={() => setQuick(entry)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </>
          )}

          {data.disliked.length > 0 && (
            <section>
              <button
                type="button"
                className="disclosure"
                aria-expanded={showSkipped}
                onClick={() => setShowSkipped((open) => !open)}
              >
                <span>Things you didn't like</span>
                <span className="group-count">{data.disliked.length}</span>
                <span className={showSkipped ? "disclosure-chevron open" : "disclosure-chevron"}>
                  <Icon name="chevronDown" />
                </span>
              </button>
              {showSkipped && (
                <div className="list-card" style={{ marginTop: 8 }}>
                  {data.disliked.map((entry) => (
                    <ItemRow
                      key={entry.item_id}
                      entry={entry}
                      store={null}
                      muted
                      onOpen={() => setDetail(entry)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
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

      {quick && (
        <QuickAddSheet
          entry={quick}
          defaultStore={activeFilter ?? store}
          knownStores={allStores}
          onClose={() => setQuick(null)}
          onSignedOut={onSignedOut}
          onAdded={(boughtAt) => {
            setAdded((current) => new Set(current).add(quick.item_id));
            // The basket follows where she actually is.
            onStore(boughtAt);
            notify(`${quick.name} added to your basket at ${boughtAt}`);
            setQuick(null);
            onAdded();
          }}
        />
      )}
    </div>
  );
}

function ItemRow({
  entry,
  store,
  added,
  muted,
  onOpen,
  onAdd,
}: {
  entry: ListEntry;
  /** The store filter, or null when showing everything. */
  store: string | null;
  added?: boolean;
  muted?: boolean;
  onOpen: () => void;
  onAdd?: () => void;
}) {
  // What it costs *here* when a store is picked, otherwise what she last paid.
  const here = store ? entry.stores.find((s) => sameStore(s.store, store)) : null;
  const price = here ? here.price : entry.last_price;

  // Only worth a flag if it's genuinely cheaper than where she's looking.
  const reference = store ?? entry.last_store;
  const refPrice = entry.stores.find((s) => sameStore(s.store, reference));
  const cheaper =
    entry.best &&
    !sameStore(entry.best.store, reference) &&
    (!refPrice || entry.best.cents < refPrice.cents)
      ? entry.best
      : null;

  const subtitle = store
    ? sameStore(entry.last_store, store)
      ? `Last bought ${entry.when}`
      : `Last bought at ${entry.last_store}`
    : (entry.last_store ?? "");

  return (
    <article
      className={`row tappable${muted ? " muted-row" : ""}${added ? " is-added" : ""}`}
      onClick={onOpen}
      role="button"
    >
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
      </div>
      {price && <span className="price">{price}</span>}
      {onAdd && (
        <button
          type="button"
          className={added ? "add-btn done" : "add-btn"}
          aria-label={added ? `${entry.name} is in your basket` : `Add ${entry.name} to your basket`}
          // The row opens the detail sheet; this must not bubble up to it.
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Icon name={added ? "check" : "plus"} />
        </button>
      )}
      {cheaper && (
        <div className="cheaper-line">
          <span className="cheaper">
            <Icon name="tag" size="0.95em" />
            <span>
              Cheaper at {cheaper.store} {"\u00b7"} {cheaper.price}
            </span>
          </span>
        </div>
      )}
    </article>
  );
}
