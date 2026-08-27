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
// Two callers already: the space filter and the appearance presets.

import { useSyncExternalStore } from "react";

export interface LocalStore<T extends string> {
  useValue: () => T;
  set: (value: T) => void;
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

  function getSnapshot(): T {
    try {
      const saved = window.localStorage.getItem(key);
      return saved && isValid(saved) ? (saved as T) : fallback;
    } catch {
      // A private window, or a browser set to block site data.
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
    useValue: () => useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot),
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
