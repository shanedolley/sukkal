/**
 * What the web tier asks about a session, and what a route calls to be sure.
 *
 * `src/auth/session.ts` owns the rules and takes a client. This takes the pool
 * the web tier already has, the way `lib/owner.ts` does, so a route or the
 * proxy asks one question and gets an answer.
 *
 * `requireOwner` is the check every handler makes for itself. The proxy is the
 * outer gate and Next's own documentation says not to lean on it alone: a
 * matcher change or a moved Server Function can silently remove its coverage.
 * Two checks, and neither assumes the other held.
 */
import { cookies } from "next/headers";

import { COOKIE, read, type Session } from "../../../src/auth/session.ts";
import { db } from "./db";

/** The live session a token reaches, or null. `now` is read once, here, so
 *  every caller in one request agrees about the moment. */
export async function sessionFor(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  const client = await db().connect();
  try {
    return await read(client, token, new Date());
  } finally {
    client.release();
  }
}

/**
 * The session behind the current request, read from the cookie jar.
 *
 * For a Server Component or a Server Function, which have a cookie jar rather
 * than a request object.
 */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  return sessionFor(jar.get(COOKIE)?.value);
}

/**
 * The signed-in owner, or a thrown refusal.
 *
 * A route calls this rather than trusting that the proxy ran. It throws rather
 * than returning null, because a caller that forgets to check a null carries
 * on unauthenticated, and a caller that forgets to catch this does not.
 */
export async function requireOwner(): Promise<Session> {
  const session = await currentSession();
  if (!session) throw new Error("Sign in first.");
  return session;
}
