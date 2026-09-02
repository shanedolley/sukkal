// Reading "Needs you" from the database.
//
// The thin slice of KPA-52. It reads one table and writes nothing, and it
// settles three things once so no later screen has to invent its own answer:
// how the web tier reaches Postgres, how a row becomes what a screen renders,
// and where the space filter runs.
//
// The space filter runs here, in SQL. A filter applied in the browser has
// already sent every row across the wire, so the wall the brief calls a
// guideline would be drawn after the material had left the database.
//
// The caller hands in the pool, the same way every function in the root
// package takes the client it queries with. That also leaves this file with
// no import that survives type erasure, so scripts/check-needs-you.ts runs it
// under plain node.

import type { Pool } from "pg";

import type { NeedsYouItem, NeedsYouKind, Space } from "./types";
import type { SpaceFilter } from "./space";

/** One row of the read below, before it becomes what a screen renders. */
export interface NeedsYouRow {
  id: string;
  kind: NeedsYouKind;
  title: string;
  detail: string;
  space: Space;
  entity: string | null;
  raised_at: Date;
  gmail_url: string | null;
  source_id: string | null;
  chunk_id: string | null;
  audit_id: string | null;
  rule: string | null;
}

/**
 * The spaces a filter reads.
 *
 * `shared` comes with every one of them. It is the space either side may
 * cite, so narrowing to Collibra hides Koinon and keeps what belongs to
 * both. ADR-0018 decides this, and it is why the filter is a list rather
 * than an equality: `'all'` has no value in the enum to compare against.
 */
export function spacesFor(filter: SpaceFilter): Space[] {
  return filter === "all"
    ? ["collibra", "koinon", "personal", "shared"]
    : [filter, "shared"];
}

/**
 * A row as the interface declares it.
 *
 * Every field maps from a column. The one that does not is `rule`, which
 * comes from the audit entry the row names rather than from a second copy of
 * the rule's key beside it. `audit` already holds which policy fired, and two
 * copies of one answer eventually disagree.
 */
export function toItem(row: NeedsYouRow): NeedsYouItem {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    detail: row.detail,
    space: row.space,
    entity: row.entity,
    raisedAt: row.raised_at.toISOString(),
    ...(row.gmail_url ? { gmailUrl: row.gmail_url } : {}),
    ...(row.rule ? { rule: row.rule } : {}),
    ...(row.audit_id ? { auditId: row.audit_id } : {}),
    // A row names a source, a chunk inside it, or neither. The chunk is
    // optional because the column is: a row raised before its source was
    // broken up names no passage, and the drawer opens that source at the top
    // and says so. KPA-119 settled that, and it replaced this story's first
    // answer, which dropped the source along with the missing chunk.
    ...(row.source_id
      ? {
          provenance: {
            sourceId: row.source_id,
            ...(row.chunk_id ? { chunkId: row.chunk_id } : {}),
          },
        }
      : {}),
  };
}

/**
 * The open items, newest first.
 *
 * `closed_at IS NULL` ordered by `raised_at DESC` is the shape of
 * `needs_you_open`, the partial index migration 006 created, so the closed
 * rows are the ones this read never has to walk. A row closes rather than
 * disappears, which is why the predicate is a date and not a delete.
 *
 * The space list is a filter on top of that index, so the planner sorts the
 * rows it finds rather than reading them in order. Checked with
 * `SET enable_seqscan = off`, which is the only way to see the plan a grown
 * table would take from a table holding five rows.
 */
export async function openItems(
  pool: Pool,
  filter: SpaceFilter,
): Promise<NeedsYouItem[]> {
  const result = await pool.query<NeedsYouRow>(
    `SELECT n.id,
            n.kind,
            n.title,
            n.detail,
            n.space,
            n.entity,
            n.raised_at,
            n.gmail_url,
            n.source_id,
            n.chunk_id,
            n.audit_id,
            a.rule
       FROM needs_you n
       LEFT JOIN audit a ON a.id = n.audit_id
      WHERE n.closed_at IS NULL
        AND n.space = ANY($1::space[])
      ORDER BY n.raised_at DESC`,
    [spacesFor(filter)],
  );

  return result.rows.map(toItem);
}
