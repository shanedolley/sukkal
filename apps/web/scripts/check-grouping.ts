// The check the grouping control needs. Run: npm run check
//
// Grouping is the one place where a row can appear more than once, where a row
// can vanish, and where the count in a header can disagree with the rows under
// it. All three are easy to break and none raises a build error.

import assert from "node:assert/strict";

import { ISSUES, SPRINTS } from "../lib/fixtures.ts";
import {
  flat,
  GROUP_FIELDS,
  groupIssues,
  nest,
  rowsIn,
  withoutIssues,
} from "../lib/issue-view.ts";
import type { Issue } from "../lib/types.ts";

const sprintNames = Object.fromEntries(SPRINTS.map((s) => [s.id, s.name]));
const fields = GROUP_FIELDS.filter((field) => field !== "none");

const TREE = nest(ISSUES);
const FLAT = flat(ISSUES);

// ── The tree ──────────────────────────────────────────────────────────

// 1. Nesting keeps every issue, once. A child moved under its parent, and a
//    parent gaining a child, must not change the total.
assert.equal(
  rowsIn(TREE),
  ISSUES.length,
  "nesting lost or repeated an issue"
);
assert.equal(rowsIn(FLAT), ISSUES.length, "flat changed the row count");

const nestedKeys = TREE.flatMap((node) => [
  node.issue.key,
  ...node.children.map((child) => child.key),
]);
assert.equal(
  new Set(nestedKeys).size,
  ISSUES.length,
  "an issue appears twice in the tree"
);

// 2. Every child hangs off the parent it names, and every parent is a root.
for (const node of TREE) {
  assert.ok(!node.issue.parent, `${node.issue.key} is a root but names a parent`);
  for (const child of node.children) {
    assert.equal(
      child.parent,
      node.issue.key,
      `${child.key} hangs off ${node.issue.key} but names ${child.parent}`
    );
  }
}

// 3. A sub-task whose parent this list does not hold stands on its own. A
//    filter cuts rows out, and a child that left with its parent would be a
//    row nobody could find.
const orphaned = nest(ISSUES.filter((i) => i.key !== "PSAPAC-2611"));
assert.ok(
  orphaned.some((node) => node.issue.key === "PSAPAC-2612"),
  "a sub-task disappeared when its parent left the list"
);
assert.equal(
  rowsIn(orphaned),
  ISSUES.length - 1,
  "dropping one parent lost more than one row"
);

// 4. The fixtures exercise the tree at all. Without a parent anywhere, every
//    check above passes on a list that has nothing to nest.
assert.ok(
  TREE.some((node) => node.children.length > 0),
  "no issue in the fixtures carries a sub-task, so the tree is untested"
);

// ── The grouping ──────────────────────────────────────────────────────

for (const nodes of [TREE, FLAT]) {
  const mode = nodes === TREE ? "tree" : "flat";

  for (const field of fields) {
    const groups = groupIssues(nodes, field, sprintNames);
    assert.ok(groups.length > 0, `${mode}: grouping by ${field} made no group`);

    // 5. Every row lands in a group, and the header counts what it shows.
    for (const group of groups) {
      assert.ok(group.label, `${mode}: a ${field} group has no label`);
      assert.ok(group.nodes.length > 0, `${mode}: ${group.key} is empty`);
      assert.equal(
        group.count,
        rowsIn(group.nodes),
        `${mode}: ${field} group ${group.key} counts ${group.count} and shows ${rowsIn(group.nodes)}`
      );
    }

    // 6. One issue, one group, under every field except labels. Labels is the
    //    exception on purpose: an issue carries several, so it appears under
    //    each. A child follows its parent, so the parent's labels decide.
    const rows = groups.reduce((total, group) => total + group.count, 0);
    if (field === "labels") {
      const expected = nodes.reduce(
        (total, node) =>
          total +
          Math.max(1, node.issue.labels.length) * (1 + node.children.length),
        0
      );
      assert.equal(rows, expected, `${mode}: grouping by labels lost a row`);
    } else {
      assert.equal(
        rows,
        ISSUES.length,
        `${mode}: grouping by ${field} lost or repeated a row`
      );
    }

    // 7. A subgroup divides its group and adds nothing to it. The second
    //    level is where a wrong count shows, because the eye compares it to
    //    the first.
    for (const group of groups) {
      for (const second of fields) {
        if (second === field || second === "labels") continue;
        const subs = groupIssues(group.nodes, second, sprintNames);
        const under = subs.reduce((total, sub) => total + sub.count, 0);
        assert.equal(
          under,
          group.count,
          `${mode}: ${field} > ${second}: the subgroups show ${under} rows, the group counts ${group.count}`
        );
      }
    }
  }
}

