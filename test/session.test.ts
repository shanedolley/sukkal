/**
 * Issuing a session, reading one, and ending one.
 *
 * `now` is an argument to every call here, so a fortnight passes in one line
 * and no test waits for a clock.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import {
  COOKIE,
  LIFETIME_DAYS,
  end,
  endAll,
  fingerprint,
  issue,
  read,
  sameToken,
  sweepExpired,
} from '../src/auth/session.ts';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** The seeded owner, from migration 001. */
const OWNER = '1';
const NOW = new Date('2026-09-03T00:00:00Z');

/** `days` after `NOW`, for a test that has to outlive a session. */
function later(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe('a session', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    const current = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must never run against kpa');
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    await client.query('DELETE FROM sessions');
  });

  test('a sign-in issues a token that reaches the session', async () => {
    const { token, session } = await issue(client, OWNER, NOW);
    const found = await read(client, token, NOW);
    assert.equal(found?.id, session.id);
    assert.equal(found?.ownerId, OWNER);
  });

  test('the token is never in the table', async () => {
    const { token } = await issue(client, OWNER, NOW);
    const rows = await client.query<{ id: string }>('SELECT id FROM sessions');
    // The row holds the fingerprint, so a copy of the table signs nobody in.
    assert.equal(rows.rows[0]?.id, fingerprint(token));
    assert.notEqual(rows.rows[0]?.id, token);
    assert.ok(!token.includes(rows.rows[0]?.id ?? 'x'));
  });

  test('a token nobody issued reaches nothing', async () => {
    await issue(client, OWNER, NOW);
    assert.equal(await read(client, 'a-token-nobody-minted', NOW), null);
  });

  test('no token at all reaches nothing, and asks the database nothing', async () => {
    for (const nothing of [undefined, null, '', '   ']) {
      assert.equal(await read(client, nothing, NOW), null);
    }
  });

  test('two sign-ins never share an identifier', async () => {
    // A fixed session cannot be planted before the fact, because the token a
    // sign-in returns is one this process has never seen before.
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const { token } = await issue(client, OWNER, NOW);
      assert.ok(!seen.has(token), 'a token repeated');
      seen.add(token);
    }
  });

  describe('the lifetime', () => {
    test('is the chosen number of days, not a default', () => {
      assert.equal(LIFETIME_DAYS, 14);
    });

    test('holds up to the moment it runs out', async () => {
      const { token } = await issue(client, OWNER, NOW);
      assert.ok(await read(client, token, later(LIFETIME_DAYS - 0.01)));
    });

    test('refuses the moment it does', async () => {
      const { token } = await issue(client, OWNER, NOW);
      assert.equal(await read(client, token, later(LIFETIME_DAYS)), null);
      assert.equal(await read(client, token, later(LIFETIME_DAYS + 1)), null);
    });

    test('does not slide when the session is used', async () => {
      // A sliding window renews on use, and use is what a thief does. Reading
      // a session eleven times over ten days must not extend it by a minute.
      const { token, session } = await issue(client, OWNER, NOW);
      for (let day = 0; day <= 10; day += 1) {
        assert.ok(await read(client, token, later(day)), `day ${String(day)}`);
      }
      const row = await client.query<{ expires_at: Date }>(
        'SELECT expires_at FROM sessions WHERE id = $1',
        [session.id],
      );
      assert.equal(row.rows[0]?.expires_at.getTime(), session.expiresAt.getTime());
      assert.equal(await read(client, token, later(LIFETIME_DAYS)), null);
    });
  });

  describe('ending one', () => {
    test('signing out ends it on the server, not only in the browser', async () => {
      const { token } = await issue(client, OWNER, NOW);
      assert.equal(await end(client, token), true);
      // The browser may keep the cookie. It now reaches nothing.
      assert.equal(await read(client, token, NOW), null);
    });

    test('ending one leaves the others', async () => {
      const a = await issue(client, OWNER, NOW);
      const b = await issue(client, OWNER, NOW);
      await end(client, a.token);
      assert.equal(await read(client, a.token, NOW), null);
      assert.ok(await read(client, b.token, NOW));
    });

    test('ending a session nobody holds answers false rather than throwing', async () => {
      assert.equal(await end(client, 'never-issued'), false);
    });

    test('a reset ends every session the owner holds', async () => {
      // KPA-79: a reset is what somebody does after losing control of the
      // account, so leaving the thief's session open would make it theatre.
      const one = await issue(client, OWNER, NOW);
      const two = await issue(client, OWNER, NOW);
      assert.equal(await endAll(client, OWNER), 2);
      assert.equal(await read(client, one.token, NOW), null);
      assert.equal(await read(client, two.token, NOW), null);
    });
  });

  test('the sweep removes what has run out and keeps what has not', async () => {
    const stale = await issue(client, OWNER, NOW);
    const live = await issue(client, OWNER, later(10));
    assert.equal(await sweepExpired(client, later(LIFETIME_DAYS + 1)), 1);
    assert.equal(await read(client, stale.token, later(LIFETIME_DAYS + 1)), null);
    assert.ok(await read(client, live.token, later(LIFETIME_DAYS + 1)));
  });

  describe('what the table refuses', () => {
    test('an id that is not a sha256', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO sessions (id, owner_id, expires_at) VALUES ('nope', $1, now() + interval '1 day')`,
          [OWNER],
        ),
        /sessions_id_is_a_sha256/,
      );
    });

    test('an expiry before the moment it was issued', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO sessions (id, owner_id, created_at, expires_at)
           VALUES ($1, $2, now(), now() - interval '1 day')`,
          [fingerprint('backwards'), OWNER],
        ),
        /sessions_expiry_follows_issue/,
      );
    });

    test('a session belonging to nobody', async () => {
      await assert.rejects(
        client.query(
          `INSERT INTO sessions (id, owner_id, expires_at)
           VALUES ($1, 999, now() + interval '1 day')`,
          [fingerprint('orphan')],
        ),
        /violates foreign key constraint/,
      );
    });
  });

  test('the cookie is named for the product', () => {
    assert.equal(COOKIE, 'kpa_session');
  });

  test('comparing two tokens says the same thing as a lookup', () => {
    assert.equal(sameToken('one', 'one'), true);
    assert.equal(sameToken('one', 'two'), false);
  });
});
