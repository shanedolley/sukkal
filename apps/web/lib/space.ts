// The space filter and the crossing rule, held apart from the React context.
//
// A check runs under node, which strips types but renders no JSX, so it cannot
// import lib/space-context.tsx. Both rules therefore live here, and the context
// re-exports them. Every caller keeps its one import path.

import type { Space } from "./types";

/** "all" means no filter. The brief flags a crossing rather than blocking it. */
export type SpaceFilter = Space | "all";

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
