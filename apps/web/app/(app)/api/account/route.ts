/**
 * The owner's row, over HTTP.
 *
 * One route for one row. `GET` answers the account and the chosen colours,
 * `POST` is the setup wizard writing the account, and `PATCH` is the settings
 * screen writing the colours. A second route would repeat the pool, the log
 * line and the message that names no host.
 *
 * NOTHING HERE RETURNS `password_hash`. `readAccount` names its columns and
 * that column is not among them, so no shape of this handler can leak it.
 * `test/account-read.test.ts` asserts the exact key set.
 *
 * EVERY FIELD IS CHECKED HERE, not only on the form. A request body is a trust
 * boundary, and the screens that post to it are the only callers today rather
 * than the only callers possible. The rules come from `lib/password.ts` and
 * `lib/email.ts`, which the forms use, so the two cannot state different rules.
 *
 * This route authenticates nobody, because nothing does yet. ADR-0009 gives the
 * installation a password and a hash to check it against; the session that
 * would gate this handler belongs to the story that builds sign-in.
 */
import { NextResponse } from "next/server";

import { isSelection } from "@/lib/appearance";
import { db } from "@/lib/db";
import { looksLikeEmail } from "@/lib/email";
import { passes } from "@/lib/password";
import {
  readAccount,
  readAppearance,
  writeAccount,
  writeAppearance,
} from "@/lib/owner";
import { hash } from "../../../../../../src/auth/password.ts";

/** The reason goes to the server's log and never to the browser: a connection
 *  error names the host, the database and the user. */
function refused(what: string, cause: unknown): Response {
  console.error(`${what}:`, cause);
  return NextResponse.json(
    { error: "The database did not answer." },
    { status: 503 }
  );
}

const named = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 2;

export async function GET(): Promise<Response> {
  try {
    const pool = db();
    const [account, appearance] = await Promise.all([
      readAccount(pool),
      readAppearance(pool),
    ]);
    return NextResponse.json({ account, appearance });
  } catch (cause) {
    return refused("account", cause);
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body) {
    return NextResponse.json({ error: "Send a JSON body." }, { status: 400 });
  }

  const { name, email, assistant, password } = body;
  if (!named(name)) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (typeof email !== "string" || !looksLikeEmail(email)) {
    return NextResponse.json(
      { error: "Enter an email address." },
      { status: 400 }
    );
  }
  if (!named(assistant)) {
    return NextResponse.json(
      { error: "Give the assistant a name." },
      { status: 400 }
    );
  }
  // The four rules live in `lib/password.ts` and are stated nowhere else. The
  // message names no rule for the same reason: the form lists all four beside
  // the box, and a second wording here would drift from that one.
  if (typeof password !== "string" || !passes(password)) {
    return NextResponse.json(
      { error: "The password misses one of the rules." },
      { status: 400 }
    );
  }

  try {
    // The wizard overwrites, and it asks first. ADR-0009 makes it the only
    // writer of the account and requires it to refuse a second run; the screen
    // is where that refusal lives, because only the screen can ask.
    await writeAccount(db(), {
      name: name.trim(),
      email: email.trim(),
      assistant: assistant.trim(),
      passwordHash: await hash(password),
    });
    return NextResponse.json({ ok: true });
  } catch (cause) {
    // The password is never in `cause`: `hash` takes it and returns a hash, and
    // the statement below carries only that hash.
    return refused("account write", cause);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    appearance?: unknown;
  } | null;

  if (!body || !isSelection(body.appearance)) {
    return NextResponse.json(
      { error: "That is not a set of colours this build offers." },
      { status: 400 }
    );
  }

  try {
    await writeAppearance(db(), body.appearance);
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return refused("appearance write", cause);
  }
}
