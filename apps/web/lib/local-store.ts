"use client";

// A value kept in localStorage and read the way React wants it read.
//
// Reading storage in an effect and calling setState is the obvious approach
// and the wrong one: it renders once with the default, then again with the
// saved value, which is a cascading render the linter rightly refuses.
// useSyncExternalStore reads it during render instead, and its separate
// server snapshot is what keeps the server and the first client render in
// agreement rather than producing a hydration mismatch.
//
// Four callers already: the space filter, the appearance presets, and the two
// grouping fields on the sprint list.
//
// EVERY KEY HERE CARRIES ITS VALUE ACROSS THE KPA-155 RENAME. The keys read
// `sukkal.` now and a browser that was used before the rename holds the `kpa.`
// name instead, so `readCarried` below moves the value forward on the first
// read of each key. One rule covers every caller, because every key renamed
// the same way.

import { useSyncExternalStore } from "react";

export interface LocalStore<T extends string> {
  useValue: () => T;
  /** The value now, outside a render. The store is the one place that reads. */
  read: () => T;
  set: (value: T) => void;
}

/** Enough of `localStorage` to carry a value forward, so a check can stand in. */
export interface KeyStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** The name a key carried before KPA-155 renamed the machine off KPA. */
export function formerKey(key: string): string {
  return key.startsWith("sukkal.") ? `kpa.${key.slice("sukkal.".length)}` : key;
}

/**
 * Read a key, carrying forward whatever its former name still holds.
 *
 * THE OLD KEY IS REMOVED AS THE VALUE MOVES, so this runs once per key per
 * browser. Leaving it would let a stale `kpa.` value overwrite a newer
 * `sukkal.` one on some later read, which is the one way a migration like this
 * loses work rather than saving it.
 *
 * It writes during a render, because the store reads during a render and the
 * alternative is to show the fallback first and correct it in an effect, which
 * is the cascading render the comment above rejects. The write is idempotent:
 * the second call finds the new key and moves nothing.
 */
export function readCarried(storage: KeyStore, key: string): string | null {
  const saved = storage.getItem(key);
  if (saved !== null) return saved;

  const former = formerKey(key);
  if (former === key) return null;

  const carried = storage.getItem(former);
  if (carried === null) return null;

  storage.setItem(key, carried);
  storage.removeItem(former);
  return carried;
}

export function createLocalStore<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => boolean
): LocalStore<T> {
  const listeners = new Set<() => void>();

  function subscribe(listener: () => void) {
    listeners.add(listener);
    // The storage event fires for other tabs, so a change there follows here.
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  }

  function read(): T {
    try {
      const saved = readCarried(window.localStorage, key);
      return saved && isValid(saved) ? (saved as T) : fallback;
    } catch {
      // A private window, a browser set to block site data, or the server,
      // where there is no `window` at all.
      return fallback;
    }
  }

  const getServerSnapshot = (): T => fallback;

  function set(value: T) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Losing the preference costs nothing. It still holds this session.
    }
    listeners.forEach((listener) => listener());
  }

  return {
    useValue: () => useSyncExternalStore(subscribe, read, getServerSnapshot),
    read,
    set,
  };
}

// Never true on the server, always true after hydration.
//
// A selected state read from localStorage cannot be rendered into
// prerendered HTML: the server does not know it, so the markup says one thing
// and the browser says another. Gating on this renders nothing selected until
// the client is in charge, which is honest rather than wrong.
const noopSubscribe = () => () => {};

export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
