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
 */
import { NextResponse } from "next/server";

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

  if (email.trim() === "" || password === "") return refuse();

  const client = await db().connect();
  try {
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
    if (!ok || !row) return refuse();

    const { token } = await issue(client, row.id, new Date(), {
      userAgent: request.headers.get("user-agent"),
      from: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });

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
