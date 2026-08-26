// The check the review queue was missing. Run: npm run check
//
// scripts/check-fixtures.ts proves the data's shape. This proves the rules,
// which is where the brief actually draws its lines. Each of the three below
// is a rule from docs/project-brief.md, and each is easy to break by accident
// in a way no build error would catch.

import assert from "node:assert/strict";

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
