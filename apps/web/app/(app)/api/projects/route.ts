/**
 * A project's settings, over HTTP.
 *
 * `GET` answers every project's label and contract dates, keyed by project id,
 * and `PUT` replaces one project's three values. The settings tab is the only
 * caller today rather than the only caller possible, so the body is checked
 * here as well as on the form.
 *
 * A DATE IS 'YYYY-MM-DD' TEXT ON BOTH SIDES OF THIS ROUTE. `src/db/connect.ts`
 * tells the driver so, because parsing a calendar date into a `Date` puts it
 * at local midnight and reads back a day west of Greenwich.
 *
 * This route authenticates nobody, because nothing does yet.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { readProjects, writeProject, type ProjectSetting } from "@/lib/tree";

/** The reason goes to the server's log and never to the browser: a connection
 *  error names the host, the database and the user. */
function refused(what: string, cause: unknown): Response {
  console.error(`${what}:`, cause);
  return NextResponse.json(
    { error: "The database did not answer." },
    { status: 503 }
  );
}

const bad = (error: string): Response =>
  NextResponse.json({ error }, { status: 400 });

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A date the form may send: a calendar day, or nothing at all. */
function day(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && DAY.test(value));
}

export async function GET(): Promise<Response> {
  try {
    return NextResponse.json(await readProjects(db()));
  } catch (cause) {
    return refused("projects", cause);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    id?: unknown;
    setting?: Record<string, unknown>;
  } | null;
  if (!body) return bad("Send a JSON body.");

  const { id, setting } = body;
  if (typeof id !== "string" || id.trim() === "") {
    return bad("Name the project.");
  }
  if (!setting || typeof setting !== "object") {
    return bad("Send the project's settings.");
  }
  if (typeof setting["label"] !== "string" || setting["label"].trim() === "") {
    return bad("The Jira label cannot be empty.");
  }
  if (!day(setting["start"] ?? null) || !day(setting["end"] ?? null)) {
    return bad("Write a date as YYYY-MM-DD.");
  }

  const start = (setting["start"] as string | null) ?? null;
  const end = (setting["end"] as string | null) ?? null;
  // `projects_contract_end_follows_start` refuses this, and a plain sentence
  // reads better than the constraint's name. Both dates are text, so this
  // compares them as text.
  if (start !== null && end !== null && end < start) {
    return bad("The contract cannot end before it starts.");
  }

  const chosen: ProjectSetting = {
    label: (setting["label"] as string).trim(),
    start,
    end,
  };

  try {
    const written = await writeProject(db(), id, chosen);
    if (!written) {
      return NextResponse.json(
        { error: "No project is filed under that key." },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return refused("project write", cause);
  }
}
