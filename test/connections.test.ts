import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { isEmail, needsSendFrom } from '../apps/web/lib/providers.ts';
import { KEY_VARIABLE, decrypt, encrypt } from '../src/connections/crypto.ts';
import {
  addConnection,
  connectionNamed,
  listConnections,
  recordVerification,
  removeConnection,
  secretFor,
  setCredential,
} from '../src/connections/store.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** A key made here and thrown away. No key ever enters this repository:
 *  docs/runbooks/secrets.md says why the history is what makes that permanent. */
function freshKey(): string {
  return randomBytes(32).toString('base64');
}

/** Runs `body` with `SUKKAL_SECRET_KEY` set to `value`, or unset when it is null,
 *  and puts back whatever was there. */
async function withKey(value: string | null, body: () => Promise<void> | void): Promise<void> {
  const held = process.env[KEY_VARIABLE];
  if (value === null) delete process.env[KEY_VARIABLE];
  else process.env[KEY_VARIABLE] = value;
  try {
    await body();
  } finally {
    if (held === undefined) delete process.env[KEY_VARIABLE];
    else process.env[KEY_VARIABLE] = held;
  }
}

const SECRET = 'ATATT3xFfGF0-a-token-shaped-string';

/** Changes one byte of `sealed`, which is what a tampered row looks like. */
function flip(sealed: Buffer, index: number): Buffer {
  sealed.writeUInt8(sealed.readUInt8(index) ^ 0x01, index);
  return sealed;
}

describe('sealing a connection secret', () => {
  test('a secret sealed and opened comes back unchanged', async () => {
    await withKey(freshKey(), () => {
      assert.equal(decrypt(encrypt(SECRET, '7'), '7'), SECRET);
    });
  });

  test('refuses to run with no key', async () => {
    await withKey(null, () => {
      assert.throws(() => encrypt(SECRET, '7'), /SUKKAL_SECRET_KEY is unset/);
      assert.throws(() => decrypt(Buffer.alloc(64), '7'), /SUKKAL_SECRET_KEY is unset/);
    });
  });

  test('refuses a key that is not 32 bytes', async () => {
    await withKey(randomBytes(16).toString('base64'), () => {
      assert.throws(() => encrypt(SECRET, '7'), /decodes to 16 bytes/);
    });
  });

  test('refuses a key that decodes to nothing recognisable', async () => {
    await withKey('not-a-key', () => {
      assert.throws(() => encrypt(SECRET, '7'), /AES-256 needs 32/);
    });
  });

  test('the sealed bytes hold none of the secret', async () => {
    await withKey(freshKey(), () => {
      const sealed = encrypt(SECRET, '7');
      assert.equal(sealed.includes(Buffer.from(SECRET, 'utf8')), false);
      assert.equal(sealed.toString('utf8').includes('ATATT'), false);
    });
  });

  test('seals the same secret differently every time', async () => {
    await withKey(freshKey(), () => {
      assert.notDeepEqual(encrypt(SECRET, '7'), encrypt(SECRET, '7'));
    });
  });

  test('refuses a byte that has changed', async () => {
    await withKey(freshKey(), () => {
      const sealed = encrypt(SECRET, '7');
      assert.throws(() => decrypt(flip(sealed, sealed.length - 1), '7'));
    });
  });

  test('refuses a tag that has changed', async () => {
    await withKey(freshKey(), () => {
      assert.throws(() => decrypt(flip(encrypt(SECRET, '7'), 15), '7'));
    });
  });

  test('refuses another connection id', async () => {
    await withKey(freshKey(), () => {
      assert.throws(() => decrypt(encrypt(SECRET, '7'), '8'));
    });
  });

  test('refuses another key', async () => {
    const first = freshKey();
    let sealed: Buffer = Buffer.alloc(0);
    await withKey(first, () => {
      sealed = encrypt(SECRET, '7');
    });
    await withKey(freshKey(), () => {
      assert.throws(() => decrypt(sealed, '7'));
    });
  });

  test('refuses a version it did not write', async () => {
    await withKey(freshKey(), () => {
      const sealed = encrypt(SECRET, '7');
      sealed[0] = 2;
      assert.throws(() => decrypt(sealed, '7'), /carries version 2/);
    });
  });

  test('refuses bytes too short to be sealed', async () => {
    await withKey(freshKey(), () => {
      assert.throws(() => decrypt(Buffer.alloc(28), '7'), /at least 29 bytes/);
    });
  });

  test('refuses an empty context at both ends', async () => {
    await withKey(freshKey(), () => {
      assert.throws(() => encrypt(SECRET, ''), /needs a context/);
      assert.throws(() => decrypt(Buffer.alloc(64), ''), /needs the context/);
    });
  });
});

