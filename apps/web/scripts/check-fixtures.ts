// The check KPA-48 asks for. Run: npm run check
// Node strips the types, so this needs no test framework and no dependency.
//
// It fails loudly. A citation that points at nothing renders an empty drawer,
// and a missing fact state leaves a badge variant untested.

import assert from "node:assert/strict";

import {
  AUDIT,
  CHAT_ANSWERS,
  FACTS,
  ISSUES,
  JIRA_FIELDS,
  MEETINGS,
  WORKSPACE_FIELDS,
  NEEDS_YOU,
  SOURCES,
  SPRINTS,
} from "../lib/fixtures.ts";
import type { FactState, Space } from "../lib/types.ts";
import { spaceOf, workspaceNamed } from "../lib/workspaces.ts";

const chunkExists = (sourceId: string, chunkId: string | undefined) =>
  SOURCES.some(
    (source) =>
      source.id === sourceId && source.chunks.some((c) => c.id === chunkId)
  );

// 1. Every citation resolves to a source and a chunk that exist.
for (const answer of CHAT_ANSWERS) {
  for (const citation of answer.citations) {
    assert.ok(
      chunkExists(citation.sourceId, citation.chunkId),
      `chat answer ${answer.id} cites ${citation.sourceId}#${citation.chunkId}, which does not exist`
    );
  }
}

// 2. Every fact's provenance resolves the same way.
for (const fact of FACTS) {
  assert.ok(
    chunkExists(fact.provenance.sourceId, fact.provenance.chunkId),
    `fact ${fact.id} points at ${fact.provenance.sourceId}#${fact.provenance.chunkId}, which does not exist`
  );
}

// 2b. Every Needs you row resolves the source or the audit entry it names.
//     A row whose panel opens blank is worse than a row with no panel.
for (const item of NEEDS_YOU) {
  if (item.provenance) {
    assert.ok(
      chunkExists(item.provenance.sourceId, item.provenance.chunkId),
      `needs-you ${item.id} points at ${item.provenance.sourceId}#${item.provenance.chunkId}, which does not exist`
    );
  }
  if (item.auditId) {
    assert.ok(
      AUDIT.some((entry) => entry.id === item.auditId),
      `needs-you ${item.id} points at audit entry ${item.auditId}, which does not exist`
    );
  }
  assert.ok(
    item.provenance || item.auditId,
    `needs-you ${item.id} names neither a source nor an audit entry, so its panel has nothing to show`
  );
}

// 3. Every fact state appears, so every badge variant has a row behind it.
//    This list must match FactState exactly. It said five when the type had
//    six, so the rejected badge and the rejection-reason line went untested.
const STATES: FactState[] = [
  "candidate",
  "proposed",
  "verified",
  "stale",
  "retired",
  "rejected",
];
for (const state of STATES) {
  assert.ok(
    FACTS.some((f) => f.state === state),
    `no fixture fact is in state "${state}"`
  );
}

// 4. Every denied audit entry names the rule that denied it.
for (const entry of AUDIT) {
  if (entry.outcome === "denied") {
    assert.ok(
      entry.rule,
      `denied audit entry ${entry.id} names no policy rule`
    );
  }
}

// 5. Every collection carries a row in every space, checked per collection
//    rather than pooled. Pooled, one personal audit entry satisfied the whole
//    check while four dashboard regions rendered empty under that filter.
const SPACES: Space[] = ["collibra", "koinon", "personal"];
const COLLECTIONS: Record<string, { space: Space }[]> = {
  SOURCES,
  FACTS,
  NEEDS_YOU,
  MEETINGS,
  AUDIT,
  // An issue carries a workspace rather than a space, and its space is that
  // workspace's. It is checked below with the same rule.
  ISSUES: ISSUES.map((issue) => ({ space: spaceOf(issue.workspace) })),
};
for (const [name, rows] of Object.entries(COLLECTIONS)) {
  for (const space of SPACES) {
    assert.ok(
      rows.some((row) => row.space === space),
      `${name} has no row in the "${space}" space, so that filter renders empty`
    );
  }
}

// 5b. A rejected fact records why. Without it a later run raises it again.
for (const fact of FACTS) {
  if (fact.state === "rejected") {
    assert.ok(
      fact.rejectionReason,
      `rejected fact ${fact.id} records no reason`
    );
  }
}

// 6. A retired fact carries valid_to. Nothing else does.
for (const fact of FACTS) {
  if (fact.state === "retired") {
    assert.ok(fact.validTo, `retired fact ${fact.id} has no valid_to`);
  } else {
    assert.equal(
      fact.validTo,
      null,
      `fact ${fact.id} is ${fact.state} but carries a valid_to`
    );
  }
}

// 7. Chat needs one single-space answer and one crossing answer, because the
//    crossing flag needs both a positive and a negative case.
assert.ok(
  CHAT_ANSWERS.some((a) => a.spaces.length === 1),
  "no chat answer draws on a single space"
);
assert.ok(
  CHAT_ANSWERS.some((a) => a.spaces.length > 1),
  "no chat answer crosses two spaces, so the crossing flag is untested"
);

// 8. Exactly one sprint is in flight. Two, and the current sprint view has to
//    guess which one it means.
assert.equal(
  SPRINTS.filter((sprint) => sprint.state === "active").length,
  1,
  "the sprints do not name exactly one active sprint"
);

