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
import { ReviewError, type ReviewMove } from "./review-state.ts";
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
  /** Why the fact was rejected, from the `rejections` row naming its node. */
  rejection_reason: string | null;
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
    // Kept, never deleted: a rejected fact keeps its row and carries the
    // reason beside it, so the card can say why rather than showing a fact
    // that quietly stopped counting.
    ...(row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
  };
}

// ── The one projection every read of a fact uses ───────────────────────────
//
// The write below answers with the row it moved, and that row is rendered by
// the same card the queue renders. So the two reads return the same columns
// through the same mapper. A write that returned a narrower row would drop the
// source link off the card the moment a fact moved, which is a change nothing
// would fail on.

const FACT_COLUMNS = `f.id,
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
            e.chunk_id,
            r.reason   AS rejection_reason`;

// Two lateral joins rather than two plain ones. `edges_unique` is
// (from_id, to_id, kind), so nothing stops a fact deriving from two sources,
// and `rejections` has no unique key at all; a plain join would then show the
// same fact twice.
const FACT_JOINS = `
       LEFT JOIN LATERAL (
            SELECT to_id, chunk_id
              FROM edges
             WHERE from_id = f.id AND kind = 'derived_from'
             ORDER BY id
             LIMIT 1
       ) e ON true
       LEFT JOIN LATERAL (
            SELECT reason
              FROM rejections
             WHERE subject_id = f.id
             ORDER BY id DESC
             LIMIT 1
       ) r ON true`;

/**
 * Every fact in the chosen spaces, newest first.
 *
 * All six states come back, and each reader narrows to the one it shows. The
 * briefing, the two queue pages and the two sidebar counts read this one
 * answer, so their numbers cannot disagree.
 *
 * The rejection's reason is read from the `rejections` row naming this fact's
 * own node. KPA-122 decided that: see `writeMove` below for why the fact and
 * not the source it came from.
 */
export async function readFacts(
  pool: Pool,
  filter: SpaceFilter,
  today: string,
): Promise<Fact[]> {
  const result = await pool.query<FactRow>(
    `SELECT ${FACT_COLUMNS}
       FROM facts f${FACT_JOINS}
      WHERE f.space = ANY($1::space[])
      ORDER BY f.valid_from DESC, f.id DESC`,
    [spacesFor(filter)],
  );

  return result.rows.map((row) => toFact(row, today));
}

// ── Writing one review move ────────────────────────────────────────────────

/**
 * Who a move from this interface records as the verifier.
 *
 * KPA is single user and migration 001 wrote the one row, so `human:1` names
 * it. The browser never supplies this. A verifier a request could name is a
 * verifier a request could forge, and the one thing the policy will not have
 * forged is who confirmed a fact.
 */
export const VERIFIER = "human:1";

/**
 * The three moves, as SQL.
 *
 * Every one of them is guarded by the same condition `movesFor` uses to offer
 * the control, so the store refuses a move the screen would not have offered.
 * That is what makes the second of two clicks a no-op: the first move takes
 * the row out of the state the second one requires, so the second matches
 * nothing and writes nothing.
 *
 * None of them sets `valid_to`. Only a source or a human retires a fact, and
 * a queue that could retire one on a timer is the failure `src/memory/retire.ts`
 * exists to prevent.
 */
