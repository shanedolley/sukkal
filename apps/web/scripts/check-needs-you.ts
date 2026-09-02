// The check the database read needs. Run: npm run check
//
// KPA-117 replaces the Needs you fixture with a read of one table. Two rules
// carry that read, and both are silent when they break.
//
// The mapping. Every field the interface declares comes from a column, and
// the rule comes through the audit entry rather than a second copy beside it.
// A field the mapper forgets renders as nothing, and nothing on a screen
// looks like a row with nothing to say.
//
// The filter. It narrows in SQL, so this checks the list of spaces the query
// is given. Narrowing to Collibra keeps Collibra and shared, because shared
// is the space either side may cite. ADR-0018.
//
// It reaches no database. The query is one statement and the connection is
// checked by test/webhooks.test.ts in the root package; what is worth
// proving here is the shape a row arrives in and the shape it leaves in.

import assert from "node:assert/strict";

import { spacesFor, toItem, type NeedsYouRow } from "../lib/needs-you.ts";
import type { Space } from "../lib/types.ts";

const RAISED = new Date("2026-08-25T07:42:00+10:00");

/** A row with every column filled, which is what the mapping is checked on. */
function row(over: Partial<NeedsYouRow> = {}): NeedsYouRow {
  return {
    id: "12",
    kind: "denied-action",
    title: "Calendar hold refused: Sydney Water follow-up",
    detail: "The agent tried to hold 90 minutes on Thursday.",
    space: "collibra",
    entity: "Sydney Water",
    raised_at: RAISED,
    gmail_url: null,
    source_id: null,
    chunk_id: null,
    audit_id: "7",
    rule: "calendar.hold.max-minutes",
    ...over,
  };
}

// 1. Every column reaches the field the interface declares.
const full = toItem(row({ gmail_url: "https://mail.google.com/mail/u/0/#drafts" }));
assert.equal(full.id, "12");
assert.equal(full.kind, "denied-action");
assert.equal(full.title, "Calendar hold refused: Sydney Water follow-up");
assert.equal(full.detail, "The agent tried to hold 90 minutes on Thursday.");
assert.equal(full.space, "collibra");
assert.equal(full.entity, "Sydney Water");
assert.equal(full.raisedAt, RAISED.toISOString());
assert.equal(full.gmailUrl, "https://mail.google.com/mail/u/0/#drafts");
assert.equal(full.auditId, "7");

// 2. The rule reads through the audit entry. needs_you holds no rule column,
//    so a row that names an audit entry gets the rule from it or from nowhere.
assert.equal(full.rule, "calendar.hold.max-minutes");
assert.equal(
  toItem(row({ audit_id: null, rule: null })).rule,
  undefined,
  "a row naming no audit entry invented a rule"
);

// 3. A null entity survives the mapping. Migration 010 made the column
//    nullable, and the row renders without it rather than crashing.
assert.equal(toItem(row({ entity: null })).entity, null);

// 4. A row names a source, a chunk inside it, or neither. A row raised before
//    its source was broken up still opens that source, at the top: dropping
//    the source with the missing chunk leaves the row with no address at all.
assert.deepEqual(
  toItem(row({ source_id: "3", chunk_id: "9" })).provenance,
  { sourceId: "3", chunkId: "9" }
);
assert.deepEqual(
  toItem(row({ source_id: "3", chunk_id: null })).provenance,
  { sourceId: "3" },
  "a row with a source and no passage lost its source too"
);
assert.equal(toItem(row()).provenance, undefined);

// 5. The filter narrows to one space and keeps shared with it.
for (const space of ["collibra", "koinon", "personal"] as Space[]) {
  assert.deepEqual(
    spacesFor(space),
    [space, "shared"],
    `filtering to ${space} lost the space either side may cite`
  );
}

// 6. "all" is no filter, so it names every space the enum holds. A space
//    missing here is a row no filter shows.
assert.deepEqual(spacesFor("all"), ["collibra", "koinon", "personal", "shared"]);

console.log(
  "needs-you OK: eleven columns map, the rule comes from the audit entry, and every filter carries shared"
);
