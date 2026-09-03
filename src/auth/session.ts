/**
 * Issuing a session, reading one, and ending one.
 *
 * ADR-0023 makes the application the only gate on every installation, so this
 * is what stands between somebody and three mailboxes holding employer
 * customer material. `src/auth/password.ts` proves who is asking once. This
 * carries that answer to the next request.
 *
 * THE TOKEN LEAVES THIS MODULE ONCE AND IS NEVER STORED. `issue` returns it,
 * the caller puts it in a cookie, and the row holds a SHA-256 of it. So a
 * copy of the table signs nobody in, and nothing here can tell a caller what
 * a stored session's token was. `docs/runbooks/secrets.md` keeps the same rule
 * for every other secret this project holds.
 *
 * SHA-256 RATHER THAN SCRYPT, AND THE REASON IS NOT SPEED. ADR-0020 chose
 * scrypt at 128 MiB for a password, because a person picks one and picks
 * badly, so an attacker with the hash runs a dictionary. A token is 32 bytes
 * from `randomBytes`. There is no dictionary, and no work factor makes 256
 * bits of entropy harder to guess. Hashing it defends the stolen-database
 * case, which is the only case there is.
 *
 * `now` is an argument everywhere, never a call to `Date.now()` inside a
 * function. A session expires because a moment passed, so a test has to hold
 * that moment still, and `src/memory/sweep.ts` takes its day the same way.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ClientBase } from 'pg';

/**
 * How long one sign-in lasts, in days.
 *
 * KPA-77 requires this to be chosen rather than defaulted, and fourteen is the
 * choice. A box holding employer customer material is not a shopping site, and
 * a fortnight is long enough that nobody types a password often and short
 * enough that a stolen cookie dies inside one.
 *
 * IT DOES NOT SLIDE. Nothing moves `expires_at` after the row is written. A
 * sliding window renews a session on use, and use is exactly what a thief
 * does, so a stolen cookie would live for as long as it stayed worth stealing.
 * Raising this number is a decision about that trade rather than a comfort
 * setting.
 */
export const LIFETIME_DAYS = 14;

/** The cookie the browser carries. Named for the product, not the framework,
 *  so nothing infers a library from it. */
export const COOKIE = 'kpa_session';

/** 32 bytes, which is 256 bits of entropy. Nothing brute-forces that. */
const TOKEN_BYTES = 32;

/** One session, as a caller may see it. The token is not among these. */
export interface Session {
  id: string;
  ownerId: string;
  createdAt: Date;
  expiresAt: Date;
}

/** What the browser told us about itself. Neither field authenticates. */
export interface Caller {
  userAgent?: string | null;
  from?: string | null;
}

/** The SHA-256 of a token, hex. The column holds this and never the token. */
export function fingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * A new session, and the token that reaches it.
 *
 * The token is returned once and stored nowhere. A caller that loses it has
 * lost the session, which is the property that makes the table safe to copy.
 *
 * Every sign-in calls this, so every sign-in gets an identifier the caller has
 * never seen. That is what stops a fixed session being planted before the
 * fact: a token an attacker chose is not the token this returns.
 */
export async function issue(
  client: ClientBase,
  ownerId: string,
  now: Date,
  caller: Caller = {},
): Promise<{ token: string; session: Session }> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + LIFETIME_DAYS * 24 * 60 * 60 * 1000);

  const written = await client.query<{
    id: string;
    owner_id: string;
    created_at: Date;
    expires_at: Date;
  }>(
    `INSERT INTO sessions (id, owner_id, created_at, expires_at, user_agent, signed_in_from)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, owner_id, created_at, expires_at`,
    [
      fingerprint(token),
      ownerId,
      now,
      expiresAt,
      caller.userAgent ?? null,
      caller.from ?? null,
    ],
  );

  const row = written.rows[0];
  if (row === undefined) throw new Error('the session insert returned no row.');

  return {
    token,
    session: {
      id: row.id,
      ownerId: row.owner_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    },
  };
}

/**
 * The live session a token reaches, or null.
 *
 * Null covers every way a request fails to prove itself: no token, a token
 * naming no row, and a row whose moment has passed. A caller that wants to
 * tell those apart is a caller telling an attacker which guess was closer.
 *
 * The expiry is compared here rather than in SQL so `now` stays an argument.
 * An expired row is left for `sweepExpired` rather than deleted on read: a
 * read that writes turns every page load into a write, and a session already
 * refused does no harm sitting there.
 */
export async function read(
  client: ClientBase,
  token: string | undefined | null,
  now: Date,
): Promise<Session | null> {
  if (!token || token.trim() === '') return null;

  const found = await client.query<{
    id: string;
    owner_id: string;
    created_at: Date;
    expires_at: Date;
  }>(
    'SELECT id, owner_id, created_at, expires_at FROM sessions WHERE id = $1',
    [fingerprint(token)],
  );

  const row = found.rows[0];
  if (row === undefined) return null;
  if (row.expires_at.getTime() <= now.getTime()) return null;

  return {
    id: row.id,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Ends one session on the server, and answers whether it existed.
 *
 * The delete is what makes it revocable. A browser that keeps the cookie finds
 * nothing behind it on the next request, so signing out is not a thing the
 * browser is trusted to do.
 */
export async function end(client: ClientBase, token: string): Promise<boolean> {
  const gone = await client.query('DELETE FROM sessions WHERE id = $1', [
    fingerprint(token),
  ]);
  return (gone.rowCount ?? 0) > 0;
}

/**
 * Ends every session an owner holds, and answers how many.
 *
 * A password reset calls this, because a reset is what somebody does after
 * losing control of the account, and leaving the thief's session open would
 * make the reset theatre. KPA-79 owns that path.
 */
export async function endAll(client: ClientBase, ownerId: string): Promise<number> {
  const gone = await client.query('DELETE FROM sessions WHERE owner_id = $1', [ownerId]);
  return gone.rowCount ?? 0;
}

/**
 * Removes what has run out, and answers how many.
 *
 * `read` already refuses an expired row, so this frees space rather than
 * closing a hole. The nightly worker is where it belongs.
 */
export async function sweepExpired(client: ClientBase, now: Date): Promise<number> {
  const gone = await client.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
  return gone.rowCount ?? 0;
}

/**
 * Whether two tokens are the same, in constant time.
 *
 * Nothing in this module needs it today, because a lookup is by fingerprint
 * and a miss is a miss. It is here for a caller comparing a token to one it
 * already holds, so that caller does not reach for `===` and leak the length
 * of the match. `src/webhooks/receive.ts` keeps the same rule for a signature.
 */
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(fingerprint(a), 'hex');
  const right = Buffer.from(fingerprint(b), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}
