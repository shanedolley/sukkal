// The check the space filter and the crossing rule need. Run: npm run check
//
// The brief makes the space filter the policy: retrieval filters by space by
// default, and a crossing is flagged rather than blocked. Both rules are one
// line each, and both are silent when they break. A filter that leaks a Koinon
// row into a Collibra view breaks the rule the whole brief rests on.
//
// KPA-39 asks for the filter. KPA-41 asks for the flag. KPA-130 adds the
// fourth space: a filter keeps `shared` as well as its own, and a shared
// citation crosses nothing. ADR-0018 decides both.

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
import { crossed, crosses, inSpace } from "../lib/space.ts";
import type { Space } from "../lib/types.ts";

// The three the switcher offers. `shared` is not one of them, because nothing
// filters to it alone.
const SPACES: Space[] = ["collibra", "koinon", "personal"];

// 1. Every space keeps its own rows and every shared row, and hides the other
//    two. The story names Collibra and Koinon; all three are checked, because
//    a filter that only works on the two named spaces is not a filter.
function filterHolds<T extends { space: Space }>(name: string, rows: T[]) {
  for (const space of SPACES) {
    const narrowed = inSpace(rows, space);
    for (const row of narrowed) {
      assert.ok(
        row.space === space || row.space === "shared",
        `${name} filtered to ${space} kept a ${row.space} row`
      );
    }
    assert.equal(
      narrowed.length,
      rows.filter((row) => row.space === space || row.space === "shared").length,
      `${name} filtered to ${space} dropped one of its own`
    );
  }

  // "all" is no filter, not an empty one.
  assert.deepEqual(inSpace(rows, "all"), rows, `${name} lost rows on "all"`);

  // No row hides from every filter. Counting the three narrowed lists against
  // the whole would say so too, until a shared row landed in all three and the
  // sum stopped meaning anything. This asks the question directly.
  for (const row of rows) {
    assert.ok(
      SPACES.some((space) => inSpace(rows, space).includes(row)),
      `${name} holds a ${row.space} row no space shows`
    );
  }

  // A shared row stands under every filter, not under one and not under none.
  for (const row of rows.filter((one) => one.space === "shared")) {
    for (const space of SPACES) {
      assert.ok(
        inSpace(rows, space).includes(row),
        `${name} hid a shared row from the ${space} filter`
      );
    }
  }
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

// 4b. A shared citation crosses nothing, whichever side asked. `shared` is the
//     space the wall does not divide, and this flag is the only guard that
//     wall has, so a flag it raises for nothing costs the guard. ADR-0018.
assert.equal(crosses(["collibra", "shared"]), false, "a shared citation crossed");
assert.equal(crosses(["koinon", "shared"]), false, "a shared citation crossed");
assert.equal(crosses(["personal", "shared"]), false, "a shared citation crossed");
assert.equal(crosses(["shared"]), false, "shared alone crossed");
assert.equal(crosses(["shared", "shared"]), false, "shared twice crossed");

// 4c. Shared hides no real crossing. Dropping it must not drop the flag when
//     two of the other three are cited beside it.
assert.equal(
  crosses(["collibra", "koinon", "shared"]),
  true,
  "two spaces and a shared fact did not cross"
);

// 4d. The flag names what crossed, and never `shared`. The alert reads this
//     list, so a shared fact named there would say a wall was crossed that
//     was not.
assert.deepEqual(crossed(["collibra", "shared"]), ["collibra"]);
assert.deepEqual(crossed(["collibra", "koinon", "shared"]), ["collibra", "koinon"]);
assert.deepEqual(crossed(["collibra", "collibra"]), ["collibra"], "the flag names a space twice");
assert.deepEqual(crossed(["shared"]), []);

// 5. The fixtures carry all three cases, so the flag has a positive, a
//    negative, and the shared answer the exception exists for.
const single = CHAT_ANSWERS.filter((answer) => !crosses(answer.spaces));
const crossing = CHAT_ANSWERS.filter((answer) => crosses(answer.spaces));
assert.ok(single.length > 0, "no chat answer draws on a single space");
assert.ok(crossing.length > 0, "no chat answer crosses two spaces");
assert.ok(
  CHAT_ANSWERS.some(
    (answer) => answer.spaces.includes("shared") && !crosses(answer.spaces)
  ),
  "no chat answer cites a shared fact beside its own space, so the exception is untested"
);

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
  `space OK: ${SPACES.length} spaces narrow 5 collections and each keeps shared, and the crossing flag follows the citations`
);
