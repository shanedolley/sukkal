// The check the sources list needs. Run: npm run check
//
// KPA-132 puts the command palette's Sources group on the database, and one
// rule carries it. The palette must never list a source the drawer cannot
// open.
//
// That failure is silent and it already happened once. The palette listed
// fixture sources while the drawer read the database, so every row opened a
// panel reading "This source is not in the memory yet". Nothing threw and
// nothing logged. Only pressing a row found it.
//
// So the two rules are checked against each other here, field by field.
// `toSource` decides whether the drawer can render a source, `toSummary`
// decides whether the palette may offer one, and a column one of them starts
// to tolerate fails this check rather than reaching a reader.
//
// The filter is the second rule. It narrows in SQL, so this checks the list
// of spaces the query is given: narrowing to Collibra keeps Collibra and
// shared, because shared is the space either side may cite. ADR-0018.
//
// It reaches no database. The statement is one query and the connection is
// proved elsewhere; what is worth proving here is which rows survive the
// mapping and which do not.

import assert from "node:assert/strict";

import { spacesFor } from "../lib/space.ts";
import {
  toSource,
  toSummary,
  type SourceRow,
  type SummaryRow,
} from "../lib/sources.ts";
import type { Space } from "../lib/types.ts";

/** The five columns a source needs before anything may render it. */
const REQUIRED = ["kind", "title", "date", "author", "space"] as const;

/** A row with every column filled, which is what the mapping is checked on. */
function row(over: Partial<SummaryRow> = {}): SummaryRow {
  return {
    id: "7",
    kind: "meeting",
    title: "BHP Meridian: retention working session",
    date: "2026-08-19",
    author: "nabium transcript",
    space: "collibra",
    ...over,
  };
}

// 1. Every column reaches the field the interface declares. A field the
//    mapper forgets renders as nothing, and nothing on a row looks like a
//    source with no title rather than like a defect.
const full = toSummary(row());
assert.ok(full, "a source with every column filled did not reach the list");
assert.equal(full.id, "7");
assert.equal(full.kind, "meeting");
assert.equal(full.title, "BHP Meridian: retention working session");
assert.equal(full.author, "nabium transcript");
assert.equal(full.space, "collibra");

// 2. The date stays the text the driver hands back. Parsing it into a `Date`
//    puts it at local midnight, and reading that back as UTC moves it a day
//    west: 19 August reads as the 18th from Sydney. That is a real defect
//    this repository has already paid for, so the type is asserted and not
//    assumed.
assert.equal(full.date, "2026-08-19");
assert.equal(typeof full.date, "string");

// 3. A row missing any one of the five is dropped. Every one of the five is
//    tried, because the column that goes missing is never the one anybody
//    expected.
for (const field of REQUIRED) {
  assert.equal(
    toSummary(row({ [field]: null })),
    null,
    `a source with no ${field} reached the palette, and the drawer will not open it`
  );
}

// 4. The palette and the drawer agree, field by field. This is the check that
//    matters: `toSummary` deciding a row is listable while `toSource` refuses
//    to render it is exactly the dead path KPA-132 fixes, and it fails on the
//    screen rather than here unless something asserts it.
//
//    The body and the chunks are what the list leaves behind, so they are
//    filled here with the least a drawer can open: a body and no passages.
for (const field of [...REQUIRED, null]) {
  const over = field ? { [field]: null } : {};
  const listable = toSummary(row(over)) !== null;
  const openable =
    toSource({ ...row(over), body: "a passage" } as SourceRow, []) !== null;

  assert.equal(
    listable,
    openable,
    field
      ? `with no ${field}, the palette and the drawer disagree about this source`
      : "with every column filled, the palette and the drawer disagree"
  );
}

// 5. The filter narrows to one space and keeps shared with it. A source in
//    `shared` belongs to both sides, so it shows under either. ADR-0018.
for (const space of ["collibra", "koinon", "personal"] as Space[]) {
  assert.deepEqual(
    spacesFor(space),
    [space, "shared"],
    `filtering to ${space} lost the space either side may cite`
  );
}
assert.deepEqual(spacesFor("all"), ["collibra", "koinon", "personal", "shared"]);

console.log(
  "sources OK: six columns map, the date stays text, and the palette lists exactly what the drawer opens"
);
