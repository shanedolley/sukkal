// The check the space filter and the crossing rule need. Run: npm run check
//
// The brief makes the space filter the policy: retrieval filters by space by
// default, and a crossing is flagged rather than blocked. Both rules are one
// line each, and both are silent when they break. A filter that leaks a Koinon
// row into a Collibra view breaks the rule the whole brief rests on.
//
// KPA-39 asks for the filter. KPA-41 asks for the flag.

import assert from "node:assert/strict";

import {
  AUDIT,
  CHAT_ANSWERS,
  FACTS,
  MEETINGS,
  NEEDS_YOU,
  SOURCES,
  findSource,
} from "../lib/fixtures.ts";
import { crosses, inSpace } from "../lib/space.ts";
import type { Space } from "../lib/types.ts";

const SPACES: Space[] = ["collibra", "koinon", "personal"];

// 1. Every space keeps its own rows and hides every other. The story names
//    Collibra and Koinon; all three are checked, because a filter that only
//    works on the two named spaces is not a filter.
function filterHolds<T extends { space: Space }>(name: string, rows: T[]) {
  for (const space of SPACES) {
    const narrowed = inSpace(rows, space);
    for (const row of narrowed) {
      assert.equal(row.space, space, `${name} filtered to ${space} kept a ${row.space} row`);
    }
    assert.equal(
      narrowed.length,
      rows.filter((row) => row.space === space).length,
      `${name} filtered to ${space} dropped one of its own`
    );
  }

  // "all" is no filter, not an empty one.
  assert.deepEqual(inSpace(rows, "all"), rows, `${name} lost rows on "all"`);

  // The three spaces account for every row, so no row hides from every filter.
  const counted = SPACES.reduce((n, space) => n + inSpace(rows, space).length, 0);
  assert.equal(counted, rows.length, `${name} holds a row no space shows`);
}

filterHolds("needs you", NEEDS_YOU);
filterHolds("meetings", MEETINGS);
filterHolds("facts", FACTS);
filterHolds("audit", AUDIT);
filterHolds("sources", SOURCES);

// 2. The filter reads rows and never writes them.
const before = NEEDS_YOU.map((item) => item.id);
inSpace(NEEDS_YOU, "collibra");
assert.deepEqual(NEEDS_YOU.map((item) => item.id), before, "the filter reordered its input");

// 3. The crossing rule. One space raises nothing, two raise the flag.
assert.equal(crosses([]), false, "an answer citing nothing crossed");
assert.equal(crosses(["collibra"]), false, "one space crossed");
assert.equal(crosses(["collibra", "koinon"]), true, "two spaces did not cross");
assert.equal(crosses(["collibra", "koinon", "personal"]), true);

// 4. The same space twice is one space. An answer that cites Collibra in two
//    places drew on Collibra, and flagging it would teach the reader to ignore
//    the flag.
assert.equal(crosses(["collibra", "collibra"]), false, "one space twice crossed");

// 5. The fixtures carry both cases, so the flag has a positive and a negative
//    to show.
const single = CHAT_ANSWERS.filter((answer) => !crosses(answer.spaces));
const crossing = CHAT_ANSWERS.filter((answer) => crosses(answer.spaces));
assert.ok(single.length > 0, "no chat answer draws on a single space");
assert.ok(crossing.length > 0, "no chat answer crosses two spaces");

// 6. An answer says it crossed only when its citations came from the spaces it
//    names. A flag the sources do not support is a lie on the screen.
for (const answer of CHAT_ANSWERS) {
  const cited = new Set(
    answer.citations.map((citation) => findSource(citation.sourceId)?.space)
  );
  assert.equal(
    crosses([...cited] as Space[]),
    crosses(answer.spaces),
    `chat answer ${answer.id} flags a crossing its citations do not support`
  );
}

console.log(
  `space OK: ${SPACES.length} spaces narrow 5 collections, and the crossing flag follows the citations`
);
