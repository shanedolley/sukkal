// A token connection to a site on atlassian.net, KPA-105: the site guard that
// keeps the token on an atlassian.net origin, the probe the hourly recheck
// sends, one connection per site, and the expiry reaching the needs-you item.
//
// Nothing here reaches Atlassian. Every answer comes from a fake fetch, which
// also records what it was handed, so the request shape is read rather than
// assumed. There is no live proof with a real token yet.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';

import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import {
  jiraAuthorization,
  jiraSecret,
  jiraSite,
  replaceJiraToken,
  splitJiraSecret,
} from '../src/connections/jira.ts';
import { recheck } from '../src/connections/recheck.ts';
import {
  addConnection,
  listConnections,
  secretFor,
  setCredential,
} from '../src/connections/store.ts';
import { probeFor, verify } from '../src/connections/verify.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const ROUTE = path.join(
  import.meta.dirname,
  '..',
  'apps',
  'web',
  'app',
  '(app)',
  'api',
  'connections',
  'route.ts',
);
const url = process.env['DATABASE_URL_TEST'];

const TOKEN = 'ATATT3xFfGF0-a-token-that-must-never-leave';
const EMAIL = 'shane@koinon.com.au';
const KOINON = 'https://koinon.atlassian.net';
const COLLIBRA = 'https://engineering-collibra.atlassian.net';

/** A fetcher answering one status and body, and recording what it was handed. */
function answering(status: number, body: unknown = {}) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher = ((address: string, init?: RequestInit) => {
    seen.push({ url: address, init });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  }) as unknown as typeof fetch;
  return { fetcher, seen };
}

describe('the site guard', () => {
  test('keeps the origin of a Cloud site, with or without its scheme', () => {
    assert.equal(jiraSite('https://koinon.atlassian.net'), KOINON);
    assert.equal(jiraSite('koinon.atlassian.net'), KOINON);
    assert.equal(jiraSite('  Koinon.Atlassian.NET/ '), KOINON);
    assert.equal(jiraSite('https://Koinon.atlassian.net'), KOINON);
    assert.equal(jiraSite('HTTPS://KOINON.ATLASSIAN.NET'), KOINON);
    assert.equal(jiraSite('https://koinon.atlassian.net:443'), KOINON);
    assert.equal(jiraSite('engineering-collibra.atlassian.net'), COLLIBRA);
  });

  test('refuses http, another domain, a path, and userinfo in the address', () => {
    const refused = [
      'http://koinon.atlassian.net',
      'https://evil.example.com',
      'https://atlassian.net',
      'https://koinon.atlassian.net.evil.com',
      'https://evilatlassian.net',
      'https://a.b.atlassian.net',
      'https://koinon.atlassian.net/rest/api/3/myself',
      'https://koinon.atlassian.net/jira',
      'https://koinon.atlassian.net?x=1',
      'https://koinon.atlassian.net#frag',
      'https://koinon.atlassian.net:8443',
      'https://user@koinon.atlassian.net',
      'https://user:pass@koinon.atlassian.net',
      'https://koinon.atlassian.net@evil.example.com',
      'https://evil.example.com\\@koinon.atlassian.net',
      'https://evil.example.com#@koinon.atlassian.net',
      'https://koinon.atlassian.net.',
      'ftp://koinon.atlassian.net',
      'javascript:alert(1)',
      'https://koinon.atlassian.net evil.example.com',
      'https://koinon.atlassian.net\n.evil.example.com',
      'https://kоinon.atlassian.net',
      '',
      '   ',
    ];
    for (const input of refused) {
      assert.equal(jiraSite(input), null, `${JSON.stringify(input)} passed the guard`);
    }
  });

  test('the route runs it before a row is written, and the probe builder runs it again', () => {
    const route = readFileSync(ROUTE, 'utf8');
    const guard = route.indexOf('jiraSite(');
    const insert = route.indexOf('addConnection(client');
    assert.ok(guard > 0 && insert > 0 && guard < insert, 'the route writes before it checks the site');

    // A row whose site was altered after the fact still gets no probe.
    for (const site of ['https://evil.example.com', 'http://koinon.atlassian.net', 'koinon.atlassian.net', null]) {
      assert.equal(probeFor('jira', jiraSecret(EMAIL, TOKEN), site), null, `probe built for ${String(site)}`);
    }
  });
});

