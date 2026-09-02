import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import {
  addConnection,
  listConnections,
  secretFor,
  setCredential,
} from '../src/connections/store.ts';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

// What the connections route may hand a browser, and what it may not.
//
// KPA-127 moves the connection list out of `localStorage`, so a secret now
// travels from a form to a route and into `setCredential`. The claim carrying
// that move is that it never travels back. Three things have to hold, and each
// one is silent when it breaks.
//
// The read narrows. `listConnections` names its columns, so its answer is the
// exact key set below and no argument to it can add one.
//
// The plaintext is nowhere in the answer. Asserting the absence of a column
// name would pass on an answer that carried the secret under another one, so
// this searches the serialised read for the secret itself.
//
// No route calls `secretFor`. It is the only function in the repository that
// returns a plaintext, the worker is what calls it, and this reads every route
// file rather than the one this story wrote.

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const API = path.join(import.meta.dirname, '..', 'apps', 'web', 'app', '(app)', 'api');
const url = process.env['DATABASE_URL_TEST'];

/** The ten fields a screen may see. `ciphertext` is not among them. */
const SEEN = [
  'expiresOn',
  'hasSecret',
  'id',
  'issuedOn',
  'method',
  'name',
  'provider',
  'services',
  'verdict',
  'verifiedOn',
];

const SECRET = 'ATATT3xFfGF0-a-token-shaped-string';

/** The code, with every comment taken out. The rule below is about what a
 *  route runs, and the connections route explains in prose why it calls
 *  neither of these. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Every file under the api tree, however deep the route sits. */
function routeFiles(from: string): string[] {
  return readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(from, entry.name);
    return entry.isDirectory() ? routeFiles(full) : [full];
  });
}

describe('what a route may return about a connection', () => {
  test('no route names secretFor, and none names the ciphertext', () => {
    const files = routeFiles(API);
    assert.ok(files.length > 0, 'the api tree holds no routes');

    for (const file of files) {
      const source = code(readFileSync(file, 'utf8'));
      const named = file.slice(file.indexOf('apps/web'));
      assert.ok(
        !/\bsecretFor\b/.test(source),
        `${named} reaches for secretFor, and no route may`,
      );
      assert.ok(
        !/\bciphertext\b/.test(source),
        `${named} names the ciphertext`,
      );
    }
  });
});

describe(
  'the connection read, against rows',
  { skip: url ? false : 'DATABASE_URL_TEST is unset' },
  () => {
    let client: ClientBase & { end: () => Promise<void> };
    const held = process.env[KEY_VARIABLE];

    before(async () => {
      // A key made here and thrown away. No key ever enters this repository:
      // docs/runbooks/secrets.md says why the history is what makes that
      // permanent.
      process.env[KEY_VARIABLE] = randomBytes(32).toString('base64');
      client = connect('DATABASE_URL_TEST');
      await client.connect();
      const current = await client.query<{ name: string }>('SELECT current_database() AS name');
      assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must run against kpa_dev, never kpa');
      await down(client, MIGRATIONS);
      await up(client, MIGRATIONS);
    });

    after(async () => {
      await down(client, MIGRATIONS);
      await client.end();
      if (held === undefined) delete process.env[KEY_VARIABLE];
      else process.env[KEY_VARIABLE] = held;
    });

    test('the read answers ten fields, and the secret is in none of them', async () => {
      const id = await addConnection(client, {
        provider: 'jira',
        name: 'BHP Jira',
        method: 'token',
      });
      await setCredential(client, id, SECRET, { expiresOn: '2027-03-01' });

      const list = await listConnections(client);
      const found = list[0];
      assert.ok(found, 'the connection did not come back');
      assert.deepEqual(
        Object.keys(found).sort(),
        SEEN,
        'listConnections answers with a key nobody asked for',
      );

      assert.equal(found.hasSecret, true, 'a stored key read as no key');
      // The dates are calendar dates, so they come back as text.
      assert.equal(found.expiresOn, '2027-03-01');

      // The whole answer, searched for the secret itself rather than for the
      // name of a column that might carry it.
      assert.ok(
        !JSON.stringify(list).includes(SECRET),
        'the read carried the plaintext',
      );
    });

    test('the row holds the sealed bytes, so the read narrows', async () => {
      const stored = await client.query<{ ciphertext: Buffer }>(
        'SELECT ciphertext FROM connection_credentials',
      );
      const sealed = stored.rows[0]?.ciphertext;
      assert.ok(sealed, 'nothing was stored');
      assert.ok(
        !sealed.toString('utf8').includes(SECRET),
        'the stored bytes hold the plaintext',
      );
      assert.ok(!sealed.toString('utf8').includes('BHP Jira'));
    });

    test('the worker still opens it, which is what makes the read a choice', async () => {
      const list = await listConnections(client);
      const id = list[0]?.id;
      assert.ok(id, 'the connection did not come back');
      assert.equal(await secretFor(client, id), SECRET);
    });
  },
);
