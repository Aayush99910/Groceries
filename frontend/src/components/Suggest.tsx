import { useEffect, useRef, useState } from "react";

import { SuggestOption } from "../api";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  fetchSuggestions: (q: string) => Promise<SuggestOption[]>;
  placeholder?: string;
};

/**
 * A text field that offers what she has already typed before.
 *
 * This is the app's defence against duplicate items. Tapping "Strawberries" off
 * the list is less work than typing it, so history piles up on one item instead
 * of scattering across "strawberry", "Strawberries" and "strawberrys". Names she
 * has bought before are marked with a dot and sit above generic suggestions.
 */
export default function Suggest({
  label,
  value,
  onChange,
  fetchSuggestions,
  placeholder,
}: Props) {
  const [options, setOptions] = useState<SuggestOption[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Small debounce: she types faster than the network round-trips.
    const timer = setTimeout(() => {
      fetchSuggestions(value)
        .then((list) => {
          if (!cancelled) setOptions(list);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, fetchSuggestions]);

  useEffect(() => {
    function onDocClick(event: MouseEvent | TouchEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
    };
  }, []);

  // Don't offer an option that is already exactly what's in the box.
  const visible = options.filter((o) => o.name.toLowerCase() !== value.trim().toLowerCase());

  return (
    <div className="field" ref={boxRef}>
      <label>{label}</label>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="words"
        enterKeyHint="done"
      />
      {open && visible.length > 0 && (
        <div className="suggest-list">
          {visible.map((option) => (
            <button
              key={option.name}
              type="button"
              className={option.known ? "suggest-item known" : "suggest-item"}
              onClick={() => {
                onChange(option.name);
                setOpen(false);
              }}
            >
              <span className="dot" />
              {option.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
