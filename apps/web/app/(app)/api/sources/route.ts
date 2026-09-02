/**
 * The web tier's read of one source and its passages.
 *
 * The drawer opens on demand, one source at a time, so this takes an id
 * rather than handing out a list. It is a query parameter and not a path
 * segment because there is one parameter and no resource tree under it.
 *
 * Nothing here caches. A route handler is uncached by default in this version
 * of Next, and a source is verbatim and never edited, so the only thing that
 * changes is whether it exists yet.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readSource } from "@/lib/sources";

/** A `bigint` primary key, as text. Anything else names no row, so it is
 *  refused here rather than sent to Postgres to fail on the cast. */
const ID = /^\d{1,19}$/;

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) {
    return NextResponse.json({ error: "That is not a source id." }, { status: 400 });
  }

  try {
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