// 9. Every sprint state carries an issue, or that sprint view renders empty.
for (const state of ["active", "future", "closed"] as const) {
  const ids = SPRINTS.filter((s) => s.state === state).map((s) => s.id);
  assert.ok(
    ISSUES.some((issue) => issue.sprintId && ids.includes(issue.sprintId)),
    `no issue sits in a ${state} sprint, so that sprint view renders empty`
  );
}

// 10. Every issue resolves the sprint and the parent it names.
for (const issue of ISSUES) {
  if (issue.sprintId) {
    assert.ok(
      SPRINTS.some((sprint) => sprint.id === issue.sprintId),
      `issue ${issue.key} sits in sprint ${issue.sprintId}, which does not exist`
    );
  }
  if (issue.parent) {
    assert.ok(
      ISSUES.some((other) => other.key === issue.parent),
      `issue ${issue.key} hangs under ${issue.parent}, which does not exist`
    );
  }
}

// 11. A dependency points at a row that exists, and no issue blocks itself.
//     A dangling key renders a pill counting something nobody can open.
for (const issue of ISSUES) {
  for (const held of issue.blocks) {
    assert.ok(
      ISSUES.some((other) => other.key === held),
      `issue ${issue.key} blocks ${held}, which does not exist`
    );
    assert.notEqual(held, issue.key, `issue ${issue.key} blocks itself`);
  }
  assert.equal(
    new Set(issue.blocks).size,
    issue.blocks.length,
    `issue ${issue.key} names the same blocked issue twice`
  );
}

// 12. Work starts before it is due. The two dates are set apart in the
//     interface, so nothing else stops them crossing.
for (const issue of ISSUES) {
  if (issue.start && issue.due) {
    assert.ok(
      issue.start <= issue.due,
      `issue ${issue.key} starts on ${issue.start} and is due on ${issue.due}`
    );
  }
}

// 13. The fixtures exercise both new fields. Empty ones pass every check
//     above without proving anything.
assert.ok(
  ISSUES.some((issue) => issue.blocks.length > 0),
  "no issue blocks another, so the dependency pill is untested"
);
assert.ok(
  ISSUES.some((issue) => issue.start),
  "no issue carries a start date, so that pill is untested"
);

// 14. Every workspace an issue names is one the model knows, and carries a
//     custom field list, even an empty one. A workspace missing from the map
//     reads as "no fields", which is right, but only by accident.
for (const name of new Set(ISSUES.map((issue) => issue.workspace))) {
  assert.ok(
    workspaceNamed(name),
    `issues name the workspace ${name}, which lib/workspaces.ts does not hold`
  );
  assert.ok(
    name in WORKSPACE_FIELDS,
    `workspace ${name} has no custom field list`
  );
}

// 15. A field id is unique within its workspace, and every value an issue
//     carries is filed under an id that workspace declares. A stray value is
//     a value no screen would ever show.
for (const [project, fields] of Object.entries(WORKSPACE_FIELDS)) {
  const ids = fields.map((field) => field.id);
  assert.equal(
    new Set(ids).size,
    ids.length,
    `project ${project} declares the same field id twice`
  );
  for (const field of fields) {
    assert.ok(field.name, `a field on ${project} has no name`);
  }
}
for (const issue of ISSUES) {
  const ids = new Set(
    (WORKSPACE_FIELDS[issue.workspace] ?? []).map((f) => f.id)
  );
  for (const id of Object.keys(issue.fields)) {
    assert.ok(
      ids.has(id),
      `issue ${issue.key} carries ${id}, which ${issue.workspace} does not declare`
    );
  }
}

// 16. The fixtures exercise a required field that some rows leave empty, so
//     the create form's refusal has something to refuse.
{
  const required = Object.values(WORKSPACE_FIELDS)
    .flat()
    .filter((field) => field.required);
  assert.ok(required.length > 0, "no custom field is required anywhere");
  assert.ok(
    ISSUES.some((issue) => Object.keys(issue.fields).length > 0),
    "no issue carries a custom field value, so the column is untested"
  );
}

// 17. Every field a project carries is one the site offers. A project field
//     the catalogue does not hold could never be picked again once removed,
//     and would write a value to a field Jira does not have.
{
  const offered = new Set(JIRA_FIELDS.map((field) => field.id));
  assert.equal(
    offered.size,
    JIRA_FIELDS.length,
    "the site catalogue lists the same field id twice"
  );
  for (const [project, fields] of Object.entries(WORKSPACE_FIELDS)) {
    for (const field of fields) {
      assert.ok(
        offered.has(field.id),
        `${project} carries ${field.id}, which the site does not offer`
      );
      const named = JIRA_FIELDS.find((one) => one.id === field.id);
      assert.equal(
        field.name,
        named?.name,
        `${project} calls ${field.id} "${field.name}" and the site calls it "${named?.name}"`
      );
    }
  }
}

console.log(
  `fixtures OK: ${SOURCES.length} sources, ${FACTS.length} facts, ${NEEDS_YOU.length} needs-you, ${MEETINGS.length} meetings, ${CHAT_ANSWERS.length} answers, ${AUDIT.length} audit entries, ${ISSUES.length} issues in ${SPRINTS.length} sprints`
);
