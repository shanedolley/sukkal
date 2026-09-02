/**
 * The web tier's read of one day's meetings.
 *
 * A route handler rather than a server component, for the reason
 * `api/needs-you/route.ts` gives: the space filter is the owner's choice, it
 * lives in `localStorage`, and the server cannot see it. The browser names
 * the space and the server narrows on it, which keeps the filter in SQL.
 *
 * The day is a parameter and defaults to today in Sydney. `realToday` reads
 * the clock in the one zone this application prints in, so the answer does
 * not depend on where the server or the browser sits. A caller that names a
 * day gets that day, which is what makes the read checkable against a fixed
 * calendar.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { realToday } from "@/lib/format";
import { meetingsOn } from "@/lib/meetings";
import type { SpaceFilter } from "@/lib/space";

const FILTERS: SpaceFilter[] = ["all", "collibra", "koinon", "personal"];

/** The browser's own filter, or "all". A value nobody offers narrows nothing
 *  rather than reaching the enum cast with something it cannot read. */
function filterFrom(value: string | null): SpaceFilter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

/** A calendar day, `YYYY-MM-DD`. The shape is checked here so a value that is
 *  not a day is refused rather than failing on the cast in Postgres. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const space = filterFrom(params.get("space"));
  const day = params.get("day") ?? realToday();

  // `2026-13-45` passes the shape and names no day, so the calendar answers
  // as well as the pattern.
  if (!DAY.test(day) || Number.isNaN(Date.parse(day))) {
    return NextResponse.json({ error: "That is not a day." }, { status: 400 });
  }

  try {
    return NextResponse.json(await meetingsOn(db(), day, space));
  } catch (cause) {
    // The reason goes to the server's log and never to the browser: a
    // connection error names the host, the database and the user.
    console.error("meetings:", cause);
    return NextResponse.json({ error: "The database did not answer." }, { status: 503 });
  }
}
