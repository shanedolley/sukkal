"use client";

// The space filter the brief calls for under "The policy". Retrieval filters
// by space by default. Here it narrows every region on every page.
//
// The choice is kept in localStorage so a reload holds it. See
// lib/local-store.ts for why it is not read in an effect.

import { createContext, useContext, useMemo } from "react";

import { createLocalStore } from "./local-store";
import type { SpaceFilter } from "./space";
import { spaceOf } from "./workspaces";

// inSpace and crosses live in lib/space.ts so a check can import them without
// JSX. They are re-exported here, so no caller has to know that.
export { crosses, inSpace, type SpaceFilter } from "./space";

const VALID: string[] = ["all", "collibra", "koinon", "personal"];

const store = createLocalStore<SpaceFilter>("kpa.space", "all", (value) =>
  VALID.includes(value)
);

interface SpaceContextValue {
  space: SpaceFilter;
  setSpace: (space: SpaceFilter) => void;
}

const SpaceContext = createContext<SpaceContextValue | null>(null);

export function SpaceProvider({ children }: { children: React.ReactNode }) {
  const space = store.useValue();
  const value = useMemo(() => ({ space, setSpace: store.set }), [space]);
  return <SpaceContext value={value}>{children}</SpaceContext>;
}

export function useSpace(): SpaceContextValue {
  const value = useContext(SpaceContext);
  if (!value) {
    throw new Error("useSpace must be used inside SpaceProvider");
  }
  return value;
}

/**
 * Narrow issues, which carry a workspace rather than a space.
 *
 * The space is the workspace's, so an issue never holds one of its own and
 * the two can never disagree.
 */
export function issuesInSpace<T extends { workspace: string }>(
  issues: T[],
  filter: SpaceFilter
): T[] {
  return filter === "all"
    ? issues
    : issues.filter((issue) => spaceOf(issue.workspace) === filter);
}