describe('connections and their credentials', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  const held = process.env[KEY_VARIABLE];

  before(async () => {
    process.env[KEY_VARIABLE] = freshKey();
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

  /** Clears both tables. The cascade takes the credentials, which is the
   *  behaviour one test below proves rather than assumes. */
  async function clear(): Promise<void> {
    await client.query('DELETE FROM connections');
  }

  async function credentialCount(): Promise<number> {
    const counted = await client.query<{ n: string }>(
      'SELECT count(*)::text AS n FROM connection_credentials',
    );
    return Number(counted.rows[0]?.n);
  }

  test('a secret written and read back round-trips', async () => {
    await clear();
    const id = await addConnection(client, {
      provider: 'jira',
      name: 'Koinon Jira',
      method: 'token',
    });
    await setCredential(client, id, SECRET);

    assert.equal(await secretFor(client, id), SECRET);
  });

  test('the row holds ciphertext rather than the secret', async () => {
    await clear();
    const id = await addConnection(client, {
      provider: 'jira',
      name: 'Koinon Jira',
      method: 'token',
    });
    await setCredential(client, id, SECRET);

    const stored = await client.query<{ ciphertext: Buffer }>(
      'SELECT ciphertext FROM connection_credentials WHERE connection = $1',
      [id],
    );
    const bytes = stored.rows[0]?.ciphertext;
    assert.ok(bytes instanceof Buffer);
    assert.equal(bytes.includes(Buffer.from(SECRET, 'utf8')), false);
  });

  test('a connection with no credential reads as null rather than throwing', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth' });
    assert.equal(await secretFor(client, id), null);
  });

  test('the read a screen makes returns no ciphertext and no plaintext', async () => {
    await clear();
    const id = await addConnection(client, {
      provider: 'jira',
      name: 'Koinon Jira',
      method: 'token',
      services: [],
    });
    await setCredential(client, id, SECRET, { issuedOn: '2026-08-01', expiresOn: '2026-12-31' });

    const listed = await listConnections(client);
    assert.equal(listed.length, 1);
    const row = listed[0];
    assert.ok(row);

    // The whole shape, named. A column added later that carries the secret
    // fails here rather than reaching a screen.
    assert.deepEqual(Object.keys(row).sort(), [
      'expiresOn', 'hasSecret', 'id', 'issuedOn', 'method',
      'name', 'provider', 'services', 'verdict', 'verifiedOk', 'verifiedOn',
    ]);
    assert.equal(row.hasSecret, true);
    assert.equal(JSON.stringify(listed).includes(SECRET), false);
    assert.equal(JSON.stringify(listed).includes('ATATT'), false);
  });

  test('a date comes back as YYYY-MM-DD text, not a Date', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'jira', name: 'BHP Jira', method: 'token' });
    await setCredential(client, id, SECRET, { issuedOn: '2026-08-01', expiresOn: '2026-12-31' });

    const row = (await listConnections(client))[0];
    assert.ok(row);
    assert.equal(row.issuedOn, '2026-08-01');
    assert.equal(row.expiresOn, '2026-12-31');
    assert.equal(typeof row.expiresOn, 'string');
  });

  test('one provider carries two accounts, and one name carries one', async () => {
    await clear();
    await addConnection(client, { provider: 'microsoft', name: 'BHP Microsoft', method: 'oauth' });
    await addConnection(client, {
      provider: 'microsoft',
      name: 'Sydney Water Microsoft',
      method: 'oauth',
    });
    assert.equal((await listConnections(client)).length, 2);

    await assert.rejects(
      addConnection(client, { provider: 'microsoft', name: 'BHP Microsoft', method: 'oauth' }),
      /connections_name_is_unique_per_provider/,
    );
  });

  test('two accounts on one provider keep their own secrets', async () => {
    await clear();
    const bhp = await addConnection(client, {
      provider: 'microsoft',
      name: 'BHP Microsoft',
      method: 'token',
    });
    const water = await addConnection(client, {
      provider: 'microsoft',
      name: 'Sydney Water Microsoft',
      method: 'token',
    });
    await setCredential(client, bhp, 'bhp-secret');
    await setCredential(client, water, 'water-secret');

    assert.equal(await secretFor(client, bhp), 'bhp-secret');
    assert.equal(await secretFor(client, water), 'water-secret');
  });

  test("one row's bytes will not open on another row", async () => {
    await clear();
    const bhp = await addConnection(client, {
      provider: 'microsoft',
      name: 'BHP Microsoft',
      method: 'token',
    });
    const water = await addConnection(client, {
      provider: 'microsoft',
      name: 'Sydney Water Microsoft',
      method: 'token',
    });
    await setCredential(client, bhp, 'bhp-secret');
    await setCredential(client, water, 'water-secret');

    await client.query(
      `UPDATE connection_credentials SET ciphertext =
         (SELECT ciphertext FROM connection_credentials WHERE connection = $1)
       WHERE connection = $2`,
      [bhp, water],
    );

    await assert.rejects(secretFor(client, water));
  });

  test('a subscription writes a connection and no credential at all', async () => {
    // Claude's subscription reaches Anthropic through the headless CLI, so
    // there is no key to seal. Migration 023 says the absence is deliberate,
    // and this is what proves the store agrees.
    const id = await addConnection(client, {
      provider: 'claude',
      name: 'Claude by subscription',
      method: 'subscription',
    });

    const held = await client.query<{ n: string }>(
      'SELECT count(*) AS n FROM connection_credentials WHERE connection = $1',
      [id],
    );
    assert.equal(held.rows[0]?.n, '0');

    const seen = (await listConnections(client)).find((one) => one.id === id);
    assert.equal(seen?.hasSecret, false);
    assert.equal(seen?.expiresOn, null);
    assert.equal(seen?.verdict, null);
    assert.equal(await secretFor(client, id), null);
  });

  test('removing a connection removes its credential', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'linear', name: 'Koinon Linear', method: 'key' });
    await setCredential(client, id, SECRET);
    assert.equal(await credentialCount(), 1);

    await removeConnection(client, id);

    assert.equal(await credentialCount(), 0);
    assert.equal((await listConnections(client)).length, 0);
  });

  test('retyping a secret replaces it and clears the verification', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'linear', name: 'Koinon Linear', method: 'key' });
    await setCredential(client, id, 'first-secret');
    await recordVerification(client, id, 'Reached the workspace.', true);

    const verified = (await listConnections(client))[0];
    assert.ok(verified);
    assert.equal(verified.verdict, 'Reached the workspace.');
    assert.equal(verified.verifiedOk, true);
    const today = await client.query<{ d: string }>('SELECT CURRENT_DATE::text AS d');
    assert.equal(verified.verifiedOn, today.rows[0]?.d);

    await setCredential(client, id, 'second-secret');

    assert.equal(await secretFor(client, id), 'second-secret');
    assert.equal(await credentialCount(), 1);
    const replaced = (await listConnections(client))[0];
    assert.ok(replaced);
    assert.equal(replaced.verdict, null);
    assert.equal(replaced.verifiedOn, null);
    assert.equal(replaced.verifiedOk, null, 'a new secret is unchecked, not still working');
  });

  // KPA-159. The old fix for a dead credential was deleting the connection
  // and rebuilding it, which threw away its id, its created_at and its
  // verification history. A reconnect is `connectionNamed` followed by
  // `setCredential`, exactly what the OAuth callback already does on a
  // second grant, so this proves the row survives it rather than assuming so.
  test('a reconnect keeps the row\'s id and created_at, and replaces the secret', async () => {
    await clear();
    const id = await addConnection(client, {
      provider: 'microsoft',
      name: 'BHP Microsoft',
      method: 'oauth',
    });
    await setCredential(client, id, 'first-secret');
    await recordVerification(client, id, 'Reached the mailbox.', true);

    // created_at is a timestamptz, so the driver hands back a Date rather than
    // text the way a date column does. Two Date instances naming the same
    // moment are never the same object, so the comparison below reads the
    // instant each one names.
    const before = await client.query<{ id: string; created_at: Date }>(
      'SELECT id, created_at FROM connections WHERE id = $1',
      [id],
    );
    const row = before.rows[0];
    assert.ok(row);

    const found = await connectionNamed(client, 'microsoft', 'BHP Microsoft');
    assert.equal(found, id, 'the reconnect matched a different row');
    await setCredential(client, found!, 'second-secret');

    const after = await client.query<{ id: string; created_at: Date }>(
      'SELECT id, created_at FROM connections WHERE id = $1',
      [id],
    );
    const changed = after.rows[0];
    assert.ok(changed);
    assert.equal(changed.id, row.id, 'the reconnect changed the row id');
    assert.equal(
      changed.created_at.getTime(),
      row.created_at.getTime(),
      'the reconnect changed when the row was created',
    );
    assert.equal(await secretFor(client, id), 'second-secret');
    assert.equal((await listConnections(client)).length, 1, 'the reconnect added a second row');
  });

  test('a verification of a connection holding no credential throws', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth' });
    await assert.rejects(recordVerification(client, id, 'Reached it.', true), /holds no credential/);
  });

  test('refuses a blank secret and a blank verdict', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth' });
    await assert.rejects(setCredential(client, id, '   '), /cannot be blank/);
    await setCredential(client, id, SECRET);
    await assert.rejects(recordVerification(client, id, '  ', true), /has to say something/);
  });

  test('the table refuses a credential no connection owns', async () => {
    await clear();
    await assert.rejects(
      client.query('INSERT INTO connection_credentials (connection, ciphertext) VALUES ($1, $2)', [
        99999,
        randomBytes(64),
      ]),
      /violates foreign key constraint/,
    );
  });

  test('the table refuses bytes too short to have been sealed', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth' });
    await assert.rejects(
      client.query('INSERT INTO connection_credentials (connection, ciphertext) VALUES ($1, $2)', [
        id,
        randomBytes(29),
      ]),
      /connection_credentials_ciphertext_is_sealed/,
    );
  });

  test('the table refuses a verdict with no date, and a date with no verdict', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth' });
    await setCredential(client, id, SECRET);

    await assert.rejects(
      client.query('UPDATE connection_credentials SET verdict = $2 WHERE connection = $1', [
        id,
        'Reached it.',
      ]),
      /connection_credentials_a_verdict_has_a_date/,
    );
    await assert.rejects(
      client.query('UPDATE connection_credentials SET verified_on = CURRENT_DATE WHERE connection = $1', [id]),
      /connection_credentials_a_verdict_has_a_date/,
    );
  });

  test('the table refuses an expiry before the issue', async () => {
    await clear();
    const id = await addConnection(client, { provider: 'jira', name: 'BHP Jira', method: 'token' });
    await assert.rejects(
      setCredential(client, id, SECRET, { issuedOn: '2026-12-31', expiresOn: '2026-08-01' }),
      /connection_credentials_expiry_follows_issue/,
    );
  });

  // ── The send-from address. KPA-158. ────────────────────────────────────────

  test('a sending connection keeps its address apart from its name', async () => {
    await clear();
    const id = await addConnection(client, {
      provider: 'resend',
      name: 'Sukkal Resend',
      method: 'key',
      sendFrom: '  no-reply@sukkal.app  ',
    });

    const stored = await client.query<{ name: string; send_from: string | null }>(
      'SELECT name, send_from FROM connections WHERE id = $1',
      [id],
    );
    // The name is the display name and the address is its own column. KPA-143
    // had one column doing both, and this is the row that broke it.
    assert.equal(stored.rows[0]?.name, 'Sukkal Resend');
    assert.equal(stored.rows[0]?.send_from, 'no-reply@sukkal.app');
  });

  test('a connection that sends nothing holds no address, and migration 032 allows it', async () => {
    await clear();
    // `sukkal_local` holds a Resend card written before the column existed, so
    // the column is nullable and the migration backfills nothing. Constraining
    // the existing data would have failed on the one installation there is.
    const zoom = await addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth' });
    const resend = await addConnection(client, {
      provider: 'resend',
      name: 'Sukkal Resend',
      method: 'key',
    });

    const stored = await client.query<{ send_from: string | null }>(
      'SELECT send_from FROM connections WHERE id = ANY($1) ORDER BY id',
      [[zoom, resend]],
    );
    assert.deepEqual(stored.rows.map((row) => row.send_from), [null, null]);
  });

  test('the table holds the address to a shape, which is a floor and not the check', async () => {
    await clear();
    // What the column proves: one @, something either side, a dot in the
    // domain, no whitespace. It proves nothing about the mailbox existing, and
    // it does not know that a Resend card needs one at all. The route is where
    // both of those live.
    for (const wrong of [
      'Sukkal Resend',
      'no-reply@sukkal',
      'no reply@sukkal.app',
      '@sukkal.app',
      // The header injection. The column refuses it on the way in and
      // `fromHeader` refuses it on the way out.
      'no-reply@sukkal.app\r\nBcc: them@example.com',
    ]) {
      await assert.rejects(
        addConnection(client, {
          provider: 'resend',
          name: `Resend ${wrong}`,
          method: 'key',
          sendFrom: wrong,
        }),
        /connections_send_from_is_shaped_like_an_address/,
        `the table admitted ${JSON.stringify(wrong)}`,
      );
    }
  });

  test('the table refuses an empty provider, name, method or service', async () => {
    await clear();
    await assert.rejects(
      addConnection(client, { provider: '  ', name: 'Koinon Zoom', method: 'oauth' }),
      /connections_every_field_says_something/,
    );
    await assert.rejects(
      addConnection(client, { provider: 'zoom', name: 'Koinon Zoom', method: 'oauth', services: [''] }),
      /connections_every_service_is_named/,
    );
  });
});

