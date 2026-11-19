import { useCallback, useEffect, useRef, useState } from "react";

import Icon from "./Icon";
import {
  Coords,
  NotSignedIn,
  Place,
  StorePlace,
  distanceLabel,
  nearbyStores,
  sameStore,
  searchStores,
} from "../api";

type Props = {
  /** The store she's at now, if any, so it can be marked. */
  current: string;
  /** Stores she has used before, most recent first. */
  recent: string[];
  onPick: (chosen: StorePlace) => void;
  onClose: () => void;
  onSignedOut: () => void;
};

/** Her phone's location, as a promise with errors worth showing to a person. */
function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This phone can't share its location. Search for the store by name instead."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location is turned off for this app. You can turn it on in Settings, or search by name."
              : "Couldn't work out where you are. Try again, or search by name."
          )
        ),
      // A rough fix is plenty: we only need the right neighbourhood, and a rough
      // fix is quicker and uses less battery.
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  });
}

/**
 * "Which store are you at?", as a pop-up over whatever she was doing.
 *
 * Two ways in, both optional:
 *   - Use my location: lists the stores around her, nearest first, with distance.
 *   - Search by name: finds a shop (nearest first once the location is known).
 *
 * Several branches of one chain are told apart by their street, so "Trader Joe's
 * · 39324 Argonaut Way" and "Trader Joe's · 855 El Camino Real" are different
 * stores, with their own prices. A store she types by hand is used exactly as typed.
 *
 * Her location is used only to run the search. It's never saved.
 */
export default function StoreSheet({ current, recent, onPick, onClose, onSignedOut }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [coords, setCoords] = useState<Coords | null>(null);
  const [nearby, setNearby] = useState<Place[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Only the newest search may update the list; a slow old one must not overwrite it.
  const searchId = useRef(0);

  const locate = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const here = await getPosition();
      setCoords(here);
      const found = await nearbyStores(here);
      setNearby(found.places);
    } catch (err) {
      if (err instanceof NotSignedIn) return onSignedOut();
      setLocationError(err instanceof Error ? err.message : "Couldn't find stores near you");
    } finally {
      setLocating(false);
    }
  }, [onSignedOut]);

  // Escape closes, and the page behind can't scroll while this is open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  // If she has already allowed location for this app, don't make her tap for it again.
  useEffect(() => {
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((status) => {
        if (!cancelled && status.state === "granted") locate();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [locate]);

  // Search as she types, after a pause. Nominatim (the free service behind this)
  // asks not to be hit on every keystroke, and the server enforces its own limit too.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      searchId.current += 1;
      setResults(null);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const id = ++searchId.current;
    const timer = setTimeout(() => {
      searchStores(text, coords)
        .then((r) => {
          if (id !== searchId.current) return;
          setResults(r.places);
          setSearching(false);
        })
        .catch((err) => {
          if (id !== searchId.current) return;
          if (err instanceof NotSignedIn) return onSignedOut();
          setResults([]);
          setSearching(false);
          setSearchError(
            err instanceof Error ? err.message : "Couldn't search right now. You can still type the name."
          );
        });
    }, 550);
    return () => clearTimeout(timer);
  }, [query, coords, onSignedOut]);

  const typed = query.trim();

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <div
        className="sheet store-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a store"
      >
        <div className="sheet-grab" aria-hidden />

        <div className="store-sheet-head">
          <h2>Where are you shopping?</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="search-box">
          <Icon name="search" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a store"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="words"
            enterKeyHint="search"
            aria-label="Search for a store"
          />
        </div>

        <div className="store-sheet-body">
          {typed.length >= 2 ? (
            <>
              {searching && (
                <p className="sheet-status">
                  <span className="spinner" aria-hidden /> Searching…
                </p>
              )}
              {!searching && results && results.length > 0 && (
                <PlaceList places={results} current={current} onPick={onPick} />
              )}
              {!searching && results && results.length === 0 && !searchError && (
                <p className="sheet-note">
                  Nothing found for “{typed}”.
                  {!coords && " Turning on your location can help find nearby stores."}
                </p>
              )}
              {searchError && <p className="error">{searchError}</p>}

              {/* Always available, so a store the map doesn't know is never a dead end. */}
              <button type="button" className="place-row manual" onClick={() => onPick({ name: typed })}>
                <span className="place-icon plain">
                  <Icon name="plus" />
                </span>
                <span className="row-body">
                  <strong>Use “{typed}”</strong>
                  <span className="row-sub">Exactly as typed</span>
                </span>
              </button>
            </>
          ) : (
            <>
              {nearby ? (
                <section>
                  <h3 className="group-heading">
                    <span>Near you</span>
                    <button type="button" className="text-link" onClick={locate} disabled={locating}>
                      {locating ? "Updating…" : "Refresh"}
                    </button>
                  </h3>
                  {nearby.length > 0 ? (
                    <PlaceList places={nearby} current={current} onPick={onPick} />
                  ) : (
                    <p className="sheet-note">No grocery stores found nearby. Try searching by name.</p>
                  )}
                </section>
              ) : (
                <>
                  <button type="button" className="locate-btn" onClick={locate} disabled={locating}>
                    <span className="place-icon">
                      {locating ? <span className="spinner" aria-hidden /> : <Icon name="mapPin" />}
                    </span>
                    <span className="row-body">
                      <strong>{locating ? "Finding stores near you…" : "Use my location"}</strong>
                      <span className="row-sub">Shows stores around you. It's only used to search; it isn't saved.</span>
                    </span>
                  </button>
                  {locationError && <p className="error">{locationError}</p>}
                </>
              )}

              {recent.length > 0 && (
                <section>
                  <h3 className="group-heading">
                    <span>Recent</span>
                  </h3>
                  <div className="chips wrap">
                    {recent.slice(0, 8).map((name) => (
                      <button
                        type="button"
                        key={name}
                        className={sameStore(name, current) ? "chip on" : "chip"}
                        onClick={() => onPick({ name })}
                      >
                        <Icon name="store" size="1em" />
                        {name}
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PlaceList({
  places,
  current,
  onPick,
}: {
  places: Place[];
  current: string;
  onPick: (chosen: StorePlace) => void;
}) {
  return (
    <div className="list-card">
      {places.map((place) => {
        const selected = sameStore(place.label, current);
        const distance = distanceLabel(place.distance_m);
        return (
          <button
            type="button"
            key={`${place.id}-${place.label}`}
            className="place-row"
            onClick={() => onPick({ name: place.label, place_id: place.id, lat: place.lat, lon: place.lon })}
          >
            <span className={selected ? "place-icon on" : "place-icon"}>
              <Icon name={selected ? "check" : "store"} />
            </span>
            <span className="row-body">
              <strong>{place.name}</strong>
              <span className="row-sub">{place.address}</span>
            </span>
            {distance && <span className="place-distance">{distance}</span>}
          </button>
        );
      })}
    </div>
  );
}
