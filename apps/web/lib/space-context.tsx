"use client";

// The space filter the brief calls for under "The policy". Retrieval filters
// by space by default. Here it narrows every region on every page.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from "react";

import type { Space } from "./types";

/** "all" means no filter. The brief flags a crossing rather than blocking it. */
export type SpaceFilter = Space | "all";

const STORAGE_KEY = "kpa.space";
const VALID: SpaceFilter[] = ["all", "collibra", "koinon", "personal"];

// The choice lives in localStorage so a reload keeps it. Reading it through
// useSyncExternalStore rather than an effect is what keeps the server render
// and the first client render identical: the server snapshot is always "all".
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function getSnapshot(): SpaceFilter {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY) as SpaceFilter | null;
    return saved && VALID.includes(saved) ? saved : "all";
  } catch {
    // A private window, or a browser set to block site data.
    return "all";
  }
}

function getServerSnapshot(): SpaceFilter {
  return "all";
}

function write(next: SpaceFilter) {
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Losing the preference costs nothing. The filter still works this session.
  }
  listeners.forEach((listener) => listener());
}

interface SpaceContextValue {
  space: SpaceFilter;
  setSpace: (space: SpaceFilter) => void;
}

const SpaceContext = createContext<SpaceContextValue | null>(null);

export function SpaceProvider({ children }: { children: React.ReactNode }) {
  const space = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setSpace = useCallback((next: SpaceFilter) => write(next), []);
  const value = useMemo(() => ({ space, setSpace }), [space, setSpace]);
  return <SpaceContext value={value}>{children}</SpaceContext>;
}

export function useSpace(): SpaceContextValue {
  const value = useContext(SpaceContext);
  if (!value) {
    throw new Error("useSpace must be used inside SpaceProvider");
  }
  return value;
}

/** Narrow any row that carries a space. */
export function inSpace<T extends { space: Space }>(
  rows: T[],
  filter: SpaceFilter
): T[] {
  return filter === "all" ? rows : rows.filter((row) => row.space === filter);
}
