/**
 * The web tier's read of the review queue.
 *
 * A route handler rather than a server component, for the reason
 * `api/needs-you/route.ts` gives: the space filter is the owner's choice, held
 * in `localStorage`, so the browser names the space and the server narrows on
 * it in SQL.
 *
 * The day goes out with the rows. Five screens read this one answer and every
 * one of them derives a state from a date, so they have to agree on which day
 * it is. Sending the day the states were built from is what makes the stale
 * page's "days past review" measure against the same day the queue used.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readFacts } from "@/lib/facts";
import type { Fact } from "@/lib/types";
import type { SpaceFilter } from "@/lib/space";

const FILTERS: SpaceFilter[] = ["all", "collibra", "koinon", "personal"];

/** The browser's own filter, or "all". A value nobody offers narrows nothing
 *  rather than reaching the enum cast with something it cannot read. */
function filterFrom(value: string | null): SpaceFilter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

/** The rows, and the day their states were derived from. */
export interface FactsAnswer {
  today: string;
  facts: Fact[];
}

export async function GET(request: Request): Promise<Response> {
  const space = filterFrom(new URL(request.url).searchParams.get("space"));

  // Read once, here, and pass it down. `src/memory/gates.ts` takes the day the
  // same way, so a fact written this morning and a queue read this afternoon
  // agree on the date.
  const today = new Date().toISOString().slice(0, 10);

  try {
    const answer: FactsAnswer = { today, facts: await readFacts(db(), space, today) };
    return NextResponse.json(answer);
  } catch (cause) {
    // The reason goes to the server's log and never to the browser: a
    // connection error names the host, the database and the user.
    console.error("facts:", cause);
    return NextResponse.json({ error: "The database did not answer." }, { status: 503 });
  }
}
