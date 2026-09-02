/**
 * The web tier's read of the sources: one of them, or all of them.
 *
 * Two callers, one table, one route. The drawer opens on demand, one source
 * at a time, so it names an id. The command palette lists what the memory
 * holds, so it names a space and no id. A second route would repeat the
 * validation, the log line and the message that names no host, and the two
 * copies would eventually disagree about what a source is.
 *
 * `id` is what picks between them. It is a query parameter and not a path
 * segment because there is one parameter and no resource tree under it.
 *
 * The list carries no passage and no body. The palette prints a title, an
 * author and a date, and a body per row is the whole file.
 *
 * Nothing here caches. A route handler is uncached by default in this version
 * of Next, and a source is verbatim and never edited, so the only thing that
 * changes is whether it exists yet.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { listSources, readSource } from "@/lib/sources";
import type { SpaceFilter } from "@/lib/space";

/** A `bigint` primary key, as text. Anything else names no row, so it is
 *  refused here rather than sent to Postgres to fail on the cast. */
const ID = /^\d{1,19}$/;

const FILTERS: SpaceFilter[] = ["all", "collibra", "koinon", "personal"];

/** The browser's own filter, or "all". A value nobody offers narrows nothing
 *  rather than reaching the enum cast with something it cannot read. */
function filterFrom(value: string | null): SpaceFilter {
  return FILTERS.find((filter) => filter === value) ?? "all";
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");

  // No id at all asks for the list. An id that is present and malformed is a
  // caller asking for one source and naming it wrongly, so it is refused
  // rather than answered with every source.
  if (id !== null && !ID.test(id)) {
    return NextResponse.json({ error: "That is not a source id." }, { status: 400 });
  }

  try {
    if (id === null) {
      return NextResponse.json(await listSources(db(), filterFrom(params.get("space"))));
    }

    const source = await readSource(db(), id);
    return source
      ? NextResponse.json(source)
      : NextResponse.json({ error: "No such source." }, { status: 404 });
  } catch (cause) {
    // The reason goes to the server's log and never to the browser: a
    // connection error names the host, the database and the user.
    console.error("sources:", cause);
    return NextResponse.json({ error: "The database did not answer." }, { status: 503 });
  }
}
