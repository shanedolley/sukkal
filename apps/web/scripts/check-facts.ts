// The check the review queue's read needs. Run: npm run check
//
// KPA-121 replaces the facts fixture with a read of one table. Three rules
// carry that read, and every one of them is silent when it breaks.
//
// The state. Three of the six are stored and three are derived from dates, so
// nothing on a screen can be trusted unless the interface's state is the same
// state src/memory/state.ts builds. Section 1 writes ADR-0010's rule out a
// second time, from the ADR rather than from the code, and holds the mapper
// and the derivation against it over every combination of the three dates. A
// derivation that drifts from the decision fails here rather than showing a
// retired fact in the stale queue.
//
// The mapping. Every field the interface declares comes from a column. A field
// the mapper forgets renders as nothing, and nothing on a screen looks like a
// row with nothing to say.
//
// The entity. `facts.entity` is nullable and nothing resolves it yet, so a
// fact naming none is the common case. It has to be grouped and named
// deliberately, because the alternative is the word "undefined" on the
// briefing.
//
// It reaches no database. The query is one statement and the connection is
// checked in the root package; what is worth proving here is the shape a row
// arrives in and the shape it leaves in.

import assert from "node:assert/strict";

import { factState } from "../../../src/memory/state.ts";
import { byEntity, toFact, NO_ENTITY, type FactRow } from "../lib/facts.ts";
import { spacesFor } from "../lib/space.ts";
import type { Space } from "../lib/types.ts";

const TODAY = "2026-08-25";

/** A row with every column filled, which is what the mapping is checked on. */
function row(over: Partial<FactRow> = {}): FactRow {
  return {
    id: "12",
    description:
      "BHP Meridian retains lineage records for three years hot and four years archived.",
    state: "proposed",
    space: "collibra",
    entity: "BHP Meridian",
    valid_from: "2026-08-19",
    valid_to: null,
    stale_after: "2026-11-19",
    verified: null,
    generated_by: "agent:claude-opus-5",
    source_id: null,
    chunk_id: null,
    ...over,
  };
}

// ── 1. The interface's state is ADR-0010's state, on every combination ──
//
// The three dates each take four values: absent, before today, today itself,
// and after it. Today itself is the one that catches an off-by-one, because
// the ADR says `stale_after < today` and not `<=`: a fact falls due the day
// after its date, not on it.

const STORED = ["candidate", "proposed", "rejected"] as const;
const DAYS = [null, "2026-08-24", TODAY, "2026-08-26"];

/** ADR-0010's rule, written from the ADR rather than from the code. */
function fromTheAdr(
  stored: (typeof STORED)[number],
  verified: string | null,
  staleAfter: string | null,
  validTo: string | null
): string {
  if (validTo !== null) return "retired";
  if (verified === null) return stored;
  if (staleAfter !== null && staleAfter < TODAY) return "stale";
  return "verified";
}

let combinations = 0;
for (const stored of STORED) {
  for (const verified of DAYS) {
    for (const stale_after of DAYS) {
      for (const valid_to of DAYS) {
        combinations += 1;
        const where = `${stored} verified=${verified} stale_after=${stale_after} valid_to=${valid_to}`;
        const want = fromTheAdr(stored, verified, stale_after, valid_to);
        const fields = { state: stored, verified, stale_after, valid_to };

        assert.equal(
          factState(fields, TODAY),
          want,
          `src/memory/state.ts disagrees with ADR-0010 on ${where}`
        );
        assert.equal(
          toFact(row(fields), TODAY).state,
          want,
          `the interface disagrees with ADR-0010 on ${where}`
        );
      }
    }
  }
}
assert.equal(combinations, 192, "the three dates were not all combined");

// A retired fact reads retired whatever stale_after says. It is the case a
// stored state gets wrong, and the reason ADR-0010 derives rather than stores.
assert.equal(
  toFact(row({ verified: "2026-01-01", stale_after: "2026-02-01", valid_to: "2026-06-01" }), TODAY)
    .state,
  "retired",
  "a retired fact read as stale, so it would sit in the queue asking to be re-confirmed"
);

// Today is an argument. The same row reads differently tomorrow, which is what
// lets a check hold the day still.
const due = row({ verified: "2026-01-01", stale_after: TODAY });
assert.equal(toFact(due, TODAY).state, "verified", "a fact fell due on its own date");
assert.equal(toFact(due, "2026-08-26").state, "stale", "a fact past its date did not fall due");

// ── 2. Every column reaches the field the interface declares ──

const mapped = toFact(row({ source_id: "3", chunk_id: "9" }), TODAY);
assert.equal(mapped.id, "12");
assert.equal(
  mapped.statement,
  "BHP Meridian retains lineage records for three years hot and four years archived.",
  "the statement did not come from facts.description"
);
assert.equal(mapped.space, "collibra");
assert.equal(mapped.entity, "BHP Meridian");
assert.equal(mapped.validFrom, "2026-08-19");
assert.equal(mapped.validTo, null);
assert.equal(mapped.staleAfter, "2026-11-19", "staleAfter came from the wrong column");

// A date arrives as YYYY-MM-DD text. Parsing one into a Date puts it at local
// midnight, and reading that back as UTC moves it a day west.
for (const day of [mapped.validFrom, mapped.staleAfter]) {
  assert.match(String(day), /^\d{4}-\d{2}-\d{2}$/, "a date stopped being text");
}

// Who wrote it comes from the prefix generated_by carries, the same
// vocabulary facts_machine_never_verifies guards on verified_by.
assert.equal(mapped.generatedByAgent, true);
assert.equal(toFact(row({ generated_by: "human:1" }), TODAY).generatedByAgent, false);
assert.equal(
  toFact(row({ generated_by: null }), TODAY).generatedByAgent,
  false,
  "a fact nothing recorded was credited to an agent"
);

// ── 3. A fact names a source, a passage inside it, or neither ──

assert.deepEqual(mapped.provenance, { sourceId: "3", chunkId: "9" });
assert.deepEqual(
  toFact(row({ source_id: "3", chunk_id: null }), TODAY).provenance,
  { sourceId: "3" },
  "a fact with a source and no passage lost its source too"
);
assert.equal(
  toFact(row(), TODAY).provenance,
  undefined,
  "a fact with no derived_from edge invented a source"
);

// ── 4. A fact naming no entity is named, not left as undefined ──

assert.equal(toFact(row({ entity: null }), TODAY).entity, null, "a null entity was invented");

const counted = byEntity([
  { entity: "BHP Meridian" },
  { entity: null },
  { entity: "BHP Meridian" },
  { entity: null },
  { entity: null },
  { entity: "Maybank" },
]);
assert.deepEqual(counted, [
  { entity: NO_ENTITY, count: 3 },
  { entity: "BHP Meridian", count: 2 },
  { entity: "Maybank", count: 1 },
]);
assert.ok(
  counted.every(({ entity }) => entity && entity !== "undefined" && entity !== "null"),
  "a group with no entity reached the briefing as a placeholder word"
);

// ── 5. The filter narrows in SQL and keeps shared with every space ──

for (const space of ["collibra", "koinon", "personal"] as Space[]) {
  assert.deepEqual(
    spacesFor(space),
    [space, "shared"],
    `filtering to ${space} lost the space either side may cite`
  );
}
assert.deepEqual(spacesFor("all"), ["collibra", "koinon", "personal", "shared"]);

console.log(
  `facts OK: ${combinations} date combinations agree with ADR-0010, every column maps, and a fact with no entity groups under "${NO_ENTITY}"`
);
