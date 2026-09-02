import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  MAX_BODY_BYTES,
  receive,
  sign,
  signatureMatches,
  statusFor,
} from '../src/webhooks/receive.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];
const SECRET = 'a-shared-secret-nobody-else-holds';
/** The secret a rotation is moving to, while the receiver still holds both. */
const NEXT_SECRET = 'the-secret-the-rotation-moves-to';

/** A body the contract accepts. */
function body(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: 'session.ready',
    sessionId: 'sess-1',
    ...over,
  });
}

// ---------------------------------------------------------------------------
// The signature. These need no database, so they run everywhere.
// ---------------------------------------------------------------------------

describe('the signature', () => {
  test('accepts what the same secret signed', () => {
    const text = body();
    assert.ok(signatureMatches(text, sign(text, SECRET), [SECRET]));
  });

  test('refuses another secret', () => {
    const text = body();
    assert.ok(!signatureMatches(text, sign(text, 'a-different-secret'), [SECRET]));
  });

  test('refuses a body edited after signing', () => {
    const signature = sign(body(), SECRET);
    assert.ok(!signatureMatches(body({ sessionId: 'sess-2' }), signature, [SECRET]));
  });

  test('refuses a digest of the wrong length', () => {
    assert.ok(!signatureMatches(body(), 'sha256=abcd', [SECRET]));
  });

  test('refuses a signature with no algorithm named', () => {
    const bare = sign(body(), SECRET).replace('sha256=', '');
    assert.ok(!signatureMatches(body(), bare, [SECRET]));
  });

  test('refuses an empty signature', () => {
    assert.ok(!signatureMatches(body(), '', [SECRET]));
  });

  test('accepts either secret of a list, whichever way round it is written', () => {
    const text = body();
    for (const secrets of [
      [SECRET, NEXT_SECRET],
      [NEXT_SECRET, SECRET],
    ]) {
      assert.ok(signatureMatches(text, sign(text, SECRET), secrets));
      assert.ok(signatureMatches(text, sign(text, NEXT_SECRET), secrets));
    }
  });

  test('refuses a secret no entry in the list holds', () => {
    const text = body();
    assert.ok(!signatureMatches(text, sign(text, 'a-third-secret'), [SECRET, NEXT_SECRET]));
  });

  test('refuses everything against an empty list', () => {
    const text = body();
    assert.ok(!signatureMatches(text, sign(text, SECRET), []));
  });

  test('tries every secret even after one matches, so the time names none', () => {
    // The property under test is that the loop never stops early, and only
    // timing shows that directly. A number instead of a string makes
    // createHmac throw, so a second entry the loop reaches is a thrown error
    // and a second entry it skips is a quiet `true`. The cast is the whole
    // trick: no caller may pass this, and every caller is typed against it.
    const reached = [SECRET, 42 as unknown as string];
    const text = body();
    assert.throws(() => signatureMatches(text, sign(text, SECRET), reached), {
      name: 'TypeError',
    });
  });
});

// ---------------------------------------------------------------------------
// Taking a delivery. These write, so they need the test database.
// ---------------------------------------------------------------------------

