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
 * IT IS PUBLIC ON A BOX WITH NO ACCOUNT, AND GUARDED THE MOMENT ONE EXISTS.
 * `proxy.ts` cannot make that distinction, because the answer is a row rather
 * than a path, so the rule lives here. ADR-0009 requires the wizard to refuse a
 * second run and put that refusal on a screen; the screen is what a person
 * reads, and this is what a stranger meets. Without it a single unauthenticated
 * POST rewrites the owner's password and takes the installation, which would
 * make the gate ADR-0023 built a picture of one.
 *
 * WRITING THE ACCOUNT SIGNS THE PERSON IN. They chose the password one line
 * above, so asking for it again proves nothing, and every screen the wizard
 * offers at the end is behind the gate.
 */
import { NextResponse } from "next/server";

import { isSelection } from "@/lib/appearance";
import { db } from "@/lib/db";
import { looksLikeEmail } from "@/lib/email";
import { passes } from "@/lib/password";
import {
  OWNER,
  readAccount,
  readAppearance,
  writeAccount,
  writeAppearance,
} from "@/lib/owner";
import { currentSession } from "@/lib/session";
import { hash } from "../../../../../../src/auth/password.ts";
import {
  COOKIE,
  endAll,
  issue,
  LIFETIME_DAYS,
} from "../../../../../../src/auth/session.ts";

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

/**
 * The account, to whoever proved they own it.
 *
 * A stranger gets the same answer a fresh box gives: nothing is set up here.
 * The row holds the owner's name, their email and the colours they chose, and
 * the email is half of what KPA-78's guessing attack needs. Handing it to
 * anybody who can reach the door saves the attacker the first half.
 *
 * The sign-in form asks nothing of this route, so nothing on the way in breaks
 * by being told null. `app/(app)/layout.tsx` reads it behind the gate, where a
 * session always exists.
 */
export async function GET(): Promise<Response> {
  try {
    if (!(await currentSession())) {
      return NextResponse.json({ account: null, appearance: null });
    }

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

  const pool = db();
  try {
    // The wizard overwrites, and it asks first. ADR-0009 makes it the only
    // writer of the account and requires it to refuse a second run; the screen
    // is where that refusal is worded, and this is where it is enforced.
    //
    // ONE ACCOUNT MEANS ONE CLAIM. On a box nobody has set up, whoever reaches
    // it first owns it, which is what "created on first boot" means and what
    // ADR-0009 accepted. Once the row is written, only the owner may write it
    // again, and the owner is whoever holds a session.
    const existing = await readAccount(pool);
    if (existing && !(await currentSession())) {
      return NextResponse.json(
        { error: "This installation is already set up. Sign in first." },
        { status: 401 }
      );
    }

    await writeAccount(pool, {
      name: name.trim(),
      email: email.trim(),
      assistant: assistant.trim(),
      passwordHash: await hash(password),
    });

    // The password was chosen in the request that just landed, so this is the
    // one place a session may be issued without one being typed again.
    const client = await pool.connect();
    let token: string;
    try {
      // Setting a password ends every session that was open under the old one.
      // `endAll` says why: a password changes when somebody thinks control of
      // the account was lost, and leaving the other browser signed in would
      // make the change theatre. The caller's own session goes with them and
      // the one issued below replaces it.
      await endAll(client, String(OWNER));
      ({ token } = await issue(client, String(OWNER), new Date(), {
        userAgent: request.headers.get("user-agent"),
        from:
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      }));
    } finally {
      client.release();
    }

    const answer = NextResponse.json({ ok: true });
    answer.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: LIFETIME_DAYS * 24 * 60 * 60,
    });
    return answer;
  } catch (cause) {
    // The password is never in `cause`: `hash` takes it and returns a hash, and
    // the statement above carries only that hash.
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
