// Reading one day's meetings from the database.
//
// KPA-118. The meetings list was the one list in the application that did not
// open, because a fixture meeting had nothing behind it to open. A row here
// names the source its transcript became, and that is what the panel opens.
//
// Three things this file settles.
//
// The day is an argument, never `now()` inside the statement. A meeting that
// falls on Tuesday reads differently on Wednesday, so passing the day is what
// lets a caller hold one still. `src/memory/state.ts` gives the same rule for
// a fact's state.
//
// The day becomes a range here rather than in the browser. `starts_at` is a
// `timestamptz`, so "Tuesday" is a pair of instants, and which instants
// depends on the zone. Postgres knows every zone's daylight saving; the
// alternative is that arithmetic in JavaScript.
//
// The space filter narrows in SQL, for the reason `lib/needs-you.ts` gives:
// a filter applied in the browser has already sent every row across the wire.
//
// The caller hands in the pool, the same way every function in the root
// package takes the client it queries with. That also leaves this file with
// one import that survives type erasure, so scripts/check-meetings.ts runs it
// under plain node.

import type { Pool } from "pg";

import { spacesFor, type SpaceFilter } from "./space.ts";
import type { Meeting, Space } from "./types";

/**
 * The zone the day is read in.
 *
 * `lib/format.ts` pins the same zone for every date the interface prints, and
 * for the same reason: Shane and his calendar are in Sydney, so the day a
 * meeting belongs to is the day it belongs to there, whatever zone the server
 * or the browser happens to run in.
 */
const ZONE = "Australia/Sydney";

/** One `meetings` row, named as the table carries it. `starts_at` and
 *  `ends_at` are `timestamptz`, so the driver hands each back as a `Date`.
 *  Only `date` columns come back as text. */
export interface MeetingRow {
  id: string;
  starts_at: Date;
  ends_at: Date;
  title: string;
  engagement: string;
  space: Space;
  attendees: string[];
  source_id: string | null;
}

/**
 * A meeting as a screen renders it, plus the transcript it points at.
 *
 * `sourceId` is absent until nabium delivers one, which ADR-0013 makes the
 * ordinary case rather than a fault: the meeting exists in the calendar long
 * before anything transcribes it. The panel says which of the two it has.
 */
export interface MeetingItem extends Meeting {
  sourceId?: string;
}

/** A row as the interface declares it. Every field maps from a column. */
export function toMeeting(row: MeetingRow): MeetingItem {
  return {
    id: row.id,
    start: row.starts_at.toISOString(),
    end: row.ends_at.toISOString(),
    title: row.title,
    engagement: row.engagement,
    space: row.space,
    // `attendees` is `text[]`, which the driver hands back as an array. It is
    // never null: the column has a default of '{}' and NOT NULL behind it.
    attendees: row.attendees,
    ...(row.source_id ? { sourceId: row.source_id } : {}),
  };
}

/**
 * One day's meetings in the chosen spaces, in start order.
 *
 * `day` is `YYYY-MM-DD`. It becomes the half-open range from midnight in
 * Sydney to midnight the next day, which is the shape `test/meetings.test.ts`
 * proves excludes the neighbouring day, and the shape the `meetings_starts_at`
 * index serves.
 *
 * The cast to `timestamp` before `AT TIME ZONE` is load bearing. A bare
 * `date AT TIME ZONE zone` resolves to the other overload, returns a
 * `timestamp` in the server's own zone, and silently reads the wrong day for
 * any server that is not in Sydney. Checked on this Mac, whose Postgres runs
 * in Australia/Brisbane, where the two agree in August and disagree in
 * December.
 */
export async function meetingsOn(
  pool: Pool,
  day: string,
  filter: SpaceFilter,
): Promise<MeetingItem[]> {
  const result = await pool.query<MeetingRow>(
    `SELECT id, starts_at, ends_at, title, engagement, space, attendees, source_id
       FROM meetings
      WHERE starts_at >= ($1::date)::timestamp AT TIME ZONE $2::text
        AND starts_at <  (($1::date) + 1)::timestamp AT TIME ZONE $2::text
        AND space = ANY($3::space[])
      ORDER BY starts_at`,
    [day, ZONE, spacesFor(filter)],
  );

  return result.rows.map(toMeeting);
}
