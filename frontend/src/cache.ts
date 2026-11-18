import { useState } from "react";

/**
 * What each screen last showed, kept while the app is open.
 *
 * Switching tabs unmounts a screen and mounts the next one, so its state starts
 * empty and it renders "Loading…" — even for data it fetched ten seconds ago.
 * That blank flash on every tap is what made moving around the app feel heavy.
 *
 * So the first render reuses whatever that screen last showed and the fetch
 * happens behind it: the tab is there immediately, and updates in place a moment
 * later if anything changed. Stale-while-revalidate, in about twenty lines.
 *
 * Deliberately a plain module-level Map rather than a cache library or context:
 * it lives for the life of the page, it is never invalidated by hand (every
 * screen refetches on mount anyway), and a reload starts clean.
 */
const store = new Map<string, unknown>();

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function cacheSet<T>(key: string, value: T): void {
  store.set(key, value);
}

/**
 * Like useState, but seeded from the last value this key held and writing every
 * update back, so the next mount starts where this one left off.
 *
 * Returns the same pair as useState, so a screen only changes its declaration:
 *
 *   const [data, setData] = useState<Shape | null>(null);
 *   const [data, setData] = useCachedState<Shape | null>("shop", null);
 */
export function useCachedState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    const cached = cacheGet<T>(key);
    return cached === undefined ? initial : cached;
  });

  const set = (next: T | ((current: T) => T)) => {
    setValue((current) => {
      const resolved =
        typeof next === "function" ? (next as (c: T) => T)(current) : next;
      cacheSet(key, resolved);
      return resolved;
    });
  };

  return [value, set] as const;
}
