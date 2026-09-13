// The check the review queue was missing. Run: npm run check
//
// scripts/check-fixtures.ts proves the data's shape. This proves the rules,
// which is where the brief actually draws its lines. Each of the three below
// is a rule from docs/project-brief.md, and each is easy to break by accident
// in a way no build error would catch.
//
// KPA-122 added a second half. The rules above hold in the browser, and the
// browser is not where a fact lives. So the same three rules are proved again
// against a real database, because the two can drift apart in silence: the
// screen showing a move the store did not take is the failure the story's last
// acceptance criterion names, and nothing on screen would say so.
//
// **The database half skips when `DATABASE_URL_TEST` is unset**, which is how
// continuous integration runs `npm run check` in `apps/web`. It follows the
// pattern `test/read-vault.test.ts` uses for the vault: build a reason, and
// skip on it, so a suite green here is green there for the same reasons.
//
//   DATABASE_URL_TEST=postgresql://you@localhost:5432/sukkal_dev_a \
//     node --experimental-strip-types scripts/check-review-rules.ts

import assert from "node:assert/strict";

import { db } from "../lib/db.ts";
import { readFacts, VERIFIER, writeMove } from "../lib/facts.ts";
import { applyMove, movesFor, ReviewError } from "../lib/review-state.ts";
import type { Fact, FactState } from "../lib/types.ts";

function fact(state: FactState): Fact {
  return {
    id: `f-${state}`,
    statement: "A fact.",
    state,
    space: "koinon",
    entity: "Test",
    validFrom: "2026-01-01",
    validTo: state === "retired" ? "2026-06-01" : null,
    staleAfter: null,
    provenance: { sourceId: "s1", chunkId: "c1" },
    generatedByAgent: true,
  };
}

const throws = (fn: () => unknown, why: string) =>
  assert.throws(fn, ReviewError, why);

// ── Rule 1: nothing is deleted. Every move keeps the row. ──────────────

{
  const before = [fact("proposed"), fact("stale")];
  for (const move of ["accept", "reject"] as const) {
    const after = applyMove(before, "f-proposed", move, "a reason");
    assert.equal(after.length, before.length, `${move} changed the row count`);
    assert.ok(
      after.some((f) => f.id === "f-proposed"),
      `${move} removed the row instead of moving its state`
    );
  }
  const after = applyMove(before, "f-stale", "reconfirm");
  assert.equal(after.length, before.length, "reconfirm changed the row count");
}

// ── Rule 2: a rejection records its reason. ────────────────────────────
// Without the reason a later run raises the same candidate again, which is
// the whole point of recording it.

{
  const facts = [fact("proposed")];
  throws(
    () => applyMove(facts, "f-proposed", "reject"),
    "reject with no reason was allowed"
  );
  throws(
    () => applyMove(facts, "f-proposed", "reject", "   "),
    "reject with a blank reason was allowed"
  );

  const after = applyMove(facts, "f-proposed", "reject", "The transcript says three years.");
  const rejected = after.find((f) => f.id === "f-proposed");
  assert.equal(rejected?.state, "rejected");
  assert.equal(rejected?.rejectionReason, "The transcript says three years.");
}

// ── Rule 3: the staleness sweep never retires. ─────────────────────────
// A stale fact is due for review, not false. Only a source or a human sets
// valid_to, so no move from this queue may ever set one.

{
  assert.deepEqual(
    movesFor(fact("stale")),
    ["reconfirm"],
    "a stale fact offers a move other than re-confirm"
  );

  const after = applyMove([fact("stale")], "f-stale", "reconfirm");
  const reconfirmed = after[0];
  assert.equal(reconfirmed.state, "verified");
  assert.equal(
    reconfirmed.validTo,
    null,
    "re-confirming a stale fact set valid_to, which retires it"
  );
}

// ── The states that offer nothing ──────────────────────────────────────

for (const state of ["verified", "retired", "rejected"] as const) {
  assert.deepEqual(movesFor(fact(state)), [], `${state} offers a move`);
  throws(
    () => applyMove([fact(state)], `f-${state}`, "accept"),
    `accept was allowed on a ${state} fact`
  );
}

// ── Accept never sets valid_to either ──────────────────────────────────

{
  const after = applyMove([fact("proposed")], "f-proposed", "accept");
  assert.equal(after[0].state, "verified");
  assert.equal(after[0].validTo, null, "accept set valid_to");
}

// ── An unknown id fails loudly rather than silently doing nothing ──────

throws(
  () => applyMove([fact("proposed")], "no-such-fact", "accept"),
  "an unknown fact id was accepted silently"
);

console.log("review rules OK: nothing deleted, reasons required, sweep never retires");

