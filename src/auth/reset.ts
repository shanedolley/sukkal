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
 * `deliver` SENDS, AND IT NEVER THROWS. KPA-143 asks that a failure to send be
 * a line in the server's log and never a different answer on the screen, so
 * every path returns a `Delivery` and the caller logs the line it names. A
 * relay read out of the environment is a relay nobody configured and nobody
 * can see, so the sender is a connection instead and `mailSender` chooses it.
 * `src/connections/verify.ts` is the shape followed here: take the fetcher as
 * an argument, and answer with a verdict rather than a throw.
 */
import { randomBytes } from 'node:crypto';
import type { ClientBase } from 'pg';

import { installationUrl } from '../connections/oauth.ts';
import { secretFor } from '../connections/store.ts';
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
 * RESEND OUTRANKS THE OTHER TWO, because it is the only one that sends. A
 * Gmail or Graph send needs the OAuth mail scopes KPA-103 and KPA-105 carry,
 * and neither has landed, so a box holding both connections would pick one
 * that mails nothing. Revisit the order when a second sender can actually
 * send, and prefer whichever the owner reads mail at then.
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
      WHERE c.provider = 'resend'
         OR (c.provider = 'google'    AND 'gmail'   = ANY (c.services))
         OR (c.provider = 'microsoft' AND 'outlook' = ANY (c.services))
      ORDER BY (c.provider <> 'resend'), c.created_at, c.id
      LIMIT 1`,
  );

  return found.rows[0] ?? null;
}

/** Where Resend takes one message. A POST and a bearer header, which Node's
 *  own `fetch` carries, so nothing was added to the package for this. */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** What the mail says. It names the account nowhere: see `deliver`. */
const SUBJECT = 'Set a new password';

/** What one attempt to send came to. `ok` is false only when something broke,
 *  so a box with no sender reads as true and logs the way in instead. */
export interface Delivery {
  ok: boolean;
  /** One line for the server's log. It carries no token and no key. */
  log: string;
}

/** The reason a thrown error gave. It names a fault and never a credential. */
function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The mail's body, which is the link and nothing else about the account.
 *
 * A reset mail naming the owner confirms the address to whoever received it,
 * and whoever received it is not always the owner: the address may have been
 * typed wrong, or read by somebody the mailbox is shared with. So there is no
 * name, no address and no hint of which account this is. The link proves
 * nothing until it is spent, and it lasts an hour.
 */
function body(link: string): string {
  return [
    `<p><a href="${link}">Set a new password</a></p>`,
    '<p>The link lasts an hour and works once.</p>',
    '<p>If you did not ask for it, nothing has changed and you can ignore this.</p>',
  ].join('');
}

/**
 * Sends the link `token` spends to `to`, and says what happened.
 *
 * IT NEVER THROWS, which is the fourth criterion on KPA-143: the screen answers
 * the same thing whatever the vendor said, so the only trace of a failure is
 * the line this returns. A refused key, a vendor that is down, sealed bytes
 * that will not open and a connection whose credential vanished between the
 * two reads are all answers rather than exceptions.
 *
 * THE ADDRESS IN `from` IS THE CONNECTION'S NAME. Resend accepts a bare
 * address or `Name <address>`, and the Connections screen already asks for a
 * name on every card holding a key. Google and Microsoft name a connection
 * after the account that consented, so a card naming the address it sends as
 * is the same rule rather than a new field and a new column.
 *
 * `installationUrl` is what the link points at, so the address is configured
 * rather than read off a request header. `SUKKAL_URL` already held it for the
 * OAuth callback, and the reason is the same: a value taken from
 * `x-forwarded-host` is a value a stranger chose.
 *
 * `fetcher` is an argument so a test drives every answer Resend can give.
 */
export async function deliver(
  client: ClientBase,
  to: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Delivery> {
  const sender = await mailSender(client);
  if (sender === null) {
    return {
      ok: true,
      log: 'reset: a token was issued. No mail connection is configured, so run scripts/reset-password.sh --link on the server.',
    };
  }

  if (sender.provider !== 'resend') {
    return {
      ok: true,
      log: `reset: a token was issued. The ${sender.provider} connection "${sender.name}" would carry it, and nothing sends through ${sender.provider} yet. Run scripts/reset-password.sh --link on the server.`,
    };
  }

  let key: string | null;
  try {
    key = await secretFor(client, sender.id);
  } catch (cause) {
    return {
      ok: false,
      log: `reset: the Resend key on "${sender.name}" will not open: ${reason(cause)}`,
    };
  }
  // `mailSender` joins the credential, so this is a row removed between the
  // two reads rather than a card somebody left half filled in.
  if (key === null) {
    return { ok: false, log: `reset: the Resend connection "${sender.name}" holds no key.` };
  }

  try {
    const answer = await fetcher(RESEND_ENDPOINT, {
      method: 'POST',
      // The key goes in a header and never in the url, for the reason
      // `src/connections/verify.ts` gives: a url reaches two access logs.
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: sender.name,
        to: [to],
        subject: SUBJECT,
        html: body(`${installationUrl()}/reset?token=${token}`),
      }),
    });

    if (!answer.ok) {
      return {
        ok: false,
        log: `reset: Resend answered ${String(answer.status)} and the link did not send. Run scripts/reset-password.sh --link on the server.`,
      };
    }
    return { ok: true, log: 'reset: a token was issued and Resend accepted the link.' };
  } catch (cause) {
    return {
      ok: false,
      log: `reset: Resend could not be reached: ${reason(cause)}. Run scripts/reset-password.sh --link on the server.`,
    };
  }
}
