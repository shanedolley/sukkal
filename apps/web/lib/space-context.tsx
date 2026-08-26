"use client";

// The space filter the brief calls for under "The policy". Retrieval filters
// by space by default. Here it narrows every region on every page.

import { createContext, useContext, useMemo, useState } from "react";

import type { Space } from "./types";

/** "all" means no filter. The brief flags a crossing rather than blocking it. */
export type SpaceFilter = Space | "all";

interface SpaceContextValue {
  space: SpaceFilter;
  setSpace: (space: SpaceFilter) => void;
}

const SpaceContext = createContext<SpaceContextValue | null>(null);

export function SpaceProvider({ children }: { children: React.ReactNode }) {
  const [space, setSpace] = useState<SpaceFilter>("all");
  const value = useMemo(() => ({ space, setSpace }), [space]);
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
