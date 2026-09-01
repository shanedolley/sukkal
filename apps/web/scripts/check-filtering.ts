// The check the filter control needs. Run: npm run check
//
// A filter decides what a person sees, so its faults are invisible by
// construction: a row that never renders raises no error and nobody notices
// it is gone. Each rule below is one a reader would assume without asking.

import assert from "node:assert/strict";

import { ISSUES, SPRINTS } from "../lib/fixtures.ts";
import {
  activeCount,
  applyFilters,
  FILTER_FIELDS,
  optionsFor,
  nest,
  NOTHING_SELECTED,
  rowsIn,
  select,
  toggleValue,
  type Filters,
} from "../lib/issue-view.ts";

const sprintNames = Object.fromEntries(SPRINTS.map((s) => [s.id, s.name]));

// 1. No filter shows everything. The identity case, and the one a broken
//    filter breaks first.
assert.equal(
  applyFilters(ISSUES, {}, sprintNames).length,
  ISSUES.length,
  "an empty filter dropped rows"
);
assert.equal(activeCount({}), 0, "an empty filter counts as active");

// 2. Every field offers the values its rows actually hold, and the counts add
//    up to the rows. Labels counts higher, because an issue carries several.
for (const field of FILTER_FIELDS) {
  const options = optionsFor(ISSUES, field, sprintNames);
  assert.ok(options.length > 0, `${field} offers nothing to filter by`);

  for (const option of options) {
    assert.ok(option.label, `a ${field} option has no label`);
    assert.ok(option.count > 0, `${field} option ${option.key} counts zero`);

    // 3. Choosing one value returns exactly the rows that option counted.
    const only = applyFilters(ISSUES, { [field]: [option.key] }, sprintNames);
    assert.equal(
      only.length,
      option.count,
      `${field} ${option.key} offers ${option.count} rows and returns ${only.length}`
    );
  }

  // 4. Choosing every value of one field changes nothing, because every row
  //    holds at least one of them.
  const all = applyFilters(
    ISSUES,
    { [field]: options.map((option) => option.key) },
    sprintNames
  );
  assert.equal(
    all.length,
    ISSUES.length,
    `choosing every ${field} value still hid rows`
  );
}

// 5. Values inside one field widen the result. Two statuses return at least
//    as many rows as either alone, and never more than their sum.
{
  const statuses = optionsFor(ISSUES, "status", sprintNames);
  const [first, second] = statuses;
  const both = applyFilters(
    ISSUES,
    { status: [first.key, second.key] },
    sprintNames
  );
  assert.equal(
    both.length,
    first.count + second.count,
    "two statuses did not widen the result to the sum of the two"
  );
}

// 6. Fields narrow the result. Adding a second field never returns more.
{
  const status = optionsFor(ISSUES, "status", sprintNames)[0];
  const workspace = optionsFor(ISSUES, "workspace", sprintNames)[0];
  const one = applyFilters(ISSUES, { status: [status.key] }, sprintNames);
  const two = applyFilters(
    ISSUES,
    { status: [status.key], workspace: [workspace.key] },
    sprintNames
  );
  assert.ok(
    two.length <= one.length,
    "adding a second field returned more rows, not fewer"
  );
  for (const issue of two) {
    assert.equal(issue.status, status.key, "a row escaped the status filter");
    assert.equal(
      issue.workspace,
      workspace.key,
      "a row escaped the workspace filter"
    );
  }
}

// 7. Toggling a value on and off returns the filter it started from. Without
//    this the button counts a filter that no longer narrows anything.
{
  const on: Filters = toggleValue({}, "status", "todo");
  assert.deepEqual(on, { status: ["todo"] }, "toggling on stored the wrong shape");
  assert.equal(activeCount(on), 1, "one chosen value did not count as one");

  const off = toggleValue(on, "status", "todo");
  assert.deepEqual(off, {}, "toggling off left an empty field behind");
  assert.equal(activeCount(off), 0, "an emptied field still counts");
}

// 8. A filter that removes a parent keeps its sub-tasks on the screen. The
//    tree hangs a child off its parent, and a child that left with its
//    parent would be a row nobody could find.
{
  const child = ISSUES.find((issue) => issue.parent);
  assert.ok(child, "no sub-task in the fixtures, so this rule is untested");
  const parent = ISSUES.find((issue) => issue.key === child.parent);
  assert.ok(parent, `${child.key} names a parent that does not exist`);
  assert.notEqual(
    child.status,
    parent.status,
    "the sub-task shares its parent's status, so removing one keeps the other"
  );

  const shown = applyFilters(ISSUES, { status: [child.status] }, sprintNames);
  assert.ok(
    shown.some((issue) => issue.key === child.key),
    `${child.key} vanished when its own status was chosen`
  );
  assert.ok(
    !shown.some((issue) => issue.key === parent.key),
    `${parent.key} survived a filter that excludes its status`
  );

  const nodes = nest(shown);
  assert.ok(
    nodes.some((node) => node.issue.key === child.key),
    `${child.key} did not become a root once its parent was filtered out`
  );
  assert.equal(
    rowsIn(nodes),
    shown.length,
    "nesting the filtered rows lost or repeated one"
  );
}

