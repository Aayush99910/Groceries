import { useEffect } from "react";

import Icon from "./Icon";
import { StorePrice, photoUrl } from "../api";

type Props = {
  name: string;
  photo: string | null;
  category?: string | null;
  price?: string | null;
  store?: string | null;
  when?: string | null;
  /** Every store this has been bought at, cheapest first. */
  stores?: StorePrice[];
  likes?: number;
  dislikes?: number;
  timesBought?: number;
  onClose: () => void;
};

/**
 * Tap an item, see it properly.
 *
 * The rows are deliberately dense so a whole shop fits on one screen, which
 * leaves the photo too small to recognise anything. This is the other half of
 * that trade: one tap for the full picture and every price paid, no pinching.
 */
export default function ItemSheet({
  name,
  photo,
  category,
  price,
  store,
  when,
  stores,
  likes = 0,
  dislikes = 0,
  timesBought,
  onClose,
}: Props) {
  // Escape closes, and the page behind must not scroll while this is open.
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

  const src = photoUrl(photo);
  const cheapest = stores && stores.length > 0 ? stores[0] : null;

  return (
    <div className="sheet-overlay" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={name}
        // Taps inside must not reach the overlay's close handler.
        onClick={(e) => e.stopPropagation()}
      >
        <button className="sheet-close" onClick={onClose} aria-label="Close">
          <Icon name="close" />
        </button>

        {src ? (
          <img className="sheet-photo" src={src} alt={name} />
        ) : (
          <div className="sheet-photo sheet-photo-empty">
            <Icon name="cart" size="2.5em" />
          </div>
        )}

        <div className="sheet-body">
          <h2>{name}</h2>
          {category && <p className="sheet-category">{category}</p>}

          {(price || store) && (
            <div className="sheet-headline">
              {price && <span className="sheet-price">{price}</span>}
              {store && (
                <span className="sheet-store">
                  <Icon name="store" size="0.95em" />
                  {store}
                </span>
              )}
            </div>
          )}

          {when && <p className="sheet-when">Last bought {when}</p>}

          {/* Every price paid, so the comparison is visible without arithmetic. */}
          {stores && stores.length > 0 && (
            <div className="sheet-section">
              <h3 className="section-heading">
                <Icon name="tag" size="1em" />
                What you've paid
              </h3>
              <ul className="sheet-stores">
                {stores.map((s) => (
                  <li key={s.store} className={s === cheapest && stores.length > 1 ? "best" : ""}>
                    <span>{s.store}</span>
                    <strong>{s.price}</strong>
                  </li>
                ))}
              </ul>
              {stores.length > 1 && cheapest && (
                <p className="sheet-when">Cheapest at {cheapest.store}.</p>
              )}
            </div>
          )}

          {(likes > 0 || dislikes > 0 || timesBought) && (
            <div className="sheet-tally">
              {typeof timesBought === "number" && (
                <span>
                  Bought {timesBought} time{timesBought === 1 ? "" : "s"}
                </span>
              )}
              {likes > 0 && (
                <span className="up">
                  <Icon name="thumbUp" size="0.95em" />
                  {likes}
                </span>
              )}
              {dislikes > 0 && (
                <span className="down">
                  <Icon name="thumbDown" size="0.95em" />
                  {dislikes}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
