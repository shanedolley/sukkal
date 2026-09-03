/**
 * What a run of failed sign-ins costs, and where a sign-in is written down.
 *
 * The two KPA-78 asks for are here by name: the delay grows, and the account
 * unlocks without help. `now` is an argument to every call, so fifteen minutes
 * pass in one line and no test waits for a clock.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import {
  CAP_SECONDS,
  FORGET_MINUTES,
  FREE,
  RULE,
  cleared,
  failed,
  record,
  standing,
  waitFor,
} from '../src/auth/attempts.ts';
import { hash, verify } from '../src/auth/password.ts';
import { issueFor, setPassword, spend } from '../src/auth/reset.ts';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

const OWNER = '1';
const NOW = new Date('2026-09-03T00:00:00Z');

/** `minutes` after `NOW`, for a test that has to outlive a run. */
function later(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60 * 1000);
}

/** A distinct address per test, so a query finds only that test's rows.
 *  `audit` is append only, so nothing here can clear what ran before it. */
let told = 0;
function anAddress(): string {
  told += 1;
  return `someone-${String(told)}@evil.example`;
}

describe('a run of failed sign-ins', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
    await cleared(client);
  });

  /** A whole account, because `users_the_account_is_whole` refuses a subset
   *  and `setPassword` writes one of the four columns. */
  async function seedAccount(): Promise<void> {
    await client.query(
      `UPDATE users
          SET name = 'Shane Dolley', email = 'shane@koinon.com.au',
              assistant_name = 'Kestrel', password_hash = $2, created_at = now()
        WHERE id = $1`,
      [OWNER, await hash('The-Old-Password9!!')],
    );
  }

  /** Every sign-in row this test wrote, found by the address it used. */
  async function loggedFor(email: string): Promise<
    { intent: string; outcome: string; rule: string | null; space: string }[]
  > {
    const { rows } = await client.query<{
      intent: string;
      outcome: string;
      rule: string | null;
      space: string;
    }>(
      `SELECT intent, outcome, rule, space FROM audit
        WHERE action = 'sign-in' AND intent LIKE $1 ORDER BY id`,
      [`%${email}%`],
    );
    return rows;
  }

  describe('the sum', () => {
    test('the first failures are free, and a person who mistypes notices nothing', () => {
      assert.equal(waitFor(0), 0);
      for (let n = 1; n <= FREE; n += 1) assert.equal(waitFor(n), 0, `${String(n)} cost something`);
    });

    test('it doubles after that, and stops at the ceiling', () => {
      assert.deepEqual(
        [3, 4, 5, 6, 7, 8, 9, 20, 1000].map(waitFor),
        [1, 2, 4, 8, 8, 8, 8, 8, 8],
      );
      assert.equal(CAP_SECONDS, 8);
    });

    test('the ceiling is what makes the worst case a pause rather than an outage', () => {
      // The property KPA-78 asks for, stated directly. There is no number of
      // failures that shuts anybody out, because there is no refusal at all.
      for (const failures of [10, 100, 10_000]) {
        assert.ok(waitFor(failures) <= CAP_SECONDS, `${String(failures)} passed the ceiling`);
      }
    });
  });

  describe('the run', () => {
    test('the delay grows as the failures do', async () => {
      const seen: number[] = [];
      for (let n = 0; n < 6; n += 1) seen.push((await failed(client, NOW)).waitSeconds);
      assert.deepEqual(seen, [0, 0, 1, 2, 4, 8]);
    });

    test('what the door costs is what the last failure said it would', async () => {
      await failed(client, NOW);
      await failed(client, NOW);
      const third = await failed(client, NOW);

      const asked = await standing(client, NOW);
      assert.equal(asked.failures, 3);
      assert.equal(asked.waitSeconds, third.waitSeconds);
      assert.equal(asked.waitSeconds, 1);
    });

    test('a sign-in that works ends it, so the next one pays nothing', async () => {
      for (let n = 0; n < 5; n += 1) await failed(client, NOW);
      assert.equal((await standing(client, NOW)).waitSeconds, 4);

      await cleared(client);
      assert.deepEqual(await standing(client, NOW), { failures: 0, waitSeconds: 0 });
    });

    test('it is forgotten by itself, with nobody to ask', async () => {
      // The second thing KPA-78 asks a test to prove. Nothing clears this and
      // nobody is told: the run simply stops counting.
      for (let n = 0; n < 8; n += 1) await failed(client, NOW);
      assert.equal((await standing(client, NOW)).waitSeconds, CAP_SECONDS);

      assert.equal((await standing(client, later(FORGET_MINUTES - 1))).waitSeconds, CAP_SECONDS);
      assert.deepEqual(await standing(client, later(FORGET_MINUTES)), {
        failures: 0,
        waitSeconds: 0,
      });
    });

    test('a forgotten run starts again at one rather than where it stopped', async () => {
      for (let n = 0; n < 8; n += 1) await failed(client, NOW);

      const fresh = await failed(client, later(FORGET_MINUTES + 1));
      assert.equal(fresh.failures, 1, 'the old run carried on');
      assert.equal(fresh.waitSeconds, 0);
    });

    test('a failure every fourteen minutes still reaches the ceiling', async () => {
      // The other direction. A slow guesser is not forgotten between tries, so
      // pacing under the window buys nothing.
      let run = { failures: 0, waitSeconds: 0 };
      for (let n = 0; n < 8; n += 1) {
        run = await failed(client, later(n * (FORGET_MINUTES - 1)));
      }
      assert.equal(run.failures, 8);
      assert.equal(run.waitSeconds, CAP_SECONDS);
    });
  });

  describe('getting back in', () => {
    test('the command line ends a run, which is the path that needs no browser', async () => {
      for (let n = 0; n < 6; n += 1) await failed(client, NOW);
      const before = await standing(client, NOW);
      assert.equal(before.waitSeconds, CAP_SECONDS);

      // What `scripts/reset-password.sh --unlock` does.
      await cleared(client);
      assert.deepEqual(await standing(client, NOW), { failures: 0, waitSeconds: 0 });
    });

    test('setting a password ends the run in the same statement', async () => {
      // Somebody resetting a password is exactly the person who has just
      // failed to sign in several times, and the wait would meet them coming
      // back. `setPassword` clears it, so both routes to a new password do.
      await seedAccount();
      for (let n = 0; n < 6; n += 1) await failed(client, NOW);
      await setPassword(client, OWNER, 'A-Whole-New-Password9!');

      assert.deepEqual(await standing(client, NOW), { failures: 0, waitSeconds: 0 });
    });

    test('spending a reset token ends it too, because it ends at setPassword', async () => {
      await seedAccount();
      const issued = await issueFor(client, OWNER, NOW);
      for (let n = 0; n < 6; n += 1) await failed(client, NOW);

      await spend(client, issued.token, 'A-Whole-New-Password9!', NOW);

      assert.deepEqual(await standing(client, NOW), { failures: 0, waitSeconds: 0 });
      const { rows } = await client.query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [OWNER],
      );
      assert.equal(await verify('A-Whole-New-Password9!', rows[0]?.password_hash ?? null), true);
    });
  });

  describe('the column pair', () => {
    test('a count with no moment is refused, and a moment with no count is too', async () => {
      await assert.rejects(
        () => client.query('UPDATE users SET sign_in_failures = 3 WHERE id = $1', [OWNER]),
        /users_a_failure_run_carries_its_moment/,
        'a count that can never be forgotten was allowed',
      );
      await assert.rejects(
        () => client.query('UPDATE users SET sign_in_failed_at = now() WHERE id = $1', [OWNER]),
        /users_a_failure_run_carries_its_moment/,
      );
    });

    test('a negative count is refused', async () => {
      await assert.rejects(
        () =>
          client.query(
            'UPDATE users SET sign_in_failures = -1, sign_in_failed_at = now() WHERE id = $1',
            [OWNER],
          ),
        /users_sign_in_failures_is_a_count/,
      );
    });
  });

  describe('the log', () => {
    test('a sign-in that works is written down, and names no rule', async () => {
      const email = anAddress();
      await record(client, { email, from: '192.168.20.5', ok: true, result: 'Signed in.' }, NOW);

      const rows = await loggedFor(email);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.outcome, 'allowed');
      assert.equal(rows[0]?.rule, null);
      // `shared` is the space the wall does not divide, so a sign-in shows
      // under every filter rather than under one it does not belong to.
      assert.equal(rows[0]?.space, 'shared');
      assert.match(rows[0]?.intent ?? '', /192\.168\.20\.5/);
    });

    test('a refused sign-in cites the rule migration 026 writes', async () => {
      const email = anAddress();
      await record(client, { email, ok: false, result: 'Refused. 1 in a row.' }, NOW);

      const { rows } = await client.query<{ outcome: string; rule: string; effect: string }>(
        `SELECT a.outcome, a.rule, p.effect
           FROM audit a JOIN policies p ON p.key = a.rule
          WHERE a.action = 'sign-in' AND a.intent LIKE $1`,
        [`%${email}%`],
      );

      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.outcome, 'denied');
      assert.equal(rows[0]?.rule, RULE);
      // The join is the point: the screen reads the rule's own words rather
      // than a copy, so the constraint that a denial names a rule is met by a
      // row that says something.
      assert.match(rows[0]?.effect ?? '', /^Deny\./);
    });

    test('an address a stranger typed is kept, and bounded', async () => {
      const long = `${anAddress()}${'x'.repeat(5000)}`;
      await record(client, { email: long, ok: false, result: 'Refused.' }, NOW);

      const rows = await loggedFor(long.slice(0, 30));
      assert.equal(rows.length, 1);
      assert.ok((rows[0]?.intent.length ?? 0) < 300, 'the log took the whole 5000 characters');
    });

    test('an attempt that typed nothing still reaches the log', async () => {
      const before = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit
          WHERE action = 'sign-in' AND intent = 'Sign in as no address'`,
      );
      await record(client, { email: '', ok: false, result: 'Refused.' }, NOW);
      await record(client, { email: null, ok: false, result: 'Refused.' }, NOW);

      const after = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM audit
          WHERE action = 'sign-in' AND intent = 'Sign in as no address'`,
      );
      assert.equal(Number(after.rows[0]?.count) - Number(before.rows[0]?.count), 2);
    });

    test('the log keeps every attempt, because it is append only', async () => {
      const email = anAddress();
      for (let n = 0; n < 5; n += 1) {
        await record(client, { email, ok: false, result: 'Refused.' }, NOW);
      }
      assert.equal((await loggedFor(email)).length, 5);

      await assert.rejects(
        () => client.query("DELETE FROM audit WHERE action = 'sign-in'"),
        /append only/,
        'a run of refusals could be erased',
      );
    });
  });
});