describe('receiving a delivery', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };

  before(async () => {
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
  });

  beforeEach(async () => {
    await client.query('DELETE FROM inbound_deliveries');
  });

  /** A delivery signed with the right secret, unless the caller says otherwise. */
  function delivery(over: Partial<Parameters<typeof receive>[1]> = {}) {
    const text = over.body ?? body();
    return {
      source: 'nabium',
      deliveryId: 'delivery-1',
      body: text,
      signature: sign(text, SECRET),
      secrets: [SECRET],
      ...over,
    };
  }

  async function stored(): Promise<Array<Record<string, unknown>>> {
    const rows = await client.query('SELECT * FROM inbound_deliveries ORDER BY id');
    return rows.rows;
  }

  test('stores a signed delivery verbatim', async () => {
    const result = await receive(client, delivery());
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.stored, true);
    assert.equal(statusFor(result), 202);

    const rows = await stored();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!['source'], 'nabium');
    assert.equal(rows[0]!['event'], 'session.ready');
    assert.equal(rows[0]!['processed_at'], null);
    assert.deepEqual(rows[0]!['payload'], { event: 'session.ready', sessionId: 'sess-1' });
  });

  test('keeps every field the sender sent, including ones it never read', async () => {
    const text = body({ transcript: 'Nigel: three years hot.', speakers: ['Nigel'] });
    await receive(client, delivery({ body: text, signature: sign(text, SECRET) }));

    const payload = (await stored())[0]!['payload'] as Record<string, unknown>;
    assert.equal(payload['transcript'], 'Nigel: three years hot.');
    assert.deepEqual(payload['speakers'], ['Nigel']);
  });

  test('a retry writes nothing twice', async () => {
    const first = await receive(client, delivery());
    const second = await receive(client, delivery());

    assert.equal(first.ok && first.stored, true);
    assert.equal(second.ok, true);
    assert.equal(second.ok && second.stored, false, 'the retry stored a second row');
    assert.equal(statusFor(second), 200);
    assert.equal((await stored()).length, 1);
  });

  test('the same sender may send two different deliveries', async () => {
    await receive(client, delivery());
    await receive(client, delivery({ deliveryId: 'delivery-2' }));
    assert.equal((await stored()).length, 2);
  });

  test('two senders may share a delivery id', async () => {
    await receive(client, delivery());
    await receive(client, delivery({ source: 'other' }));
    assert.equal((await stored()).length, 2);
  });

  test('refuses an unsigned delivery and stores nothing', async () => {
    const result = await receive(client, delivery({ signature: null }));
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.refusal, 'no-signature');
    assert.equal(statusFor(result), 401);
    assert.equal((await stored()).length, 0);
  });

  test('refuses a wrongly signed delivery and stores nothing', async () => {
    const text = body();
    const result = await receive(
      client,
      delivery({ body: text, signature: sign(text, 'the-wrong-secret') }),
    );
    assert.equal(!result.ok && result.refusal, 'bad-signature');
    assert.equal(statusFor(result), 401);
    assert.equal((await stored()).length, 0);
  });

  test('refuses everything when the receiver holds no secret', async () => {
    for (const secrets of [[], [''], ['   '], ['', '   ']]) {
      const result = await receive(client, delivery({ secrets }));
      assert.equal(!result.ok && result.refusal, 'no-secret', `${JSON.stringify(secrets)}`);
      assert.equal(statusFor(result), 503);
    }
    assert.equal((await stored()).length, 0);
  });

  test('stores a delivery signed with either secret of a rotation', async () => {
    const both = [SECRET, NEXT_SECRET];

    const old = await receive(client, delivery({ secrets: both }));
    assert.equal(old.ok && old.stored, true, 'the old secret was refused');

    const text = body();
    const fresh = await receive(
      client,
      delivery({
        deliveryId: 'delivery-2',
        body: text,
        signature: sign(text, NEXT_SECRET),
        secrets: both,
      }),
    );
    assert.equal(fresh.ok && fresh.stored, true, 'the new secret was refused');
    assert.equal((await stored()).length, 2);
  });

  test('refuses a delivery signed with neither secret of a rotation', async () => {
    const text = body();
    const result = await receive(
      client,
      delivery({
        body: text,
        signature: sign(text, 'a-third-secret'),
        secrets: [SECRET, NEXT_SECRET],
      }),
    );
    assert.equal(!result.ok && result.refusal, 'bad-signature');
    assert.equal(statusFor(result), 401);
    assert.equal((await stored()).length, 0);
  });

  test('an empty entry beside a real secret authenticates nothing', async () => {
    const text = body();
    const result = await receive(
      client,
      delivery({ body: text, signature: sign(text, ''), secrets: ['', SECRET] }),
    );
    assert.equal(!result.ok && result.refusal, 'bad-signature');
    assert.equal((await stored()).length, 0);

    const real = await receive(client, delivery({ secrets: ['', SECRET] }));
    assert.equal(real.ok && real.stored, true, 'the real secret was lost beside the empty one');
  });

  test('refuses a body that is not JSON', async () => {
    const text = 'this is not json';
    const result = await receive(client, delivery({ body: text, signature: sign(text, SECRET) }));
    assert.equal(!result.ok && result.refusal, 'bad-json');
    assert.equal(statusFor(result), 400);
    assert.equal((await stored()).length, 0);
  });

  test('refuses a body missing either contract field', async () => {
    const missing = [
      JSON.stringify({ sessionId: 'sess-1' }),
      JSON.stringify({ event: 'session.ready' }),
      JSON.stringify({ event: '  ', sessionId: 'sess-1' }),
      JSON.stringify({ event: 'session.ready', sessionId: '' }),
      JSON.stringify(['session.ready']),
      JSON.stringify('session.ready'),
      JSON.stringify(null),
    ];
    for (const text of missing) {
      const result = await receive(client, delivery({ body: text, signature: sign(text, SECRET) }));
      assert.equal(!result.ok && result.refusal, 'bad-payload', `${text} was accepted`);
      assert.equal(statusFor(result), 400);
    }
    assert.equal((await stored()).length, 0);
  });

  test('refuses a delivery with no id, because a retry could not be recognised', async () => {
    const result = await receive(client, delivery({ deliveryId: '   ' }));
    assert.equal(!result.ok && result.refusal, 'no-delivery-id');
    assert.equal((await stored()).length, 0);
  });

  test('refuses a body over the cap without parsing it', async () => {
    const text = JSON.stringify({
      event: 'session.ready',
      sessionId: 'sess-1',
      transcript: 'x'.repeat(MAX_BODY_BYTES),
    });
    const result = await receive(client, delivery({ body: text, signature: sign(text, SECRET) }));
    assert.equal(!result.ok && result.refusal, 'too-large');
    assert.equal(statusFor(result), 413);
    assert.equal((await stored()).length, 0);
  });

  test('the size check runs before the signature, so a huge body is cheap to refuse', async () => {
    const text = 'x'.repeat(MAX_BODY_BYTES + 1);
    const result = await receive(client, delivery({ body: text, signature: null }));
    assert.equal(!result.ok && result.refusal, 'too-large');
  });

  test('a refusal names no secret', async () => {
    const result = await receive(client, delivery({ signature: 'sha256=00' }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && !result.detail.includes(SECRET));
  });

  test('the backlog is every row nothing has taken', async () => {
    await receive(client, delivery());
    await receive(client, delivery({ deliveryId: 'delivery-2' }));
    await client.query(
      "UPDATE inbound_deliveries SET processed_at = now() WHERE delivery_id = 'delivery-1'",
    );

    const waiting = await client.query(
      'SELECT delivery_id FROM inbound_deliveries WHERE processed_at IS NULL',
    );
    assert.deepEqual(
      waiting.rows.map((row) => row.delivery_id),
      ['delivery-2'],
    );
  });

  test('a reason for a failure needs a processing time to belong to', async () => {
    await receive(client, delivery());
    await assert.rejects(
      client.query("UPDATE inbound_deliveries SET error = 'it broke'"),
      /inbound_deliveries_error_needs_processing/,
    );
  });
});
