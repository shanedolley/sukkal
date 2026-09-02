// The space filter and the crossing rule, held apart from the React context.
//
// A check runs under node, which strips types but renders no JSX, so it cannot
// import lib/space-context.tsx. Both rules therefore live here, and the context
// re-exports them. Every caller keeps its one import path.

import type { Space } from "./types";

/** "all" means no filter. The brief flags a crossing rather than blocking it. */
export type SpaceFilter = Space | "all";

/**
 * The spaces a filter reads, for a query that narrows in SQL.
 *
 * `shared` comes with every one of them. It is the space either side may
 * cite, so narrowing to Collibra hides Koinon and keeps what belongs to both.
 * ADR-0018 decides this, and it is why this is a list rather than an
 * equality: `"all"` has no value in the enum to compare against.
 */
export function spacesFor(filter: SpaceFilter): Space[] {
  return filter === "all"
    ? ["collibra", "koinon", "personal", "shared"]
    : [filter, "shared"];
}

/** Narrow any row that carries a space. */
export function inSpace<T extends { space: Space }>(
  rows: T[],
  filter: SpaceFilter
): T[] {
  return filter === "all" ? rows : rows.filter((row) => row.space === filter);
}

/**
 * Whether an answer drew on more than one space.
 *
 * The brief flags a crossing and never blocks it, so this decides a badge and
 * nothing else. It counts distinct spaces rather than entries, because an
 * answer that cites Collibra twice draws on one space.
 */
export function crosses(spaces: Space[]): boolean {
  return new Set(spaces).size > 1;
}
