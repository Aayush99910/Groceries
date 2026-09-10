import { useEffect, useState } from "react";

import Icon from "./Icon";

/**
 * Delete, with the confirm step inline in the row.
 *
 * Deliberately not `window.confirm`: the native dialog is jarring on iOS and
 * covers the row you're trying to identify. Tapping the bin turns the row's
 * buttons into Cancel / Delete, so the thing being deleted stays visible. Falls
 * back to un-confirmed after a few seconds so a stray tap doesn't leave the row
 * stuck in a scary state.
 */
export default function DeleteButton({
  onDelete,
  label,
}: {
  onDelete: () => void;
  label: string;
}) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 8000);
    return () => clearTimeout(timer);
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        type="button"
        className="icon-btn"
        aria-label={`Delete ${label}`}
        onClick={(e) => {
          // Rows are tappable too -- don't also toggle the row.
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        <Icon name="trash" />
      </button>
    );
  }

  return (
    <div className="confirm" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </button>
      <button type="button" className="danger" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