// 8. The tree overrides the grouping, which is the whole point of it. A
//    sub-task whose status differs from its parent's still sits in the
//    parent's status group.
const split = ISSUES.find(
  (issue) =>
    issue.parent &&
    issue.status !== ISSUES.find((i) => i.key === issue.parent)?.status
);
assert.ok(
  split,
  "no sub-task differs in status from its parent, so the override is untested"
);
const parentStatus = ISSUES.find((i) => i.key === split.parent)!.status;
const holder = groupIssues(TREE, "status", sprintNames).find((group) =>
  group.nodes.some((node) =>
    node.children.some((child) => child.key === split.key)
  )
);
assert.equal(
  holder?.key,
  parentStatus,
  `${split.key} should sit in its parent's ${parentStatus} group`
);

// 9. With the tree off, that same sub-task returns to its own status group.
const own = groupIssues(FLAT, "status", sprintNames).find(
  (group) => group.key === split.status
);
assert.ok(
  own?.nodes.some((node) => node.issue.key === split.key),
  `${split.key} should sit in its own ${split.status} group when the tree is off`
);

// ── The order ─────────────────────────────────────────────────────────

// 10. Status groups run from work in flight to work finished, never the other
//     way. Alphabetical order would put Backlog first, which is wrong.
const statusOrder = groupIssues(TREE, "status", sprintNames).map((g) => g.key);
assert.ok(
  statusOrder.indexOf("in-progress") < statusOrder.indexOf("done"),
  "status groups do not run from in progress to done"
);

// 11. A group naming an absence sorts last.
const orphan: Issue = { ...ISSUES[0], key: "ORPHAN-1", sprintId: null };
const withOrphan = groupIssues(nest([...ISSUES, orphan]), "sprint", sprintNames);
assert.equal(
  withOrphan.at(-1)?.label,
  "No sprint",
  "the group for issues with no sprint does not sort last"
);

// ── Removal ───────────────────────────────────────────────────────────
//
// A row taken out has to take every reference to it out too. A key naming a
// row nobody can open counts on a pill, offers itself in a menu, and sends
// the reader looking for something that is gone.

// 12. Nothing goes but what was named.
{
  const kept = withoutIssues(ISSUES, ["PSAPAC-2611"]);
  assert.equal(kept.length, ISSUES.length - 1, "removing one row took another");
  assert.ok(
    !kept.some((issue) => issue.key === "PSAPAC-2611"),
    "the named row survived"
  );
  assert.deepEqual(
    withoutIssues(ISSUES, []),
    ISSUES,
    "removing nothing changed the list"
  );
}

// 13. A sub-task of a removed row keeps its place and loses its parent. It
//     must not vanish with it, and must not point at a row that has gone.
{
  const kept = withoutIssues(ISSUES, ["PSAPAC-2611"]);
  const child = kept.find((issue) => issue.key === "PSAPAC-2612");
  assert.ok(child, "the sub-task went with its parent");
  assert.equal(child.parent, undefined, "the sub-task still names a gone parent");
  assert.equal(
    rowsIn(nest(kept)),
    kept.length,
    "nesting the remainder lost or repeated a row"
  );
}

// 14. A dependency on a removed row goes with it.
{
  const blocker = ISSUES.find((issue) => issue.blocks.length > 0);
  assert.ok(blocker, "no issue blocks another, so this rule is untested");
  const held = blocker.blocks[0];
  const kept = withoutIssues(ISSUES, [held]);
  const after = kept.find((issue) => issue.key === blocker.key);
  assert.ok(after, `${blocker.key} went when ${held} did`);
  assert.ok(
    !after.blocks.includes(held),
    `${blocker.key} still blocks ${held}, which is gone`
  );
}

// 15. Every key any row names still resolves, whatever is removed.
for (const going of [["PSAPAC-2611"], ["PSAPAC-2598"], ["MP-146", "MP-142"]]) {
  const kept = withoutIssues(ISSUES, going);
  const present = new Set(kept.map((issue) => issue.key));
  for (const issue of kept) {
    for (const key of issue.blocks) {
      assert.ok(present.has(key), `${issue.key} blocks ${key}, which is gone`);
    }
    if (issue.parent) {
      assert.ok(
        present.has(issue.parent),
        `${issue.key} hangs off ${issue.parent}, which is gone`
      );
    }
  }
}

console.log(
  `grouping OK: ${fields.length} fields in both modes, ${rowsIn(TREE)} rows, every count matches its rows, and a removal takes its links`
);