// ── Selection ─────────────────────────────────────────────────────────
//
// A wrong range takes rows the reader did not choose, and a bulk action then
// changes them, so these are the rules that cost the most when they slip.

const ORDER = ["a", "b", "c", "d", "e"];
const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
const shift = { shiftKey: true, ctrlKey: false, metaKey: false };
const ctrl = { shiftKey: false, ctrlKey: true, metaKey: false };
const cmd = { shiftKey: false, ctrlKey: false, metaKey: true };
const chosen = (s: { keys: Set<string> }) => [...s.keys].sort().join("");

// 9. A click adds a row and keeps the rest. Choosing six rows takes six
//    clicks, and none of them undoes the five before it.
{
  let picked = NOTHING_SELECTED;
  for (const key of ["b", "d", "e"]) {
    picked = select(picked, key, ORDER, plain);
  }
  assert.equal(chosen(picked), "bde", "a click dropped the rows chosen before it");
  assert.equal(picked.anchor, "e", "a click did not move the anchor");
}

// 10. Clicking a chosen row lets it go, and leaves the others where they are.
{
  const three = ["b", "d", "e"].reduce(
    (current, key) => select(current, key, ORDER, plain),
    NOTHING_SELECTED
  );
  assert.equal(chosen(select(three, "d", ORDER, plain)), "be", "un-picking one row disturbed the others");
}

// 11. Ctrl and Cmd behave as a plain click, because the row needs a modifier
//     to tell a selection from whatever a plain click will one day open.
for (const modifier of [ctrl, cmd]) {
  const one = select(NOTHING_SELECTED, "a", ORDER, plain);
  const two = select(one, "c", ORDER, modifier);
  assert.equal(chosen(two), "ac", "a modifier click did not add a row");
  const back = select(two, "c", ORDER, modifier);
  assert.equal(chosen(back), "a", "a modifier click did not take a row away");
}

// 12. Shift takes the run between the anchor and the clicked row, and the
//     direction makes no difference.
{
  const anchor = select(NOTHING_SELECTED, "b", ORDER, plain);
  assert.equal(chosen(select(anchor, "d", ORDER, shift)), "bcd", "shift down took the wrong run");

  const high = select(NOTHING_SELECTED, "d", ORDER, plain);
  assert.equal(chosen(select(high, "b", ORDER, shift)), "bcd", "shift up took the wrong run");
}

// 13. Shift keeps the anchor, so a second shift-click re-measures from the
//     same row rather than from the last one.
{
  const anchor = select(NOTHING_SELECTED, "b", ORDER, plain);
  const first = select(anchor, "d", ORDER, shift);
  assert.equal(first.anchor, "b", "shift moved the anchor");
  assert.equal(chosen(select(first, "e", ORDER, shift)), "bcde", "the second shift-click re-measured from the wrong row");
}

// 14. Shift with no anchor behaves as a plain click. Nothing to measure from
//     is not a reason to select nothing.
assert.equal(
  chosen(select(NOTHING_SELECTED, "c", ORDER, shift)),
  "c",
  "shift with no anchor selected the wrong rows"
);

// 14b. Shift never takes a row away. A run that unpicked half of what it
//      crossed would be a run nobody could predict.
{
  const some = ["c", "d"].reduce(
    (current, key) => select(current, key, ORDER, plain),
    NOTHING_SELECTED
  );
  assert.equal(
    chosen(select(some, "a", ORDER, shift)),
    "abcd",
    "shift removed a row it crossed"
  );
}

// 15. A filter can hide the anchor. With nothing left to measure from, the
//     shift-click adds the row it landed on and no more. Reaching for the
//     rows around a row nobody can see would be worse than adding one.
{
  const anchor = select(NOTHING_SELECTED, "b", ORDER, plain);
  const wide = select(anchor, "d", ORDER, shift);
  assert.equal(chosen(wide), "bcd", "the run before the filter was wrong");

  const remaining = ["c", "d", "e"];
  assert.equal(
    chosen(select(wide, "e", remaining, shift)),
    "bcde",
    "shift took a run from an anchor the list no longer holds"
  );
}

console.log(
  `filtering OK: ${FILTER_FIELDS.length} fields, every option returns the rows it counts, and a click adds rather than replaces`
);
