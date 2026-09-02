/**
 * The web tier's read of the audit log.
 *
 * It takes the space and nothing else. The outcome filter is applied in the
 * browser by `auditRows`, so one read serves the page and the sidebar's
 * denied count and the two cannot disagree.
 *
 * The space comes from the browser because that is where the filter lives: it
 * is the owner's choice, held in `localStorage` so a reload keeps it, and the
 * server cannot see it.
 */
import { NextResponse } from "next/server";

import { readAudit } from "@/lib/audit";
import { db } from "@/lib/db";
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
    return NextResponse.json(await readAudit(db(), space));
  } catch (cause) {
    // The reason goes to the server's log and never to the browser: a
    // connection error names the host, the database and the user.
    console.error("audit:", cause);
    return NextResponse.json({ error: "The database did not answer." }, { status: 503 });
  }
}
