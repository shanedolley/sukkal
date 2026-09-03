/**
 * Setting a new password: with a token, or with a command on the server.
 *
 * ADR-0023 made the local account the only gate on every installation, so
 * there is no second door and nobody to open one. ADR-0009 named the harder
 * half: a fresh installation has no mail relay, so a link has nowhere to go.
 * This module carries both routes to a new password and one place that writes
 * it.
 *
 * `setPassword` IS THE ONLY WRITER, and both routes end there. A second place
 * that hashed a password would be a second place to forget the sessions.
 *
 * EVERY SESSION ENDS. A password is reset by somebody who thinks control of
 * the account was lost, so leaving the other browser signed in makes the reset
 * theatre. `endAll` in `session.ts` says the same thing from its side, and
 * `POST /api/account` calls it for the same reason when the wizard runs again.
 *
 * `now` is an argument everywhere, never a call to `Date.now()` inside a
 * function. A token expires because a moment passed, so a test has to hold
 * that moment still. `session.ts` and `src/memory/sweep.ts` take theirs the
 * same way.
 *
 * NOTHING HERE SENDS MAIL. `mailSender` answers which connection would carry
 * it, which is the question KPA-79 asks: a relay read out of the environment
 * is a relay nobody configured and nobody can see. Reaching Gmail or Graph
 * needs an OAuth grant this installation does not hold, so the token reaches
 * its owner through `scripts/reset-password.sh` today.
 */
import { randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';

import { hash } from './password.ts';
import { endAll, fingerprint } from './session.ts';

/**
 * How long a reset token lasts, in minutes.
 *
 * An hour, which is what the screen has promised since KPA-37. It is short
 * because the token is a password that somebody else may be racing for: the
 * account is already in a state where control is in question.
 */
export const LIFETIME_MINUTES = 60;

/** 32 bytes, which is 256 bits of entropy. Nothing brute-forces that. */
const TOKEN_BYTES = 32;

/** The one row. `users_one_owner_per_installation` holds the table at id 1. */
export const OWNER = '1';

/** What the browser told us about itself. It authenticates nothing. */
export interface Caller {
  from?: string | null;
}

/** A token, and when it stops working. The token is returned once. */
export interface Issued {
  token: string;
  ownerId: string;
  expiresAt: Date;
}

/**
 * A reset token for whoever holds `email`, or null when nobody does.
 *
 * The caller must answer the same thing either way. `POST /api/reset` does,
 * and `forgot-password-form.tsx` has said so on the screen since KPA-37:
 * naming which addresses hold accounts is a list worth having if you are the
 * wrong sort of person.
 *
 * The delete before the insert is what keeps one live token per owner. Asking
 * twice replaces the first key rather than leaving two under the mat, and it
 * is what bounds the table when a stranger asks repeatedly.
 *
 * `lower(email)` is what migration 017 indexes, so a capital letter reaches
 * the same account it signs in.
 */
export async function request(
  client: ClientBase,
  email: string,
  now: Date,
  caller: Caller = {},
): Promise<Issued | null> {
  const found = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [email.trim()],
  );

  const row = found.rows[0];
  if (row === undefined) return null;

  return issueFor(client, row.id, now, caller);
}

/**
 * A reset token for an owner already known, by id.
 *
 * `scripts/reset-password.sh` calls this: a person at the server's own command
 * line has proved more than any address could, so asking them to type the one
 * on the account proves nothing.
 */
export async function issueFor(
  client: ClientBase,
  ownerId: string,
  now: Date,
  caller: Caller = {},
): Promise<Issued> {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + LIFETIME_MINUTES * 60 * 1000);

  await client.query('DELETE FROM password_resets WHERE owner_id = $1', [ownerId]);
  await client.query(
    `INSERT INTO password_resets (id, owner_id, created_at, expires_at, requested_from)
     VALUES ($1, $2, $3, $4, $5)`,
    [fingerprint(token), ownerId, now, expiresAt, caller.from ?? null],
  );

  return { token, ownerId, expiresAt };
}

/** Why a token was refused, for a caller that has to say something. */
export type Refusal = 'unknown' | 'expired';

