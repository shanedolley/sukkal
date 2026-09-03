/**
 * Signing in, and signing out.
 *
 * It sits at `app/api/session`, outside the `(app)` group, because the gate
 * guarding `(app)` would refuse the request that opens a session. `proxy.ts`
 * names this path public for the same reason, and says so.
 *
 * ADR-0023 makes this the only way in on any installation. There is no header
 * to read and no second path, so what happens here is the whole of
 * authentication.
 *
 * A RUN OF FAILURES BUYS A WAIT, AND NEVER A LOCK. KPA-78 names the hazard
 * running both ways: an attacker needs one password, and a lockout on the only
 * account is a denial of service against the only person who can use the
 * system. So a run costs a growing pause in front of the next attempt, capped
 * at eight seconds, and a correct password works at every point in the run.
 * `src/auth/attempts.ts` holds the sums and the measurement behind them.
 *
 * EVERY ATTEMPT REACHES THE AUDIT LOG, allowed and refused. KPA-78 asks for it
 * and gives the reason: a sign-in is the highest-value event on the box.
 */
import { NextResponse } from "next/server";

import {
  cleared,
  failed,
  record,
  sleep,
  standing,
} from "../../../../../src/auth/attempts.ts";
import { verify } from "../../../../../src/auth/password.ts";
import { COOKIE, end, issue, LIFETIME_DAYS } from "../../../../../src/auth/session.ts";
import { db } from "@/lib/db";

/**
 * How long the browser keeps the cookie, in seconds.
 *
 * It matches the row's own lifetime. A cookie outliving its row would send a
 * token that reaches nothing, and a cookie dying first would sign somebody out
 * while the server still held the session.
 */
const COOKIE_SECONDS = LIFETIME_DAYS * 24 * 60 * 60;

/** What every refusal answers, whatever went wrong. */
function refuse(): Response {
  return NextResponse.json(
    { error: "That email and password do not match." },
    { status: 401 },
  );
}

/**
 * Signs in, or refuses.
 *
 * ONE ANSWER FOR EVERY FAILURE. A wrong address and a wrong password read the
 * same, because telling them apart tells somebody which half to keep guessing.
 * `forgot-password-form.tsx` already keeps that rule on its own screen.
 *
 * THE PASSWORD IS VERIFIED AGAINST THE HASH AND NOTHING ELSE. `readAccount` in
 * `lib/owner.ts` names its columns and never returns the hash, so this reads
 * it deliberately, here, and nowhere a screen can reach.
 *
 * A NEW SESSION EVERY TIME. `issue` mints a token this process has never seen,
 * so a token planted in a browser before a sign-in is not the token that
 * follows one.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const email = typeof body?.["email"] === "string" ? body["email"] : "";
  const password = typeof body?.["password"] === "string" ? body["password"] : "";
  const from =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const client = await db().connect();
  try {
    const now = new Date();

    // An empty box counts as a failure and reaches the log, because a hundred
    // of them is an attack whether or not anything was typed. It skips the
    // hash, which nothing can learn from: the wait was already served.
    if (email.trim() === "" || password === "") {
      await sleep((await standing(client, now)).waitSeconds);
      const run = await failed(client, now);
      await record(
        client,
        {
          email,
          from,
          ok: false,
          result: `Refused. The form was incomplete. ${String(run.failures)} in a row, so the next attempt waits ${String(run.waitSeconds)}s.`,
        },
        now,
      );
      return refuse();
    }

    // THE WAIT COMES FIRST, so a run of failures costs the time whether the
    // password turns out to be right or wrong. Waiting only on a failure would
    // let an attacker measure the difference and read it as "that one was
    // closer", and it would leave the hash running at full rate meanwhile.
    await sleep((await standing(client, now)).waitSeconds);

    // `lower(email)` is what migration 017 indexes, so this read matches the
    // way the row is unique and a capital letter signs the same person in.
    const found = await client.query<{ id: string; password_hash: string | null }>(
      "SELECT id, password_hash FROM users WHERE lower(email) = lower($1)",
      [email.trim()],
    );

    const row = found.rows[0];
    // `verify` runs even when no row matched, against null, so a missing
    // account costs the same time as a wrong password. Answering early here
    // would tell somebody which addresses exist.
    const ok = await verify(password, row?.password_hash ?? null);
    if (!ok || !row) {
      const run = await failed(client, now);
      await record(
        client,
        {
          email,
          from,
          ok: false,
          // The log may name what the answer may not. Nothing here reaches the
          // browser: `refuse` says one sentence for every failure.
          result: `Refused. ${row ? "The password did not match." : "No account holds that address."} ${String(run.failures)} in a row, so the next attempt waits ${String(run.waitSeconds)}s.`,
        },
        now,
      );
      return refuse();
    }

    // The run ends here, so a person who mistyped twice and then got it right
    // pays nothing on the next sign-in.
    await cleared(client);

    const { token } = await issue(client, row.id, now, {
      userAgent: request.headers.get("user-agent"),
      from,
    });

    await record(
      client,
      {
        email,
        from,
        ok: true,
        result: `Signed in. The session lasts ${String(LIFETIME_DAYS)} days.`,
      },
      now,
    );

    const answer = NextResponse.json({ ok: true });
    answer.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_SECONDS,
    });
    return answer;
  } finally {
    client.release();
  }
}

/**
 * Signs out, on the server.
 *
 * The row goes, so a browser that keeps the cookie finds nothing behind it.
 * Clearing the cookie is courtesy rather than security: the delete is what
 * ends the session.
 */
export async function DELETE(request: Request): Promise<Response> {
  const token = request.headers
    .get("cookie")
    ?.split(";")
    .map((one) => one.trim())
    .find((one) => one.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

  if (token) {
    const client = await db().connect();
    try {
      await end(client, token);
    } finally {
      client.release();
    }
  }

  const answer = NextResponse.json({ ok: true });
  answer.cookies.set(COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return answer;
}
