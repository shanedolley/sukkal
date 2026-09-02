/**
 * The web tier's read of "Needs you".
 *
 * A route handler rather than a server component, because the space filter
 * lives in the browser. It is the owner's choice, held in `localStorage` so a
 * reload keeps it, and the server cannot see it. The browser therefore names
 * the space and the server narrows on it, which keeps the filter in SQL where
 * the acceptance criterion puts it.
 *
 * Three screens read this one answer: the briefing, the sidebar's count, and
 * the command palette. `lib/needs-you-context.tsx` fetches it once and hands
 * it to all three, so their counts cannot disagree.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { openItems } from "@/lib/needs-you";
import type { SpaceFilter } from "@/lib/space";

const FILTERS: SpaceFilter[] = ["all", "collibra", "koinon", "personal"];

/** The browser's own filter, or "all". A value nobody offers narrows nothing
 *  rather than reaching the enum cast with something it cannot read. */
function filterFrom(value: string | null): SpaceFilter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

export async function GET(request: Request): Promise<Response> {
  const space = filterFrom(new URL(request.url).searchParams.get("space"));

  try {
    return NextResponse.json(await openItems(db(), space));
  } catch (cause) {
    // The reason goes to the server's log and never to the browser: a
    // connection error names the host, the database and the user.
    console.error("needs-you:", cause);
    return NextResponse.json({ error: "The database did not answer." }, { status: 503 });
  }
}
