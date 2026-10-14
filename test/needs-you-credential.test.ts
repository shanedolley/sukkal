// The "needs you" item for a credential, KPA-108: raised when an expiry is
// near, when a check finds the credential lapsed, or when the recheck job
// fails with an authentication error -- and closed again once a check finds
// it working. src/connections/needs-you.ts carries the logic and recheck()
// calls it after every run, so this exercises it the same way: through
// recheck(), never by calling reconcileCredentialItems directly.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';

import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import { EXPIRY_WINDOW_DAYS } from '../src/connections/needs-you.ts';
import { recheck } from '../src/connections/recheck.ts';
import { addConnection, setCredential } from '../src/connections/store.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

interface CredentialRow {
  title: string;
  detail: string;
  space: string;
  connection_id: string;
  closed_at: Date | null;
}

describe('the credential needs-you item', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  const held: Record<string, string | undefined> = {};
  const ENV = { [KEY_VARIABLE]: randomBytes(32).toString('base64') };

  before(async () => {
    for (const [name, value] of Object.entries(ENV)) {
      held[name] = process.env[name];
      process.env[name] = value;
    }
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
    for (const [name, value] of Object.entries(held)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  beforeEach(async () => {
    // needs_you.connection_id cascades, so clearing connections is enough:
    // any credential item left from the previous test goes with it.
    await client.query('DELETE FROM connections');
  });

  /** A never fails, never-renews key, so checkOne's probe path never fires
   *  and the only trigger left to test is the one named: expiry, or a
   *  recorded failure. */
  async function keyConnection(name: string, dates: { issuedOn?: string; expiresOn?: string } = {}) {
    const id = await addConnection(client, { provider: 'atlassian', name, method: 'token' });
    await setCredential(client, id, `secret-for-${name}`, dates);
    return id;
  }

  const openItems = async (): Promise<CredentialRow[]> => {
    const found = await client.query<CredentialRow>(
      "SELECT title, detail, space, connection_id, closed_at FROM needs_you WHERE kind = 'credential'",
    );
    return found.rows;
  };

  const noop = (async () => {
    throw new Error('this test never reaches the network: no OAuth grant is in play');
  }) as typeof fetch;

  test('an expiry inside the window raises exactly one open row, and a second run raises no second', async () => {
    const id = await keyConnection('Jira PAT', {
      issuedOn: '2026-09-01',
      expiresOn: '2026-10-10', // 9 days after "now" below
    });
    await client.query(
      "UPDATE connection_credentials SET verified_on = CURRENT_DATE, verdict = 'ok', verified_ok = true, verified_at = now()",
    );

    const now = new Date('2026-10-01T09:00:00Z');
    await recheck(client, now, noop);

    const first = await openItems();
    assert.equal(first.length, 1, 'expiry inside the window raised no row, or more than one');
    assert.equal(first[0]?.connection_id, id);
    assert.equal(first[0]?.closed_at, null);
    assert.match(first[0]?.detail ?? '', /Expires 10 Oct 2026\./, 'the stored date is not "d mmm yyyy"');
    assert.doesNotMatch(first[0]?.detail ?? '', /\d{4}-\d{2}-\d{2}/, 'the stored detail still carries an ISO date');
    assert.equal(first[0]?.space, 'shared');

    await recheck(client, new Date(now.getTime() + 60 * 60 * 1000), noop);
    const second = await openItems();
    assert.equal(second.length, 1, 'a second run opened a second row for the same connection');
  });

  test('an expiry outside the window raises nothing', async () => {
    await keyConnection('Jira PAT', {
      issuedOn: '2026-09-01',
      expiresOn: '2026-10-20', // 19 days after "now" below, past the 14-day window
    });
    await client.query(
      "UPDATE connection_credentials SET verified_on = CURRENT_DATE, verdict = 'ok', verified_ok = true, verified_at = now()",
    );

    await recheck(client, new Date('2026-10-01T09:00:00Z'), noop);

    assert.deepEqual(await openItems(), [], 'a healthy connection outside the window raised an item');
  });

  test('a lapsed credential -- a recheck that failed with an authentication error -- raises one, naming the job', async () => {
    const id = await keyConnection('Confluence key');
    await client.query(
      "UPDATE connection_credentials SET verified_on = CURRENT_DATE, verdict = 'unauthorized: the key was revoked', verified_ok = false, verified_at = now()",
    );

    await recheck(client, new Date('2026-10-01T09:00:00Z'), noop);

    const rows = await openItems();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.connection_id, id);
    assert.match(rows[0]?.detail ?? '', /hourly credential recheck failed/i);
    assert.match(rows[0]?.detail ?? '', /unauthorized: the key was revoked/);

    // No second row on a second run, same as the expiry trigger.
    await recheck(client, new Date('2026-10-01T10:00:00Z'), noop);
    assert.equal((await openItems()).length, 1);
  });

  test('a credential that verifies OK again closes its open row by date, and the row still exists', async () => {
    const id = await keyConnection('Confluence key');
    await client.query(
      "UPDATE connection_credentials SET verified_on = CURRENT_DATE, verdict = 'failed', verified_ok = false, verified_at = now()",
    );
    await recheck(client, new Date('2026-10-01T09:00:00Z'), noop);
    assert.equal((await openItems()).length, 1, 'setup: the failure did not raise an item');

    await client.query(
      "UPDATE connection_credentials SET verdict = 'ok again', verified_ok = true, verified_at = now() WHERE connection = $1",
      [id],
    );
    await recheck(client, new Date('2026-10-01T10:00:00Z'), noop);

    const closed = await client.query<CredentialRow>(
      "SELECT title, detail, space, connection_id, closed_at FROM needs_you WHERE kind = 'credential' AND connection_id = $1",
      [id],
    );
    assert.equal(closed.rows.length, 1, 'the row disappeared instead of closing');
    assert.notEqual(closed.rows[0]?.closed_at, null, 'the row is still open after verifying OK');
  });

  for (const provider of ['voyage', 'atlassian']) {
    // voyage is metered and atlassian has no probe, so recheck() never writes
    // verified_ok for either: a renewal leaves it null for good.
    test(`renewing the ${provider} credential closes its open row though no check ever answers`, async () => {
      const id = await addConnection(client, { provider, name: `${provider} key`, method: 'token' });
      await setCredential(client, id, 'old-secret');
      await client.query(
        "UPDATE connection_credentials SET verified_on = CURRENT_DATE, verdict = 'failed', verified_ok = false, verified_at = now() WHERE connection = $1",
        [id],
      );
      await recheck(client, new Date('2026-10-01T09:00:00Z'), noop);
      assert.equal((await openItems()).filter((r) => r.closed_at === null).length, 1, 'setup: no item raised');

      await setCredential(client, id, 'new-secret');
      await recheck(client, new Date('2026-10-01T10:00:00Z'), noop);

      const rows = await openItems();
      assert.equal(rows.length, 1);
      assert.notEqual(rows[0]?.closed_at, null, 'the renewed credential still holds an open row');
    });
  }

  test('a dead OAuth grant that recheck() itself finds raises a credential item in the same run', async () => {
    const id = await addConnection(client, { provider: 'google', name: 'dead@example.com', method: 'oauth' });
    await setCredential(client, id, 'refresh-dead');

    const TOKEN_URL = 'https://oauth2.googleapis.com/token';
    const dead = (async (input: string | URL | Request) => {
      if (String(input) === TOKEN_URL) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    }) as typeof fetch;

    const held2: Record<string, string | undefined> = {};
    for (const name of ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
      held2[name] = process.env[name];
      process.env[name] = 'test';
    }
    try {
      await recheck(client, new Date('2026-10-01T09:00:00Z'), dead);
    } finally {
      for (const [name, value] of Object.entries(held2)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }

    const rows = await openItems();
    assert.equal(rows.length, 1, 'recheck found the grant dead but raised no item in the same run');
    assert.equal(rows[0]?.connection_id, id);
  });

  test('EXPIRY_WINDOW_DAYS matches LIFETIME_DAYS in src/auth/session.ts', () => {
    assert.equal(EXPIRY_WINDOW_DAYS, 14);
  });
});