describe('the probe', () => {
  test('is a free GET of /myself on the site, with Basic auth of email:token in a header', async () => {
    const probe = probeFor('jira', jiraSecret(EMAIL, TOKEN), KOINON);
    assert.ok(probe, 'no probe for a good site');
    assert.equal(probe.url, `${KOINON}/rest/api/3/myself`);
    assert.equal(probe.method, 'GET');
    assert.equal(probe.cost, 'free');
    assert.equal(
      probe.headers['authorization'],
      `Basic ${Buffer.from(`${EMAIL}:${TOKEN}`).toString('base64')}`,
    );
    assert.ok(!probe.url.includes(TOKEN) && !probe.url.includes(EMAIL));

    const { fetcher, seen } = answering(200, { displayName: 'Shane Dolley', accountId: 'abc' });
    await verify(probe, fetcher);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, `${KOINON}/rest/api/3/myself`);
    assert.equal(seen[0]?.init?.redirect, 'manual', 'a redirect would carry the header elsewhere');
  });

  test('a good token is accepted and the verdict names the account the site returned', async () => {
    const probe = probeFor('jira', jiraSecret(EMAIL, TOKEN), KOINON);
    assert.ok(probe);
    const verdict = await verify(probe, answering(200, { displayName: 'Shane Dolley' }).fetcher);
    assert.equal(verdict.ok, true);
    assert.match(verdict.verdict, /koinon\.atlassian\.net accepted the key for Shane Dolley/);
    assert.ok(!verdict.verdict.includes(TOKEN));
  });

  test('an answer naming no account is still accepted', async () => {
    const probe = probeFor('jira', jiraSecret(EMAIL, TOKEN), KOINON);
    assert.ok(probe);
    const verdict = await verify(probe, answering(200, {}).fetcher);
    assert.deepEqual(verdict, { ok: true, verdict: 'koinon.atlassian.net accepted' });
  });

  test('a refused token (401) fails and the verdict names no secret', async () => {
    const probe = probeFor('jira', jiraSecret(EMAIL, TOKEN), KOINON);
    assert.ok(probe);
    const verdict = await verify(probe, answering(401).fetcher);
    assert.deepEqual(verdict, { ok: false, verdict: 'koinon.atlassian.net refused the key' });
  });

  test('a redirect is a failure, not something followed', async () => {
    const probe = probeFor('jira', jiraSecret(EMAIL, TOKEN), KOINON);
    assert.ok(probe);
    const verdict = await verify(probe, answering(302).fetcher);
    assert.equal(verdict.ok, false);
  });

  test('a secret with no email is not probed', () => {
    assert.equal(probeFor('jira', TOKEN, KOINON), null);
    assert.equal(jiraAuthorization(TOKEN), null);
    assert.deepEqual(splitJiraSecret(jiraSecret(EMAIL, TOKEN)), { email: EMAIL, token: TOKEN });
  });
});

