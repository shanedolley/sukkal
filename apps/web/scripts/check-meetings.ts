// The check the meetings read needs. Run: npm run check
//
// KPA-118 replaces the meetings fixture with a read of one table, and two
// rules carry that read. Both are silent when they break.
//
// The mapping. Every field the interface declares comes from a column, and a
// field the mapper forgets renders as nothing. `attendees` is the one to
// watch: it is `text[]` and the panel joins it, so a string arriving where an
// array belongs prints one long word rather than failing.
//
// The transcript. `source_id` is null until nabium delivers one, and a
// meeting with no transcript has to reach the panel saying so rather than
// carrying an id that opens nothing. ADR-0013.
//
// It reaches no database. `test/meetings.test.ts` in the root package proves
// the day range and the start order against a real one; what is worth proving
// here is the shape a row arrives in and the shape it leaves in.

import assert from "node:assert/strict";

import { toMeeting, type MeetingRow } from "../lib/meetings.ts";
import { spacesFor } from "../lib/space.ts";
import type { Space } from "../lib/types.ts";

const STARTS = new Date("2026-09-02T09:30:00+10:00");
const ENDS = new Date("2026-09-02T10:30:00+10:00");

/** A row with every column filled, which is what the mapping is checked on. */
function row(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: "4",
    starts_at: STARTS,
    ends_at: ENDS,
    title: "BHP Meridian steering group",
    engagement: "BHP Meridian",
    space: "collibra",
    attendees: ["Priya Raman", "Nigel Barros", "Shane Dolley"],
    source_id: "7",
    ...over,
  };
}

// 1. Every column reaches the field the interface declares.
const full = toMeeting(row());
assert.equal(full.id, "4");
assert.equal(full.title, "BHP Meridian steering group");
assert.equal(full.engagement, "BHP Meridian");
assert.equal(full.space, "collibra");
assert.equal(full.sourceId, "7");

// 2. A start and an end are `timestamptz`, so the driver hands each back as a
//    `Date` and the interface carries an ISO string. A `date` column would
//    arrive as text instead, which is why this is asserted rather than
//    assumed.
assert.equal(full.start, "2026-09-01T23:30:00.000Z");
assert.equal(full.end, "2026-09-02T00:30:00.000Z");

// 3. Attendees is an array, and it survives as one.
assert.deepEqual(full.attendees, ["Priya Raman", "Nigel Barros", "Shane Dolley"]);
assert.deepEqual(toMeeting(row({ attendees: [] })).attendees, []);

// 4. A meeting with no transcript carries no source. The panel reads the
//    absence and says the transcript has not arrived; an empty string would
//    read as an id and open nothing.
assert.equal(
  toMeeting(row({ source_id: null })).sourceId,
  undefined,
  "a meeting with no transcript invented a source"
);

// 5. The filter narrows to one space and keeps shared with it. A meeting in
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
  "meetings OK: eight columns map, attendees stays an array, and a meeting with no transcript carries none"
);
