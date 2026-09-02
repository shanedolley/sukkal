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

/**
 * Narrow any row that carries a space.
 *
 * It reads `spacesFor`, so the browser keeps exactly what the same filter
 * keeps in SQL. Written as its own comparison it dropped every `shared` row,
 * and a fact in `shared` was then visible under no filter at all. ADR-0018.
 *
 * Only a caller over fixtures needs this. A caller over rows a query already
 * narrowed must not call it. The second narrow buys nothing, and it is where
 * this bug hid on every migrated screen until 2 September 2026.
 */
export function inSpace<T extends { space: Space }>(
  rows: T[],
  filter: SpaceFilter
): T[] {
  if (filter === "all") return rows;
  const kept = spacesFor(filter);
  return rows.filter((row) => kept.includes(row.space));
}

/**
 * The spaces an answer crossed, each named once.
 *
 * `shared` is dropped. It is the space the wall does not divide, so citing it
 * crosses nothing. The flag reads this list rather than `spaces`, so it never
 * names a space that did not cross. ADR-0018.
 */
export function crossed(spaces: Space[]): Space[] {
  return [...new Set(spaces)].filter((space) => space !== "shared");
}

/**
 * Whether an answer drew on more than one space.
 *
 * The brief flags a crossing and never blocks it, so this decides a badge and
 * nothing else. It counts distinct spaces rather than entries, because an
 * answer that cites Collibra twice draws on one space.
 *
 * The brief also makes this flag the only guard the Collibra and Koinon wall
 * has. A flag on an answer that crossed nothing costs the one signal that
 * matters, which is why `shared` never raises it.
 */
export function crosses(spaces: Space[]): boolean {
  return crossed(spaces).length > 1;
}
