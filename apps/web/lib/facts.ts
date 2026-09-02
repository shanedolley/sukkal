// Reading the review queue from the database.
//
// The queue is what makes the memory trustworthy. The third policy rule says
// an agent never marks its own fact verified, so every proposed fact waits
// here, and a fact this read drops is a fact nobody ever confirms.
//
// The state is not a column. ADR-0010 stores three of the six and derives the
// other three from `verified`, `stale_after` and `valid_to`, and
// `src/memory/state.ts` holds that derivation. This file calls it rather than
// repeating it, so the interface cannot form a seventh opinion.
//
// `today` is an argument, all the way down. A fact goes stale because a date
// passed, so the same row reads differently tomorrow. The query never calls
// `now()` and neither does the mapper, which is what lets a check hold the day
// still.
//
// The space filter runs in SQL, the same as every other read here. A filter
// applied in the browser has already sent the rows across the wire.
//
// The caller hands in the pool, the same way every function in the root
// package takes the client it queries with. That also leaves this file with no
// import that survives type erasure except the derivation itself, so
// scripts/check-facts.ts runs both under plain node.

import type { Pool } from "pg";

import { factState } from "../../../src/memory/state.ts";
import { spacesFor, type SpaceFilter } from "./space.ts";
import type { Fact, Space } from "./types";

/**
 * What a fact with no entity is called.
 *
 * `facts.entity` is nullable and nothing resolves it yet: ADR-0014 settled
 * that, and migration 010 wrote the column that way. So a heading has to say
 * so in words. Every screen that groups or filters by entity uses this one,
 * because three screens inventing three phrasings is how "undefined" ends up
 * on one of them.
 */
export const NO_ENTITY = "No entity yet";

/**
 * Count rows per engagement, heaviest first.
 *
 * The briefing's queue cards are the reason. A count of four says there is
 * work; "BHP Meridian 2, Maybank 1, Sydney Water 1" says where the morning is
 * going to go.
 *
 * A row naming no engagement counts under `NO_ENTITY` and is named like any
 * other. It still sorts by count, so the group takes whatever position its
 * size earns rather than being pushed to the end.
 *
 * It lives here rather than in the card so a check can run it under plain
 * node, which renders no JSX. `components/dashboard/queue-card.tsx` re-exports
 * it, so every caller keeps its one import path.
 */
export function byEntity<T extends { entity: string | null }>(rows: T[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const entity = row.entity ?? NO_ENTITY;
    counts.set(entity, (counts.get(entity) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([entity, count]) => ({ entity, count }))
    .sort((a, b) => b.count - a.count || a.entity.localeCompare(b.entity));
}

/** One row of the read below, named as `facts` carries the columns. Every
 *  `date` arrives as `YYYY-MM-DD` text, never as a `Date`. */
export interface FactRow {
  id: string;
  /** `facts.description`, the note's one-line claim. `title` names the note. */
  description: string;
  /** The three states the database stores. The other three come from dates. */
  state: "candidate" | "proposed" | "rejected";
  space: Space;
  entity: string | null;
  valid_from: string;
  valid_to: string | null;
  stale_after: string | null;
  verified: string | null;
  /** `human:<id>` or `agent:<model>`. Null on a fact nothing recorded. */
  generated_by: string | null;
  /** The source a `derived_from` edge points at, and the passage inside it. */
  source_id: string | null;
  chunk_id: string | null;
}

/**
 * A row as the queue renders it, as of `today`.
 *
 * `state` is the one field with no column behind it. `factState` reads the
 * three dates and the stored state together, and retirement settles the
 * question before staleness does, so a retired fact never reads as stale.
 */
export function toFact(row: FactRow, today: string): Fact {
  return {
    id: row.id,
    statement: row.description,
    state: factState(row, today),
    space: row.space,
    entity: row.entity,
    validFrom: row.valid_from,
    validTo: row.valid_to,
    staleAfter: row.stale_after,
    // Who wrote it, read from the prefix the column carries rather than from a
    // boolean beside it. `facts_machine_never_verifies` guards the same prefix
    // on `verified_by`, so the vocabulary is already load bearing.
    generatedByAgent: row.generated_by?.startsWith("agent:") ?? false,
    // A fact with no derived_from edge names no source. Nothing writes one
    // today -- `src/memory/gates.ts` inserts the fact alone -- so this is the
    // normal case rather than a fault, and the card renders without the link
    // instead of pointing at nothing.
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
 * Every fact in the chosen spaces, newest first.
 *
 * All six states come back, and each reader narrows to the one it shows. The
 * briefing, the two queue pages and the two sidebar counts read this one
 * answer, so their numbers cannot disagree.
 *
 * The lateral join takes one `derived_from` edge rather than joining plainly.
 * `edges_unique` is (from_id, to_id, kind), so nothing stops a fact deriving
 * from two sources, and a plain join would then show that fact twice.
 *
 * A rejection's reason is not read here. `rejections.subject_id` names the
 * node a rejection concerned, and which node a rejected fact records itself
 * against is KPA-122's decision, since KPA-122 is what writes it. Guessing
 * the join before the write exists is how a reason ends up read from the
 * wrong row.
 */
export async function readFacts(
  pool: Pool,
  filter: SpaceFilter,
  today: string,
): Promise<Fact[]> {
  const result = await pool.query<FactRow>(
    `SELECT f.id,
            f.description,
            f.state,
            f.space,
            f.entity,
            f.valid_from,
            f.valid_to,
            f.stale_after,
            f.verified,
            f.generated_by,
            e.to_id    AS source_id,
            e.chunk_id
       FROM facts f
       LEFT JOIN LATERAL (
            SELECT to_id, chunk_id
              FROM edges
             WHERE from_id = f.id AND kind = 'derived_from'
             ORDER BY id
             LIMIT 1
       ) e ON true
      WHERE f.space = ANY($1::space[])
      ORDER BY f.valid_from DESC, f.id DESC`,
    [spacesFor(filter)],
  );

  return result.rows.map((row) => toFact(row, today));
}
