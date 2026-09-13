/**
 * Resetting a forgotten password.
 *
 * The three KPA-79 asks for are here by name: a used token fails, an expired
 * one fails, and a reset ends a session that was open. `now` is an argument to
 * every call, so an hour passes in one line and no test waits for a clock.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { hash, verify } from '../src/auth/password.ts';
import {
  LIFETIME_MINUTES,
  issueFor,
  mailSender,
  request,
  setPassword,
  spend,
} from '../src/auth/reset.ts';
import { fingerprint, issue, read } from '../src/auth/session.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The seeded owner, from migration 001. */
const OWNER = '1';
const EMAIL = 'shane@koinon.com.au';
const OLD = 'The-Old-Password9!!';
const NEW = 'A-Whole-New-Password9!';
const NOW = new Date('2026-09-03T00:00:00Z');

/** `minutes` after `NOW`, for a test that has to outlive a token. */
function later(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

describe('a password reset', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    await client.query('DELETE FROM password_resets');
    await client.query('DELETE FROM sessions');
    // An account, so `request` has an address to find. The four columns move
    // together, because `users_the_account_is_whole` refuses a subset.
    await client.query(
      `UPDATE users
          SET name = 'Shane Dolley', email = $2, assistant_name = 'Kestrel',
              password_hash = $3, created_at = now()
        WHERE id = $1`,
      [OWNER, EMAIL, await hash(OLD)],
    );
  });

  test('the row holds a fingerprint and never the token', async () => {
    const issued = await issueFor(client, OWNER, NOW);

    const { rows } = await client.query<{ id: string }>('SELECT id FROM password_resets');
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.id, fingerprint(issued.token));
    assert.notEqual(rows[0]?.id, issued.token);
    assert.match(rows[0]?.id ?? '', /^[0-9a-f]{64}$/);
  });

  test('it lasts an hour, and the hour is the one the screen promises', async () => {
    const issued = await issueFor(client, OWNER, NOW);
    assert.equal(issued.expiresAt.getTime() - NOW.getTime(), LIFETIME_MINUTES * 60 * 1000);
    assert.equal(LIFETIME_MINUTES, 60);
  });

  test('an address nobody holds issues nothing, and says so as null', async () => {
    const issued = await request(client, 'nobody@evil.example', NOW);
    assert.equal(issued, null);

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 0, 'a stranger left a row behind');
  });

  test('a capital letter reaches the same account it signs in', async () => {
    const issued = await request(client, 'Shane@Koinon.COM.AU', NOW);
    assert.notEqual(issued, null);
    assert.equal(issued?.ownerId, OWNER);
  });

  test('asking twice leaves one live token, and the first one stops working', async () => {
    const first = await issueFor(client, OWNER, NOW);
    const second = await issueFor(client, OWNER, NOW);

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 1, 'two keys were left under the mat');

    const stale = await spend(client, first.token, NEW, NOW);
    assert.deepEqual(stale, { refused: 'unknown' });

    const fresh = await spend(client, second.token, NEW, NOW);
    assert.deepEqual(fresh, { ownerId: OWNER });
  });

  test('a token works once, and the second use fails', async () => {
    const issued = await issueFor(client, OWNER, NOW);

    const first = await spend(client, issued.token, NEW, NOW);
    assert.deepEqual(first, { ownerId: OWNER }, 'the first use was refused');

    const again = await spend(client, issued.token, 'A-Third-Password9!!', NOW);
    assert.deepEqual(again, { refused: 'unknown' }, 'the token worked twice');

    // The second attempt changed nothing, so the password is still the one the
    // first attempt set.
    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    assert.equal(await verify(NEW, rows[0]?.password_hash ?? null), true);
  });

  test('an expired token fails, one minute after its hour', async () => {
    const issued = await issueFor(client, OWNER, NOW);

    const late = await spend(client, issued.token, NEW, later(LIFETIME_MINUTES + 1));
    assert.deepEqual(late, { refused: 'expired' });

    // The old password still stands, because nothing was written.
    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    assert.equal(await verify(OLD, rows[0]?.password_hash ?? null), true);
  });

  test('the last minute still works, and the first minute after does not', async () => {
    const inTime = await issueFor(client, OWNER, NOW);
    assert.deepEqual(
      await spend(client, inTime.token, NEW, later(LIFETIME_MINUTES - 1)),
      { ownerId: OWNER },
    );

    const onTheHour = await issueFor(client, OWNER, NOW);
    assert.deepEqual(
      await spend(client, onTheHour.token, NEW, later(LIFETIME_MINUTES)),
      { refused: 'expired' },
      'a token that expires at the hour worked at the hour',
    );
  });

  test('a token nobody issued fails', async () => {
    assert.deepEqual(await spend(client, 'not-a-token', NEW, NOW), { refused: 'unknown' });
    assert.deepEqual(await spend(client, '', NEW, NOW), { refused: 'unknown' });
  });

  test('a reset ends a session that was open', async () => {
    const open = await issue(client, OWNER, NOW);
    assert.notEqual(await read(client, open.token, NOW), null, 'the session never opened');

    const issued = await issueFor(client, OWNER, NOW);
    await spend(client, issued.token, NEW, NOW);

    assert.equal(
      await read(client, open.token, NOW),
      null,
      'the browser that was signed in stayed signed in',
    );
    const { rows } = await client.query('SELECT id FROM sessions');
    assert.equal(rows.length, 0, 'a session survived the reset');
  });

  test('the new password signs in and the old one does not', async () => {
    const issued = await issueFor(client, OWNER, NOW);
    await spend(client, issued.token, NEW, NOW);

    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    const stored = rows[0]?.password_hash ?? null;
    assert.equal(await verify(NEW, stored), true, 'the new password was refused');
    assert.equal(await verify(OLD, stored), false, 'the old password still works');
  });

  test('the command line sets a password with no token at all', async () => {
    // What `scripts/reset-password.sh` does. It answers how many sessions it
    // closed, which is the number the command prints.
    const open = await issue(client, OWNER, NOW);
    const ended = await setPassword(client, OWNER, NEW);

    assert.equal(ended, 1);
    assert.equal(await read(client, open.token, NOW), null);
    const { rows } = await client.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [OWNER],
    );
    assert.equal(await verify(NEW, rows[0]?.password_hash ?? null), true);
  });

  test('one row per owner is what the table holds, so nothing accumulates', async () => {
    // Why there is no sweep. `issueFor` deletes before it inserts and the
    // constraint makes that true rather than remembered, so an expired row is
    // replaced by the next request rather than piling up beside it.
    await issueFor(client, OWNER, NOW);
    await issueFor(client, OWNER, later(LIFETIME_MINUTES + 1));
    await issueFor(client, OWNER, later(LIFETIME_MINUTES * 2));

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 1);
  });

  test('removing the account takes its outstanding token', async () => {
    await issueFor(client, OWNER, NOW);
    await client.query('DELETE FROM users WHERE id = $1', [OWNER]);

    const { rows } = await client.query('SELECT id FROM password_resets');
    assert.equal(rows.length, 0, 'a token outlived the account it opened');
  });

  test('no mail sender is the ordinary answer on a fresh installation', async () => {
    assert.equal(await mailSender(client), null);
  });

  test('a Gmail connection holding a secret is the sender', async () => {
    const added = await client.query<{ id: string }>(
      `INSERT INTO connections (provider, name, method, services)
       VALUES ('google', 'Koinon Google', 'oauth', ARRAY['gmail','calendar'])
       RETURNING id::text AS id`,
    );
    const id = added.rows[0]?.id;
    assert.ok(id);

    // A connection with no credential is a card somebody started filling in,
    // so it cannot carry the mail.
    assert.equal(await mailSender(client), null, 'a connection with no secret was chosen');

    await client.query(
      `INSERT INTO connection_credentials (connection, ciphertext) VALUES ($1, $2)`,
      [id, Buffer.from('sealed bytes stand in for a real one')],
    );

    const sender = await mailSender(client);
    assert.equal(sender?.id, id);
    assert.equal(sender?.provider, 'google');

    await client.query('DELETE FROM connections WHERE id = $1', [id]);
  });

  test('a connection that carries no mail is never the sender', async () => {
    const added = await client.query<{ id: string }>(
      `INSERT INTO connections (provider, name, method, services)
       VALUES ('google', 'Drive only', 'oauth', ARRAY['drive'])
       RETURNING id::text AS id`,
    );
    const id = added.rows[0]?.id;
    assert.ok(id);
    await client.query(
      `INSERT INTO connection_credentials (connection, ciphertext) VALUES ($1, $2)`,
      [id, Buffer.from('sealed bytes stand in for a real one')],
    );

    assert.equal(await mailSender(client), null, 'a Drive connection was asked to send mail');

    await client.query('DELETE FROM connections WHERE id = $1', [id]);
  });
});