describe('a token connection, against rows', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  const held = process.env[KEY_VARIABLE];

  before(async () => {
    process.env[KEY_VARIABLE] = randomBytes(32).toString('base64');
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
  });

  after(async () => {
    await down(client, MIGRATIONS);
    await client.end();
    if (held === undefined) delete process.env[KEY_VARIABLE];
    else process.env[KEY_VARIABLE] = held;
  });

  beforeEach(async () => {
    await client.query('DELETE FROM connections');
  });

  async function connected(name: string, site: string, dates: { expiresOn?: string } = {}) {
    const id = await addConnection(client, { provider: 'jira', name, method: 'token', site });
    await setCredential(client, id, jiraSecret(EMAIL, TOKEN), dates);
    return id;
  }

  test('two sites make two rows that carry their own site, and the read returns no token', async () => {
    await connected('Koinon', KOINON);
    await connected('Collibra', COLLIBRA);
    const list = await listConnections(client);
    assert.deepEqual(list.map((one) => one.site).sort(), [COLLIBRA, KOINON]);
    assert.ok(!JSON.stringify(list).includes(TOKEN), 'the read carried the token');
  });

  test('a second connection to the same site is refused, whatever it is called', async () => {
    await connected('Koinon', KOINON);
    await assert.rejects(
      addConnection(client, { provider: 'jira', name: 'Another name', method: 'token', site: KOINON }),
      (cause: unknown) =>
        (cause as { constraint?: string }).constraint === 'connections_one_per_site',
    );
  });

  test('the table refuses a site that is not an atlassian.net origin', async () => {
    for (const site of ['https://evil.example.com', 'http://koinon.atlassian.net', `${KOINON}/x`]) {
      await assert.rejects(
        addConnection(client, { provider: 'jira', name: site, method: 'token', site }),
        (cause: unknown) =>
          (cause as { constraint?: string }).constraint === 'connections_site_is_an_atlassian_origin',
        site,
      );
    }
  });

  test('the recheck sends the stored token to the stored site only, and records the account', async () => {
    const id = await connected('Koinon', KOINON);
    const { fetcher, seen } = answering(200, { displayName: 'Shane Dolley' });

    const logged: string[] = [];
    const real = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const level of Object.keys(real) as (keyof typeof real)[]) {
      console[level] = (...args: unknown[]) => {
        logged.push(args.map(String).join(' '));
      };
    }
    let found;
    try {
      found = await recheck(client, new Date('2026-10-20T09:00:00Z'), fetcher);
    } finally {
      Object.assign(console, real);
    }

    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, `${KOINON}/rest/api/3/myself`);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.ok, true);

    const row = (await listConnections(client)).find((one) => one.id === id);
    assert.equal(row?.verifiedOk, true);
    assert.match(row?.verdict ?? '', /accepted the key for Shane Dolley/);
    for (const text of [row?.verdict ?? '', ...logged, JSON.stringify(found)]) {
      assert.ok(!text.includes(TOKEN), 'the token reached a verdict or a log line');
    }
  });

  test('a refused token marks the row failing and raises a needs-you item', async () => {
    await connected('Koinon', KOINON);
    await recheck(client, new Date('2026-10-20T09:00:00Z'), answering(401).fetcher);
    const items = await client.query<{ detail: string }>(
      "SELECT detail FROM needs_you WHERE kind = 'credential' AND closed_at IS NULL",
    );
    assert.equal(items.rows.length, 1);
    assert.match(items.rows[0]?.detail ?? '', /refused the key/);
  });

  test('an expiry inside the window raises the needs-you item for the connection', async () => {
    const id = await connected('Koinon', KOINON, { expiresOn: '2026-10-28' });
    await recheck(client, new Date('2026-10-20T09:00:00Z'), answering(200, { displayName: 'Shane Dolley' }).fetcher);
    const items = await client.query<{ detail: string; connection_id: string }>(
      "SELECT detail, connection_id FROM needs_you WHERE kind = 'credential' AND closed_at IS NULL",
    );
    assert.equal(items.rows.length, 1, 'the expiry raised no item, or more than one');
    assert.equal(items.rows[0]?.connection_id, id);
    assert.match(items.rows[0]?.detail ?? '', /Expires 28 Oct 2026\./);
  });

  test('retyping the token keeps the account email and clears the verdict', async () => {
    const id = await connected('Koinon', KOINON);
    await recheck(client, new Date('2026-10-20T09:00:00Z'), answering(200, { displayName: 'S' }).fetcher);
    await replaceJiraToken(client, id, 'a-new-token', { expiresOn: '2027-01-01' });

    assert.equal(await secretFor(client, id), jiraSecret(EMAIL, 'a-new-token'));
    const row = (await listConnections(client)).find((one) => one.id === id);
    assert.equal(row?.expiresOn, '2027-01-01');
    assert.equal(row?.verifiedOk, null, 'a new token carried the old verdict');
  });
});
