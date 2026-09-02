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
import { readFacts, VERIFIER, writeMove } from "@/lib/facts";
import { ReviewError, type ReviewMove } from "@/lib/review-state";
import type { Fact } from "@/lib/types";
import type { SpaceFilter } from "@/lib/space";

const FILTERS: SpaceFilter[] = ["all", "collibra", "koinon", "personal"];

const MOVES: ReviewMove[] = ["accept", "reject", "reconfirm"];

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

/** The row as it now stands, and the day its state was derived from. */
export interface MoveAnswer {
  today: string;
  fact: Fact;
}

/**
 * One review move, written through.
 *
 * The first write in the application. Everything above it is a read a refresh
 * corrects; this one is not, so it validates its own input rather than trusting
 * the browser to have offered only the controls the state allows.
 *
 * The verifier is not read from the request. `writeMove` takes one so an agent
 * verifier is refused in code rather than only by the constraint, and this
 * route is the caller that decides who it is.
 *
 * 409 means the store made no move: the fact had already moved, or was never
 * in the state the move requires. It is the second of two clicks arriving,
 * and it is a refusal rather than an error, because nothing went wrong.
 */
export async function POST(request: Request): Promise<Response> {
  const body: unknown = await request.json().catch(() => null);
  const sent = (body ?? {}) as Record<string, unknown>;

  const id = sent["id"];
  const move = MOVES.find((one) => one === sent["move"]);
  const reason = typeof sent["reason"] === "string" ? sent["reason"].trim() : "";

  // `facts.id` is a bigint. Anything else reaches Postgres as a cast that
  // fails, which would answer 503 and name a database fault for what is a
  // malformed request.
  if (typeof id !== "string" || !/^\d+$/.test(id) || !move) {
    return NextResponse.json(
      { error: "A move names a fact id and one of accept, reject or reconfirm." },
      { status: 400 },
    );
  }
  if (move === "reject" && reason.length === 0) {
    return NextResponse.json(
      { error: "A rejection must record a reason." },
      { status: 400 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    const fact = await writeMove(db(), id, move, today, VERIFIER, reason);
    if (!fact) {
      return NextResponse.json(
        { error: "That fact had already moved, so nothing was written." },
        { status: 409 },
      );
    }
    const answer: MoveAnswer = { today, fact };
    return NextResponse.json(answer);
  } catch (cause) {
    console.error("facts:", cause);
    // A rule this route broke is the route's fault, not the database's, and
    // saying so is what stops the browser reporting an outage that is not one.
    if (cause instanceof ReviewError) {
      return NextResponse.json({ error: "That move is not allowed." }, { status: 400 });
    }
    return NextResponse.json({ error: "The database did not answer." }, { status: 503 });
  }
}