/**
 * Sets a new password against a token, and ends every session.
 *
 * THE DELETE IS THE CLAIM. One statement takes the row and returns it, so two
 * requests carrying the same token race for something only one of them gets.
 * A column read first and written after would let both through.
 *
 * An expired row is claimed and thrown away rather than left standing. It was
 * going to be swept anyway, and a token whose moment has passed has no second
 * chance to earn.
 *
 * The two refusals are told apart here and nowhere a stranger can read. A
 * token is 256 bits, so "expired" tells somebody holding one that they held a
 * real one, which they already knew.
 */
export async function spend(
  client: ClientBase,
  token: string,
  password: string,
  now: Date,
): Promise<{ ownerId: string } | { refused: Refusal }> {
  if (!token || token.trim() === '') return { refused: 'unknown' };

  const claimed = await client.query<{ owner_id: string; expires_at: Date }>(
    'DELETE FROM password_resets WHERE id = $1 RETURNING owner_id, expires_at',
    [fingerprint(token)],
  );

  const row = claimed.rows[0];
  if (row === undefined) return { refused: 'unknown' };
  if (row.expires_at.getTime() <= now.getTime()) return { refused: 'expired' };

  await setPassword(client, row.owner_id, password);
  return { ownerId: row.owner_id };
}

/**
 * Writes the password and ends every session the owner holds.
 *
 * Both routes to a new password end here, and the command line calls it with
 * no token at all. It answers how many sessions it closed, because that is
 * the sentence the command line prints and the number a person checks.
 *
 * IT ENDS THE RUN OF FAILED SIGN-INS TOO, in the same statement. Somebody
 * resetting a password is exactly the person who has just failed to sign in
 * several times, and KPA-78's wait would meet them on the way back. Clearing
 * it here rather than importing `attempts.ts` keeps the two modules from
 * importing each other, and the columns belong to the row this already writes.
 */
export async function setPassword(
  client: ClientBase,
  ownerId: string,
  password: string,
): Promise<number> {
  await client.query(
    `UPDATE users
        SET password_hash = $2, sign_in_failures = 0, sign_in_failed_at = NULL
      WHERE id = $1`,
    [ownerId, await hash(password)],
  );
  return endAll(client, ownerId);
}

/**
 * There is no sweep here, and `sessions` needing one is what says why.
 *
 * `password_resets_one_per_owner` holds this table at one row per account, and
 * `issueFor` deletes before it inserts, so an expired row is replaced by the
 * next request rather than accumulating. `spend` already refuses it in the
 * meantime. A sweep would free one row.
 */

/** A connection that could carry the mail, as this module needs it. */
export interface MailSender {
  id: string;
  provider: string;
  name: string;
}

/**
 * Which configured connection would send the reset mail, or null.
 *
 * KPA-79 asks that the sender be a connection somebody configured rather than
 * a relay read out of the environment. A hardcoded relay is a credential in a
 * variable, invisible on the Connections screen, undated, and unverifiable by
 * `src/connections/verify.ts`. This asks the same table every other outbound
 * reach asks.
 *
 * A sender needs a stored secret, because a connection with none is a card
 * somebody started filling in. `hasSecret` is the column that says so, and
 * `src/connections/store.ts` keeps the bytes on the far side of `secretFor`.
 *
 * NULL IS THE ORDINARY ANSWER, and ADR-0009 says why: a fresh installation has
 * nothing configured. The command line is the way in on such a box, and the
 * request screen answers what it always answers.
 */
export async function mailSender(client: ClientBase): Promise<MailSender | null> {
  const found = await client.query<{ id: string; provider: string; name: string }>(
    `SELECT c.id::text AS id, c.provider, c.name
       FROM connections c
       JOIN connection_credentials k ON k.connection = c.id
      WHERE (c.provider = 'google'    AND 'gmail'   = ANY (c.services))
         OR (c.provider = 'microsoft' AND 'outlook' = ANY (c.services))
      ORDER BY c.created_at, c.id
      LIMIT 1`,
  );

  return found.rows[0] ?? null;
}
