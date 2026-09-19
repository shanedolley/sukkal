import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';

import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import { WINDOW_MINUTES, recheck } from '../src/connections/recheck.ts';
import { addConnection, listConnections, secretFor, setCredential } from '../src/connections/store.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const WHOAMI_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

/**
 * Google, played by a map from refresh token to the account it belongs to. A
 * token not in the map is refused the way Google refuses a revoked one, and
 * every call is counted, so a test can prove a run made none.
 */
function google(accounts: Record<string, string>, rotate: Record<string, string> = {}) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const at = String(input);
    calls.push(at);
    if (at === TOKEN_URL) {
      const refresh = new URLSearchParams(String(init?.body)).get('refresh_token') ?? '';
      const who = accounts[refresh];
      if (who === undefined) {
        return Response.json(
          { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' },
          { status: 400 },
        );
      }
      return Response.json({
        access_token: `access-for-${who}`,
        expires_in: 3599,
        ...(rotate[refresh] === undefined ? {} : { refresh_token: rotate[refresh] }),
      });
    }
    if (at === WHOAMI_URL) {
      const bearer = new Headers(init?.headers).get('authorization') ?? '';
      return Response.json({ email: bearer.replace('Bearer access-for-', '') });
    }
    throw new Error(`the test Google has no ${at}`);
  }) as typeof fetch;
  return { fetcher, calls };
}

describe('the scheduled recheck', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  const held: Record<string, string | undefined> = {};
  const ENV = {
    [KEY_VARIABLE]: randomBytes(32).toString('base64'),
    GOOGLE_OAUTH_CLIENT_ID: 'test-client',
    GOOGLE_OAUTH_CLIENT_SECRET: 'test-client-secret',
  };

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
    await client.query('DELETE FROM connections');
  });

  async function googleAccount(name: string, refresh: string): Promise<string> {
    const id = await addConnection(client, { provider: 'google', name, method: 'oauth' });
    await setCredential(client, id, refresh, { issuedOn: '2026-09-12' });
    return id;
  }

  const byName = async () => new Map((await listConnections(client)).map((row) => [row.name, row]));

  test('a working grant reads as working, and a dead one reads as failed with Google\'s own words', async () => {
    await googleAccount('live@example.com', 'refresh-live');
    await googleAccount('dead@example.com', 'refresh-dead');

    const found = await recheck(client, new Date(), google({ 'refresh-live': 'live@example.com' }).fetcher);

    assert.equal(found.length, 2);
    const rows = await byName();
    assert.equal(rows.get('live@example.com')?.verifiedOk, true);
    assert.match(rows.get('live@example.com')?.verdict ?? '', /renewed the grant for live@example\.com/);
    assert.equal(rows.get('dead@example.com')?.verifiedOk, false);
    assert.match(rows.get('dead@example.com')?.verdict ?? '', /invalid_grant: Token has been expired or revoked/);
  });

  test('a failure never removes the connection or its credential', async () => {
    const id = await googleAccount('dead@example.com', 'refresh-dead');
    await recheck(client, new Date(), google({}).fetcher);
    assert.equal((await listConnections(client)).length, 1);
    assert.equal(await secretFor(client, id), 'refresh-dead');
  });

  test('a grant that comes back belonging to another account fails', async () => {
    await googleAccount('who@example.com', 'refresh-x');
    await recheck(client, new Date(), google({ 'refresh-x': 'someone-else@example.com' }).fetcher);
    const row = (await byName()).get('who@example.com');
    assert.equal(row?.verifiedOk, false);
    assert.match(row?.verdict ?? '', /belongs to someone-else@example\.com/);
  });

  test('a second run inside the window asks nothing, and one after it asks again', async () => {
    await googleAccount('live@example.com', 'refresh-live');
    const now = new Date('2026-09-19T12:00:00Z');
    await recheck(client, now, google({ 'refresh-live': 'live@example.com' }).fetcher);

    const soon = google({ 'refresh-live': 'live@example.com' });
    const inside = new Date(now.getTime() + (WINDOW_MINUTES - 1) * 60_000);
    // verified_at is the database's now(), so move it to the test's clock.
    await client.query('UPDATE connection_credentials SET verified_at = $1', [now.toISOString()]);
    assert.deepEqual(await recheck(client, inside, soon.fetcher), []);
    assert.deepEqual(soon.calls, [], 'a run inside the window reached Google');

    const later = google({ 'refresh-live': 'live@example.com' });
    const outside = new Date(now.getTime() + (WINDOW_MINUTES + 1) * 60_000);
    assert.equal((await recheck(client, outside, later.fetcher)).length, 1);
    assert.equal(later.calls.length, 2, 'a run after the window did not check again');
  });

  test('a rotated refresh token is stored, so Sukkal never keeps one Google retired', async () => {
    const id = await googleAccount('live@example.com', 'refresh-old');
    await recheck(
      client,
      new Date(),
      google({ 'refresh-old': 'live@example.com' }, { 'refresh-old': 'refresh-new' }).fetcher,
    );
    assert.equal(await secretFor(client, id), 'refresh-new');
  });

  test('a metered probe is never run, so a Voyage key is left unchecked rather than billed', async () => {
    const id = await addConnection(client, { provider: 'voyage', name: 'Voyage', method: 'key' });
    await setCredential(client, id, 'pa-voyage-key');
    const seen = google({});
    assert.deepEqual(await recheck(client, new Date(), seen.fetcher), []);
    assert.deepEqual(seen.calls, []);
    assert.equal((await byName()).get('Voyage')?.verifiedOk, null, 'unchecked reads as unknown, not failed');
  });

  test('a connection holding no credential is not checked, and stays unknown', async () => {
    await addConnection(client, { provider: 'google', name: 'nothing@example.com', method: 'oauth' });
    const seen = google({});
    assert.deepEqual(await recheck(client, new Date(), seen.fetcher), []);
    assert.deepEqual(seen.calls, []);
  });

  test('a credential that will not open is a failure the row records', async () => {
    const id = await googleAccount('tampered@example.com', 'refresh-t');
    await client.query(
      "UPDATE connection_credentials SET ciphertext = set_byte(ciphertext, 20, get_byte(ciphertext, 20) # 1) WHERE connection = $1",
      [id],
    );
    await recheck(client, new Date(), google({}).fetcher);
    const row = (await byName()).get('tampered@example.com');
    assert.equal(row?.verifiedOk, false);
    assert.match(row?.verdict ?? '', /will not open/);
  });
});