function statement(
  move: ReviewMove,
  factId: string,
  today: string,
  verifiedBy: string,
): [string, unknown[]] {
  switch (move) {
    // The row keeps its stored state: `verified` is what the state is derived
    // from, and ADR-0010 keeps the two out of one column on purpose.
    case "accept":
      return [
        `UPDATE facts SET verified = $2::date, verified_by = $3
          WHERE id = $1
            AND state IN ('candidate', 'proposed')
            AND verified IS NULL
            AND valid_to IS NULL
          RETURNING id`,
        [factId, today, verifiedBy],
      ];
    // `verified IS NULL` for the reason accept carries it. A fact with a
    // verified date derives as verified or stale whatever `state` holds, so
    // marking one rejected would leave a row reading verified on every screen
    // and carrying a rejection nobody could see. `movesFor` offers a verified
    // fact nothing, and this is that rule on the store's side of the wire.
    case "reject":
      return [
        `UPDATE facts SET state = 'rejected'
          WHERE id = $1
            AND state IN ('candidate', 'proposed')
            AND verified IS NULL
            AND valid_to IS NULL
          RETURNING id`,
        [factId],
      ];
    // ADR-0017: today plus the interval this fact carries. `review_interval`
    // is the whole of the arithmetic, and the write leaves it alone.
    //
    // KPA-133 put it there. This used to derive the interval as `stale_after`
    // minus `generated`, and this is the write that moves `stale_after`, so
    // each confirmation measured the span the last one created. A fact
    // carrying 41 days was granted 41, then 285, then 571, then 1143.
    // Migration 013 ran that subtraction once, over dates nothing had moved,
    // and floors both the backfill and the column at a day, so no floor is
    // needed here.
    //
    // Two conditions read like one. A fact with no `stale_after` is never
    // stale and never offers the move. A fact carrying a horizon and no
    // interval is a row written after 013, and nobody said how long a
    // confirmation of it should last; it writes nothing rather than deriving
    // a number, because deriving one is the defect above and guessing one is
    // worse than the null.
    case "reconfirm":
      return [
        `UPDATE facts
            SET stale_after = $2::date + review_interval
          WHERE id = $1
            AND valid_to IS NULL
            AND verified IS NOT NULL
            AND stale_after IS NOT NULL
            AND stale_after < $2::date
            AND review_interval IS NOT NULL
          RETURNING id`,
        [factId, today],
      ];
  }
}

/**
 * Apply one review move to one fact, and answer with the row as it now stands.
 *
 * `null` means the store made no move: the fact had already moved, or it was
 * never in the state this move requires. The caller says so rather than
 * showing a move that did not happen.
 *
 * **An agent may never verify.** The check is here, before any statement runs,
 * rather than left to `facts_machine_never_verifies`. The constraint is the
 * second line and it still holds; a rule the database enforces and the code
 * only avoids is a rule that reads as an accident to the next person editing
 * this function.
 *
 * A reject is two writes, so it runs in a transaction. Half a rejection is a
 * fact marked rejected with no reason recorded, and the reason is the whole
 * reason the row is kept.
 *
 * `rejections.subject_id` names **this fact's own node**. Migration 001 wrote
 * that column for a candidate the gates turned away, which has no node and so
 * points at the source it came from. This rejection is different: the
 * candidate already became a fact, so the node the rejection concerns exists
 * and is the fact itself. The source is the alternative and it fails twice.
 * Nothing writes a `derived_from` edge yet, so most facts name no source for
 * it to point at; and a source that produced four facts would carry four
 * rejections with nothing saying which fact each one judged.
 */
export async function writeMove(
  pool: Pool,
  factId: string,
  move: ReviewMove,
  today: string,
  verifiedBy: string,
  reason?: string,
): Promise<Fact | null> {
  if (verifiedBy.startsWith("agent:")) {
    throw new ReviewError(`an agent may never verify a fact: ${verifiedBy}`);
  }
  if (move === "reject" && !reason?.trim()) {
    throw new ReviewError("a rejection must record a reason");
  }

  const [sql, params] = statement(move, factId, today, verifiedBy);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const moved = await client.query<{ id: string }>(sql, params);
    if (moved.rows.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    if (move === "reject") {
      await client.query(
        `INSERT INTO rejections (subject_id, candidate, reason, raised)
         SELECT f.id, f.description, $2, $3::date FROM facts f WHERE f.id = $1`,
        [factId, reason!.trim(), today],
      );
    }

    // Read the row back through the same projection the queue reads, inside
    // the transaction, so the answer carries what was just written.
    const read = await client.query<FactRow>(
      `SELECT ${FACT_COLUMNS} FROM facts f${FACT_JOINS} WHERE f.id = $1`,
      [factId],
    );
    await client.query("COMMIT");

    return toFact(read.rows[0]!, today);
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally {
    client.release();
  }
}
