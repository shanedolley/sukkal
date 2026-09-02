import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import {
  backlog,
  finish,
  read,
  runDelivery,
  type Delivery,
  type Handler,
} from '../src/worker/deliveries.ts';
import { DRAIN, QUEUE_SCHEMA, TAKE, drain, queue, register } from '../src/worker/index.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** Puts one delivery in the table and hands back its id. */
async function arrive(
  client: ClientBase,
  deliveryId: string,
  event = 'session.ready',
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO inbound_deliveries (source, delivery_id, event, payload)
          VALUES ('nabium', $1, $2, $3)
       RETURNING id`,
    [deliveryId, event, JSON.stringify({ event, sessionId: deliveryId })],
  );
  return result.rows[0]!.id;
}

interface Ending {
  processed_at: string | null;
  error: string | null;
}

async function ending(client: ClientBase, id: string): Promise<Ending> {
  const result = await client.query<Ending>(
    'SELECT processed_at, error FROM inbound_deliveries WHERE id = $1',
    [id],
  );
  return result.rows[0]!;
}

/** A handler that records what it was given, and throws when told to. */
function stub(throws?: string): Handler & { calls: Delivery[] } {
  const calls: Delivery[] = [];
  const handler = async (_client: ClientBase, delivery: Delivery): Promise<void> => {
    calls.push(delivery);
    if (throws) throw new Error(throws);
  };
  return Object.assign(handler, { calls });
}

describe('the delivery backlog', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  test('reads what nobody has taken, oldest first', async () => {
    const first = await arrive(client, 'd1');
    const second = await arrive(client, 'd2');
    await client.query(
      "UPDATE inbound_deliveries SET received_at = now() - interval '1 hour' WHERE id = $1",
      [second],
    );

    const waiting = await backlog(client);

    assert.deepEqual(
      waiting.map((delivery) => delivery.id),
      [second, first],
    );
  });

  test('leaves out a delivery already taken', async () => {
    const taken = await arrive(client, 'd1');
    await arrive(client, 'd2');
    await finish(client, taken, null);

    const waiting = await backlog(client);

    assert.deepEqual(
      waiting.map((delivery) => delivery.deliveryId),
      ['d2'],
    );
  });

  test('carries the event and the body across', async () => {
    const id = await arrive(client, 'd1', 'session.ready');

    const delivery = await read(client, id);

    assert.equal(delivery?.event, 'session.ready');
    assert.equal(delivery?.source, 'nabium');
    assert.deepEqual(delivery?.payload, { event: 'session.ready', sessionId: 'd1' });
  });

  test('reads null for a delivery that has gone', async () => {
    const id = await arrive(client, 'd1');
    await client.query('DELETE FROM inbound_deliveries WHERE id = $1', [id]);

    assert.equal(await read(client, id), null);
  });
});

describe('running one delivery', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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

  test('a handler that returns takes the row, with no reason on it', async () => {
    const id = await arrive(client, 'd1');
    const handler = stub();

    await runDelivery(client, (await read(client, id))!, handler, false);

    const row = await ending(client, id);
    assert.notEqual(row.processed_at, null);
    assert.equal(row.error, null);
    assert.equal(handler.calls.length, 1);
  });

  test('a failure before the last attempt throws, and the row stays owed', async () => {
    const id = await arrive(client, 'd1');

    await assert.rejects(
      runDelivery(client, (await read(client, id))!, stub('nabium said no'), false),
      /nabium said no/,
    );

    const row = await ending(client, id);
    assert.equal(row.processed_at, null, 'the work is still owed, so the row is still in the backlog');
    assert.equal(row.error, null);
    assert.equal((await backlog(client)).length, 1);
  });

  test('the last failure writes the reason and a processing time to the row', async () => {
    const id = await arrive(client, 'd1');

    await runDelivery(client, (await read(client, id))!, stub('nabium said no'), true);

    const row = await ending(client, id);
    assert.equal(row.error, 'nabium said no');
    assert.notEqual(
      row.processed_at,
      null,
      'the row check refuses a reason without a processing time',
    );
    assert.equal((await backlog(client)).length, 0);
  });

  test('a success after a failure leaves no reason behind', async () => {
    const id = await arrive(client, 'd1');
    await finish(client, id, 'an earlier attempt failed');

    await runDelivery(client, (await read(client, id))!, stub(), false);

    assert.equal((await ending(client, id)).error, null);
  });
});

// ---------------------------------------------------------------------------
// pg-boss. The queue is the part that has to survive a restart, so this one
// starts the real thing against the real schema.
// ---------------------------------------------------------------------------

describe('the queue', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  let boss: ReturnType<typeof queue>;

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    const current = await client.query<{ name: string }>('SELECT current_database() AS name');
    assert.notEqual(current.rows[0]?.name, 'kpa', 'tests must run against kpa_dev, never kpa');
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);

    boss = queue('DATABASE_URL_TEST');
    boss.on('error', () => {});
    await boss.start();
  });

  after(async () => {
    await boss.stop();
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    await client.query('DELETE FROM inbound_deliveries');
  });

  test('installs into the schema the migration created, not into public', async () => {
    const tables = await client.query<{ count: string }>(
      `SELECT count(*) AS count FROM pg_tables WHERE schemaname = $1`,
      [QUEUE_SCHEMA],
    );
    assert.ok(Number(tables.rows[0]!.count) > 0, 'pg-boss put its tables in pgboss');

    const leaked = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%job%'`,
    );
    assert.deepEqual(leaked.rows, []);
  });

  test('queues a delivery whose event has a handler, and names the ones it cannot place', async () => {
    await boss.createQueue(TAKE, { policy: 'exclusive' });
    const known = await arrive(client, 'd1', 'session.ready');
    await arrive(client, 'd2', 'nobody.handles.this');

    const found = await drain(client, boss, { 'session.ready': stub() });

    assert.equal(found.queued, 1);
    assert.deepEqual(found.unhandled, ['nobody.handles.this']);

    const queued = await boss.fetch<{ id: string }>(TAKE);
    assert.equal(queued[0]?.data.id, known);

    // Finish it, so the test below is not handed this one by the worker it
    // registers. A job left active is retried, not forgotten.
    await boss.complete(TAKE, queued[0]!.id);
  });

  test('takes a delivery end to end, from the table to the row it leaves', async () => {
    const handler = stub();
    await register(boss, client, { 'session.ready': handler });
    const id = await arrive(client, 'd1', 'session.ready');

    await boss.send(DRAIN, {});

    const deadline = Date.now() + 30_000;
    let row = await ending(client, id);
    while (row.processed_at === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      row = await ending(client, id);
    }

    assert.notEqual(row.processed_at, null, 'the drain queued it and the worker took it');
    assert.equal(row.error, null);
    assert.equal(handler.calls[0]?.deliveryId, 'd1');
  });
});
