// The check the audit log needs. Run: npm run check
//
// The brief calls the audit log the safety net. The assistant acts alone, so
// nothing approves an action in advance and this record is what catches a
// mistake afterwards. A filter that hides a denial, or an order that is not
// time order, hides the thing the reader came to find.
//
// KPA-43.

import assert from "node:assert/strict";

import { auditRows } from "../lib/audit-view.ts";
import { AUDIT } from "../lib/fixtures.ts";

// 1. The denied filter keeps every denied entry and hides every allowed one.
const denied = auditRows(AUDIT, "denied");
assert.ok(denied.length > 0, "no denied entry, so the filter proves nothing");
for (const entry of denied) {
  assert.equal(entry.outcome, "denied", `${entry.id} is allowed and the denied filter kept it`);
}
assert.equal(
  denied.length,
  AUDIT.filter((entry) => entry.outcome === "denied").length,
  "the denied filter hid a denial"
);

// 2. Allowed, the same way round.
const allowed = auditRows(AUDIT, "allowed");
assert.ok(allowed.length > 0, "no allowed entry, so the filter proves nothing");
for (const entry of allowed) {
  assert.equal(entry.outcome, "allowed", `${entry.id} is denied and the allowed filter kept it`);
}

// 3. The two halves account for every entry, so no filter loses a row and
//    "all" hides nothing.
assert.equal(denied.length + allowed.length, AUDIT.length, "an entry is neither allowed nor denied");
assert.equal(auditRows(AUDIT, "all").length, AUDIT.length);

// 4. Every denied entry names the rule that denied it. Without the rule the
//    reader knows only that something was refused.
for (const entry of denied) {
  assert.ok(
    entry.rule && entry.rule.trim().length > 0,
    `${entry.id} was denied and names no rule`
  );
}

// 5. Newest first, on every filter. A log out of time order is not a log.
for (const outcome of ["all", "allowed", "denied"] as const) {
  const rows = auditRows(AUDIT, outcome);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      new Date(rows[i - 1].at).getTime() >= new Date(rows[i].at).getTime(),
      `${outcome} put ${rows[i].id} after an older entry`
    );
  }
}

// 6. The sort copies its input, so reading the log never reorders the source.
const written = AUDIT.map((entry) => entry.id);
auditRows(AUDIT, "all");
assert.deepEqual(AUDIT.map((entry) => entry.id), written, "the sort reordered the fixture");

// 7. Every entry carries the four fields the page shows: what it meant to do,
//    the state before, what happened, and how to reverse it.
for (const entry of AUDIT) {
  for (const field of ["intent", "before", "result", "reverse"] as const) {
    assert.ok(
      entry[field].trim().length > 0,
      `${entry.id} has an empty ${field}, so the log cannot be acted on`
    );
  }
}

console.log(
  `audit OK: ${denied.length} denied and ${allowed.length} allowed, every denial names a rule, newest first`
);
