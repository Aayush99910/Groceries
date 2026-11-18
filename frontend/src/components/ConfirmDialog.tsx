import { useEffect, useRef } from "react";

export type DialogAction = {
  label: string;
  /** "primary" is bold, "destructive" is red, "default" is plain. */
  tone?: "default" | "primary" | "destructive";
  onPress: () => void;
};

/**
 * A pop-up question, laid out like an iOS alert: a rounded card in the middle of
 * the screen over a dimmed backdrop, a short title and message, and buttons split
 * by hairlines along the bottom.
 *
 * It replaces swapping a row's buttons in place, which was easy to miss and gave
 * no room to say what the action actually does.
 *
 * Like a real iOS alert, tapping the dimmed area does NOT dismiss it: you have to
 * choose. (Escape still cancels, for keyboards.)
 */
export default function ConfirmDialog({
  title,
  message,
  actions,
  onCancel,
}: {
  title: string;
  message?: string;
  /** Left to right; two sit side by side, more stack. Include the Cancel button. */
  actions: DialogAction[];
  onCancel: () => void;
}) {
  const firstButton = useRef<HTMLButtonElement>(null);

  // Escape cancels, the page behind can't scroll, and focus goes into the dialog
  // (and back to where it was when it closes).
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    firstButton.current?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="dialog-overlay" role="presentation">
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="dialog-body">
          <h2 className="dialog-title">{title}</h2>
          {message && <p className="dialog-message">{message}</p>}
        </div>
        <div className={actions.length > 2 ? "dialog-actions stacked" : "dialog-actions"}>
          {actions.map((action, i) => (
            <button
              key={action.label}
              ref={i === 0 ? firstButton : undefined}
              type="button"
              className={`dialog-btn tone-${action.tone ?? "default"}`}
              onClick={action.onPress}
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
