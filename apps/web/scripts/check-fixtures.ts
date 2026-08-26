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

// 3. All five fact states appear, so every badge variant has a row.
const STATES: FactState[] = [
  "candidate",
  "proposed",
  "verified",
  "stale",
  "retired",
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

// 5. Every space carries rows, so the space filter has something to narrow.
const SPACES: Space[] = ["collibra", "koinon", "personal"];
const everything = [...FACTS, ...NEEDS_YOU, ...MEETINGS, ...AUDIT, ...SOURCES];
for (const space of SPACES) {
  assert.ok(
    everything.some((row) => row.space === space),
    `no fixture row sits in the "${space}" space`
  );
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