// ══ The same three rules, against the store ═════════════════════════════════

const url = process.env["DATABASE_URL_TEST"];
if (!url) {
  console.log("review writes SKIPPED: DATABASE_URL_TEST is unset");
  process.exit(0);
}

// `lib/db.ts` is the one place the web tier opens a pool, and the one place
// the date parser is set on this package's copy of the driver. Pointing it at
// the test database is what lets this check use it rather than open a second
// pool and set that parser a second time.
process.env["DATABASE_URL"] = url;
const pool = db();

/** Today, held still. Every state below is derived from a date. */
const TODAY = "2026-09-02";

/** Rows this check made, removed at the end whatever happens. */
const made: string[] = [];

/** One fact, in whatever state the assertion needs. Both statements in one
 *  transaction, because the node registry checks its side at commit. */
async function seed(over: {
  path: string;
  state?: "candidate" | "proposed" | "rejected";
  generated?: string | null;
  validFrom?: string;
  staleAfter?: string | null;
  /** Migration 013's column, named rather than derived. A seed that left it
   *  out and let the write derive it is the defect KPA-133 removed. */
  reviewInterval?: number | null;
  verified?: string | null;
}): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    const id = node.rows[0]!.id;
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state,
                          generated, valid_from, stale_after, review_interval,
                          verified, verified_by)
       VALUES ($1, $2, 'reference', $2, $3, 'shared', $4, $5, $6, $7, $8, $9,
               CASE WHEN $9::date IS NULL THEN NULL ELSE 'human:1' END)`,
      [
        id,
        over.path,
        `The claim on ${over.path}.`,
        over.state ?? "proposed",
        over.generated === undefined ? "2026-01-01" : over.generated,
        over.validFrom ?? "2026-01-01",
        over.staleAfter ?? null,
        over.reviewInterval ?? null,
        over.verified ?? null,
      ],
    );
    await client.query("COMMIT");
    made.push(id);
    return id;
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally {
    client.release();
  }
}

/** One fact's columns, read raw. The state is derived, so the columns behind
 *  it are what an assertion has to look at. */
async function stored(id: string) {
  const found = await pool.query<{
    state: string;
    verified: string | null;
    verified_by: string | null;
    stale_after: string | null;
    review_interval: number | null;
    valid_to: string | null;
  }>(
    `SELECT state, verified, verified_by, stale_after, review_interval, valid_to
       FROM facts WHERE id = $1`,
    [id],
  );
  return found.rows[0]!;
}

async function rejectionsFor(id: string) {
  const found = await pool.query<{ candidate: string; reason: string; raised: string }>(
    "SELECT candidate, reason, raised FROM rejections WHERE subject_id = $1",
    [id],
  );
  return found.rows;
}

try {
  const where = await pool.query<{ name: string }>("SELECT current_database() AS name");
  assert.notEqual(
    where.rows[0]?.name,
    "kpa",
    "this check writes facts. It must run against sukkal_dev, never kpa",
  );

  // ── Accept sets the verified date, and an agent can never be the verifier ──

  {
    const id = await seed({ path: "kpa-122/accepted.md" });
    const moved = await writeMove(pool, id, "accept", TODAY, VERIFIER);

    assert.equal(moved?.state, "verified", "accept did not verify the fact");
    const row = await stored(id);
    assert.equal(row.verified, TODAY, "accept did not set the verified date");
    assert.equal(row.verified_by, "human:1", "accept did not record who verified it");
    assert.equal(row.valid_to, null, "accept retired the fact");
    assert.equal(row.state, "proposed", "accept overwrote the stored state");

    // The second of two clicks. The first move takes the row out of the state
    // this one requires, so the store writes nothing and says nothing moved.
    assert.equal(
      await writeMove(pool, id, "accept", "2026-09-03", VERIFIER),
      null,
      "a second accept wrote over the first",
    );
    assert.equal((await stored(id)).verified, TODAY, "a second accept moved the date");

    // The constraint is the second line and it still holds. Proved by running
    // the statement the code refuses, rather than by trusting that it would.
    await assert.rejects(
      pool.query("UPDATE facts SET verified_by = 'agent:claude-opus-5' WHERE id = $1", [id]),
      /facts_machine_never_verifies/,
      "the database let an agent verify a fact",
    );
  }

  // ── The code refuses an agent verifier before any statement runs ──

  {
    // A pool that fails if it is touched at all, so the refusal is proved to
    // happen before any statement rather than by the constraint afterwards.
    const untouchable = {
      connect: () => Promise.reject(new Error("the write reached the database")),
      query: () => Promise.reject(new Error("the write reached the database")),
    } as unknown as Parameters<typeof writeMove>[0];

    await assert.rejects(
      writeMove(untouchable, "1", "accept", TODAY, "agent:claude-opus-5"),
      ReviewError,
      "an agent verifier was left to the constraint rather than refused",
    );
  }

  // ── Reject marks the fact, records the reason, and keeps the row ──

  {
    const id = await seed({ path: "kpa-122/rejected.md" });
    const why = "The transcript says three years, not five.";
    const moved = await writeMove(pool, id, "reject", TODAY, VERIFIER, why);

    assert.equal(moved?.state, "rejected", "reject did not mark the fact");
    assert.equal(moved?.rejectionReason, why, "the answer dropped the reason");

    const row = await stored(id);
    assert.equal(row.state, "rejected");
    assert.equal(row.valid_to, null, "reject retired the fact instead of marking it");

    // Nothing is deleted. The row is still readable, and the reason is on it.
    const read = await readFacts(pool, "all", TODAY);
    const still = read.find((fact) => fact.id === id);
    assert.equal(still?.state, "rejected", "the rejected row left the read");
    assert.equal(still?.rejectionReason, why, "the read lost the reason");

    // The rejection names this fact's own node, which is KPA-122's decision.
    const kept = await rejectionsFor(id);
    assert.equal(kept.length, 1, "the rejection was not recorded against the fact");
    assert.equal(kept[0]?.reason, why);
    assert.equal(kept[0]?.candidate, "The claim on kpa-122/rejected.md.");
    assert.equal(kept[0]?.raised, TODAY, "the rejection was raised on another day");

    // A second reject writes no second row, so a later run reads one reason.
    assert.equal(await writeMove(pool, id, "reject", TODAY, VERIFIER, why), null);
    assert.equal((await rejectionsFor(id)).length, 1, "a second reject wrote a second reason");

    // A verified fact offers no move, so the store refuses one. Without this
    // the row would read verified on every screen and carry a rejection none
    // of them could show, because the date beats the stored state.
    const confirmed = await seed({ path: "kpa-122/already-verified.md", verified: "2026-08-01" });
    assert.equal(
      await writeMove(pool, confirmed, "reject", TODAY, VERIFIER, why),
      null,
      "a verified fact was rejected, which the screen never offers",
    );
    assert.equal((await rejectionsFor(confirmed)).length, 0, "the refused reject wrote a reason");

    // A rejection with no reason is the failure the reason exists to prevent.
    const blank = await seed({ path: "kpa-122/no-reason.md" });
    await assert.rejects(
      writeMove(pool, blank, "reject", TODAY, VERIFIER, "   "),
      ReviewError,
      "a rejection with a blank reason was written",
    );
    assert.equal((await stored(blank)).state, "proposed", "the blank rejection marked the fact");
  }

  // ── Re-confirm moves the review date by the fact's own interval ──
  //
  // ADR-0017. The interval is `facts.review_interval`, which migration 013
  // added. 165 days carried on the row, so re-confirming on 2 September falls
  // due on 14 February. The number is the fact's own, not a horizon every fact
  // shares, which is what keeps a batch confirmed in one afternoon from
  // falling due in one afternoon.
  //
  // 165 rather than a round number on purpose. A ninety-day fixture is the
  // one a fixed ninety-day horizon passes by accident, and it did: this check
  // was written with one and stayed green against `stale_after = today + 90`.

  {
    const id = await seed({
      path: "kpa-122/stale.md",
      generated: "2026-01-01",
      staleAfter: "2026-06-15",
      reviewInterval: 165,
      verified: "2026-01-01",
    });
    const moved = await writeMove(pool, id, "reconfirm", TODAY, VERIFIER);

    assert.equal(moved?.staleAfter, "2027-02-14", "re-confirm did not keep the fact's interval");
    assert.equal(moved?.state, "verified", "the re-confirmed fact is still stale");

    const row = await stored(id);
    assert.equal(row.stale_after, "2027-02-14");
    assert.equal(row.valid_to, null, "re-confirm retired the fact");
    assert.equal(row.verified, "2026-01-01", "re-confirm set something other than the date");
    assert.equal(row.review_interval, 165, "re-confirm moved the interval as well as the date");

    // The row must not come back on the next read. This is the whole move.
    const read = await readFacts(pool, "all", TODAY);
    assert.equal(
      read.find((fact) => fact.id === id)?.state,
      "verified",
      "the re-confirmed fact came straight back into the stale queue",
    );

    // A fact that is no longer stale offers no re-confirm, so the store
    // refuses the second click the same way it refuses the second accept.
    assert.equal(await writeMove(pool, id, "reconfirm", TODAY, VERIFIER), null);
  }

  // ── The same fact, re-confirmed three times, is granted the same span ──
  //
  // This is KPA-133, and it is the whole story. The write used to read the
  // interval back out of `stale_after` minus `generated`, and it is the write
  // that moves `stale_after`, so every confirmation measured the span the last
  // one created. Against that code this fact was granted 41 days, then 285,
  // then 571: a fact judged to hold for six weeks holding for years, which
  // ADR-0017 exists to prevent.
  //
  // Each re-confirmation happens the day after the last one fell due, because
  // that is the only day the move is offered. Two of them are years apart in
  // practice, which is why nothing caught this in use.

  {
    const id = await seed({
      path: "kpa-133/three-times.md",
      generated: "2026-01-01",
      staleAfter: "2026-02-11",
      reviewInterval: 41,
      verified: "2026-01-01",
    });

    // Each pair is the day the move is made and the day it must fall due:
    // 41 days later, every time, whatever the row has been through.
    for (const [today, due] of [
      ["2026-09-02", "2026-10-13"],
      ["2026-10-14", "2026-11-24"],
      ["2026-11-25", "2027-01-05"],
    ] as const) {
      const moved = await writeMove(pool, id, "reconfirm", today, VERIFIER);
      assert.equal(
        moved?.staleAfter,
        due,
        `re-confirming on ${today} granted a span other than the fact's own 41 days`,
      );
      assert.equal(
        (await stored(id)).review_interval,
        41,
        `re-confirming on ${today} changed the interval it was supposed to keep`,
      );
    }
  }

  // ── A fact with no review date never gets one ──
  //
  // ADR-0017 again: it never goes stale, so it never offers the move, and the
  // arithmetic never sees a null to add a day to.

  {
    const id = await seed({ path: "kpa-122/no-review-date.md", verified: "2026-01-01" });
    assert.equal(await writeMove(pool, id, "reconfirm", TODAY, VERIFIER), null);
    assert.equal((await stored(id)).stale_after, null, "a fact with no review date was given one");
  }

  // ── A horizon with no interval beside it writes nothing ──
  //
  // Which of the two wins when they disagree, decided by KPA-133: the column
  // is the only interval, and nothing derives one. Migration 013 backfilled
  // every row that carries a horizon, so a row in this state was written after
  // it, and the honest answer to "how long is this good for" is that nobody
  // said. Deriving one from the dates is the defect this story removed, and
  // guessing one is worse than the null.

  {
    const id = await seed({
      path: "kpa-133/horizon-with-no-interval.md",
      generated: "2026-01-01",
      staleAfter: "2026-06-15",
      verified: "2026-01-01",
    });
    assert.equal(await writeMove(pool, id, "reconfirm", TODAY, VERIFIER), null);
    assert.equal(
      (await stored(id)).stale_after,
      "2026-06-15",
      "a fact carrying no interval was given a span from somewhere",
    );
  }

  // ── An interval that runs backwards cannot be stored at all ──
  //
  // Nothing stops a row whose review date predates the day it was generated,
  // and today plus a negative span is a date already past: the row would leave
  // the queue and be back in it on the next read. The floor used to sit in the
  // statement above. It now sits in migration 013, which floors what it
  // backfills at a day and constrains the column to match, so the one day
  // interval below is what such a row carries and the write needs no floor.

  {
    const id = await seed({
      path: "kpa-122/backwards.md",
      generated: "2026-05-01",
      staleAfter: "2026-04-01",
      reviewInterval: 1,
      verified: "2026-01-01",
    });
    const moved = await writeMove(pool, id, "reconfirm", TODAY, VERIFIER);
    assert.equal(moved?.staleAfter, "2026-09-03", "a backwards span moved the date into the past");
    assert.equal(moved?.state, "verified", "the fact came straight back into the stale queue");

    // The constraint is what makes the floor above true for every later
    // writer, so it is proved by running the statement it must refuse.
    for (const bad of [0, -30]) {
      await assert.rejects(
        pool.query("UPDATE facts SET review_interval = $2 WHERE id = $1", [id, bad]),
        /facts_review_interval_positive/,
        `the database stored a review interval of ${bad} days`,
      );
    }
  }

  console.log("review writes OK: accept, reject and re-confirm land in the store");
} finally {
  // Rejections point at the fact's node, and the node registry checks that a
  // fact node has its fact row, so the three go in this order.
  if (made.length > 0) {
    await pool.query("DELETE FROM rejections WHERE subject_id = ANY($1::bigint[])", [made]);
    await pool.query("DELETE FROM facts WHERE id = ANY($1::bigint[])", [made]);
    await pool.query("DELETE FROM nodes WHERE id = ANY($1::bigint[])", [made]);
  }
  await pool.end();
}
