// The check the audit log needs. Run: npm run check
//
// The brief calls the audit log the safety net. The assistant acts alone, so
// nothing approves an action in advance and this record is what catches a
// mistake afterwards. A filter that hides a denial, or an order that is not
// time order, hides the thing the reader came to find.
//
// KPA-43 wrote it against the fixture. KPA-120 moved the page onto the
// database, so it runs against rows now: the same four rules, plus the two
// joins the row alone cannot carry. It reaches no database. What is worth
// proving here is the shape a row arrives in and the shape it leaves in.

import assert from "node:assert/strict";

import { toEntry, type AuditRow } from "../lib/audit.ts";
import { auditRows } from "../lib/audit-view.ts";
import { spacesFor } from "../lib/space.ts";
import type { AuditEntry, Space } from "../lib/types.ts";

/** A row as the read hands it over. */
function row(over: Partial<AuditRow> = {}): AuditRow {
  return {
    id: "1",
    at: new Date("2026-08-25T06:02:00+10:00"),
    action: "Apply Gmail label",
    intent: "File the Meridian thread under BHP / Meridian.",
    before: "Thread carried no label.",
    outcome: "allowed",
    result: "Label applied to 4 messages.",
    reverse: "Remove the label from the 4 messages listed above.",
    space: "collibra",
    rule: null,
    governs: null,
    effect: null,
    needs_you_id: null,
    needs_you_title: null,
    ...over,
  };
}

/** A denial, with the rule and the decision it raised. */
function denial(over: Partial<AuditRow> = {}): AuditRow {
  return row({
    id: "2",
    at: new Date("2026-08-25T05:03:00+10:00"),
    action: "Hold calendar time",
    intent: "Hold 90 minutes on Thursday for the Sydney Water follow-up.",
    before: "Thursday 14:00 to 15:30 was free.",
    outcome: "denied",
    result: "Refused and queued for your decision. No event was created.",
    reverse: "Nothing to reverse. No event was created.",
    rule: "calendar.hold.max-minutes",
    governs: "Holding calendar time",
    effect: "Deny beyond 60 minutes.",
    needs_you_id: "9",
    needs_you_title: "Calendar hold refused: Sydney Water follow-up",
    ...over,
  });
}

const ENTRIES: AuditEntry[] = [
  toEntry(row()),
  toEntry(row({ id: "3", at: new Date("2026-08-25T06:15:00+10:00") })),
  toEntry(denial()),
  toEntry(
    denial({
      id: "4",
      at: new Date("2026-08-24T09:00:00+10:00"),
      needs_you_id: null,
      needs_you_title: null,
    })
  ),
];

// 1. The denied filter keeps every denied entry and hides every allowed one.
const denied = auditRows(ENTRIES, "denied");
assert.ok(denied.length > 0, "no denied entry, so the filter proves nothing");
for (const entry of denied) {
  assert.equal(entry.outcome, "denied", `${entry.id} is allowed and the denied filter kept it`);
}
assert.equal(
  denied.length,
  ENTRIES.filter((entry) => entry.outcome === "denied").length,
  "the denied filter hid a denial"
);

// 2. Allowed, the same way round.
const allowed = auditRows(ENTRIES, "allowed");
assert.ok(allowed.length > 0, "no allowed entry, so the filter proves nothing");
for (const entry of allowed) {
  assert.equal(entry.outcome, "allowed", `${entry.id} is denied and the allowed filter kept it`);
}

// 3. The two halves account for every entry, so no filter loses a row and
//    "all" hides nothing.
assert.equal(denied.length + allowed.length, ENTRIES.length, "an entry is neither allowed nor denied");
assert.equal(auditRows(ENTRIES, "all").length, ENTRIES.length);

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
  const rows = auditRows(ENTRIES, outcome);
  for (let i = 1; i < rows.length; i++) {
    assert.ok(
      new Date(rows[i - 1]!.at).getTime() >= new Date(rows[i]!.at).getTime(),
      `${outcome} put ${rows[i]!.id} after an older entry`
    );
  }
}

// 6. The sort copies its input, so reading the log never reorders the source.
const written = ENTRIES.map((entry) => entry.id);
auditRows(ENTRIES, "all");
assert.deepEqual(ENTRIES.map((entry) => entry.id), written, "the sort reordered its input");

// 7. Every entry carries the four fields the row shows: what it meant to do,
//    the state before, what happened, and how to reverse it.
for (const entry of ENTRIES) {
  for (const field of ["intent", "before", "result", "reverse"] as const) {
    assert.ok(
      entry[field].trim().length > 0,
      `${entry.id} has an empty ${field}, so the log cannot be acted on`
    );
  }
}

// ── The two joins ────────────────────────────────────────────────────────

// 8. The rule's own words come from the policy the entry names, never from a
//    copy on the entry. A key alone says which rule fired and nothing about
//    what it governs.
const withRule = toEntry(denial());
assert.deepEqual(withRule.policy, {
  governs: "Holding calendar time",
  effect: "Deny beyond 60 minutes.",
});
assert.equal(
  toEntry(row()).policy,
  undefined,
  "an entry naming no rule invented a policy"
);
assert.equal(
  toEntry(denial({ governs: "Holding calendar time", effect: null })).policy,
  undefined,
  "half a policy rendered as a sentence with no effect"
);

// 9. A denial names the open decision it raised, and says so when there is
//    none. A dead link is worse than a sentence saying the matter is closed.
assert.deepEqual(withRule.decision, {
  id: "9",
  title: "Calendar hold refused: Sydney Water follow-up",
});
assert.equal(
  toEntry(denial({ needs_you_id: null, needs_you_title: null })).decision,
  undefined,
  "a denial with nothing open still offered a link"
);

// 10. Every field the interface declares maps from a column.
assert.equal(withRule.id, "2");
assert.equal(withRule.at, new Date("2026-08-25T05:03:00+10:00").toISOString());
assert.equal(withRule.action, "Hold calendar time");
assert.equal(withRule.space, "collibra");
assert.equal(withRule.rule, "calendar.hold.max-minutes");

// 11. The space filter narrows in SQL and carries shared with it, the same
//     rule the queue read follows. ADR-0018.
for (const space of ["collibra", "koinon", "personal"] as Space[]) {
  assert.deepEqual(spacesFor(space), [space, "shared"]);
}
assert.deepEqual(spacesFor("all"), ["collibra", "koinon", "personal", "shared"]);

console.log(
  `audit OK: ${denied.length} denied and ${allowed.length} allowed, every denial names a rule and where its decision went, newest first`
);