// Where a Resend card with no address is refused, and it is the route. KPA-158.
//
// The dialog checks first and that is a convenience: a request body is what
// crosses the boundary, and the dialog is the only caller today rather than the
// only caller possible. This needs no database, so it runs on a box with none.
describe('the send-from address at the trust boundary', () => {
  test('the rule reads off the catalogue, so only a sender requires one', () => {
    assert.ok(needsSendFrom('resend'), 'a Resend card may be saved with no address');
    assert.ok(!needsSendFrom('zoom'), 'Zoom gained a required address and sends no mail');
    assert.ok(!needsSendFrom('google'), 'Google gained a required address');
  });

  test('what counts as an address, and what the name box answered instead', () => {
    assert.ok(isEmail('no-reply@sukkal.app'));
    assert.ok(!isEmail('Sukkal Resend'), 'a display name read as an address');
    assert.ok(!isEmail(''), 'an empty box read as an address');
    assert.ok(
      !isEmail('no-reply@sukkal.app\r\nBcc: them@example.com'),
      'a second header read as an address',
    );
  });

  test('the route calls both, so a browser is not the only check', () => {
    const route = readFileSync(
      path.join(
        import.meta.dirname,
        '..',
        'apps',
        'web',
        'app',
        '(app)',
        'api',
        'connections',
        'route.ts',
      ),
      'utf8',
    );
    // The exact calls, which only the refusals could produce. Matching the
    // names alone would pass on the import line.
    assert.match(route, /!isEmail\(address\)/, 'the route admits an address nobody checked');
    assert.match(
      route,
      /address === "" && needsSendFrom\(provider\)/,
      'the route admits a sending connection with no address',
    );
    assert.match(
      route,
      /sendFrom: address === "" \? null : address/,
      'the route checks the address and stores none',
    );
  });
});
