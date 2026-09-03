/**
 * Asking for a password reset, and spending the token that answers.
 *
 * It sits beside `app/api/session`, outside the `(app)` group, because a
 * person who cannot sign in is exactly who calls it. `proxy.ts` names the path
 * public for that reason, and says so.
 *
 * `POST` asks. `PUT` sets the new password. One route for one subject, the way
 * `/api/session` holds signing in and signing out.
 *
 * ASKING ALWAYS ANSWERS THE SAME THING. A reply that differed would name which
 * addresses hold accounts on this installation, and one account is the whole
 * of what this box has. `forgot-password-form.tsx` has said the same sentence
 * on the screen since KPA-37, and `src/auth/reset.ts` returns null rather than
 * throwing so this handler cannot accidentally tell them apart.
 *
 * NOTHING SENDS MAIL YET, and the token therefore reaches its owner through
 * `scripts/reset-password.sh --link`. `mailSender` is what decides where it
 * would go: KPA-79 asks that the sender be a connection somebody configured
 * rather than a relay read out of the environment.
 */
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { looksLikeEmail } from "@/lib/email";
import { passes } from "@/lib/password";
import { mailSender, request as requestReset, spend } from "../../../../../src/auth/reset.ts";

/** The reason goes to the server's log and never to the browser: a connection
 *  error names the host, the database and the user. */
function refused(what: string, cause: unknown): Response {
  console.error(`${what}:`, cause);
  return NextResponse.json(
    { error: "The database did not answer." },
    { status: 503 }
  );
}

/** What asking answers, whatever happened. */
const ASKED = { ok: true } as const;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const email = typeof body?.["email"] === "string" ? body["email"] : "";

  // A malformed address is answered the same way, because the form already
  // said what a well-formed one looks like and a second refusal here would be
  // a second thing to tell apart.
  if (!looksLikeEmail(email)) return NextResponse.json(ASKED);

  const client = await db().connect();
  try {
    const issued = await requestReset(client, email, new Date(), {
      from: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

    if (issued) {
      const sender = await mailSender(client);
      // The log is the server's own, and the token is not in this line. On a
      // box with nothing configured this is the whole record that somebody
      // asked, and the owner reaches the link with the command instead.
      console.log(
        sender
          ? `reset: a token was issued. ${sender.provider} connection "${sender.name}" would carry it, and nothing sends yet.`
          : "reset: a token was issued. No mail connection is configured, so run scripts/reset-password.sh --link on the server."
      );
    }

    return NextResponse.json(ASKED);
  } catch (cause) {
    // Even a failure answers the same way. A 503 on a known address and a 200
    // on an unknown one is the difference this route exists to hide.
    console.error("reset request:", cause);
    return NextResponse.json(ASKED);
  } finally {
    client.release();
  }
}

/**
 * Sets the new password against a token.
 *
 * The two refusals are told apart for the person holding the link, and neither
 * tells a stranger anything: a token is 256 bits, so somebody who learns that
 * theirs expired already knew they held a real one.
 *
 * `spend` ends every session the owner had open, and this issues none. Signing
 * in with the new password is the next thing they do, which is what proves the
 * reset worked.
 */
export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const token = typeof body?.["token"] === "string" ? body["token"] : "";
  const password = typeof body?.["password"] === "string" ? body["password"] : "";

  // The rules live in `lib/password.ts` and are stated nowhere else. The
  // message names no rule for the same reason the account route's does not:
  // the form lists all four beside the box.
  if (!passes(password)) {
    return NextResponse.json(
      { error: "The password misses one of the rules." },
      { status: 400 }
    );
  }

  const client = await db().connect();
  try {
    const done = await spend(client, token, password, new Date());
    if ("refused" in done) {
      return NextResponse.json(
        {
          error:
            done.refused === "expired"
              ? "That link has expired. Ask for another one."
              : "That link has been used already, or it is not a link this box issued.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (cause) {
    return refused("reset", cause);
  } finally {
    client.release();
  }
}
