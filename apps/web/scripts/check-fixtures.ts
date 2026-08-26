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
  MEETINGS,
  NEEDS_YOU,
  SOURCES,
} from "../lib/fixtures.ts";
import type { FactState, Space } from "../lib/types.ts";

const chunkExists = (sourceId: string, chunkId: string) =>
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

console.log(
  `fixtures OK: ${SOURCES.length} sources, ${FACTS.length} facts, ${NEEDS_YOU.length} needs-you, ${MEETINGS.length} meetings, ${CHAT_ANSWERS.length} answers, ${AUDIT.length} audit entries`
);
