import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect, refuseProduction } from '../src/db/connect.ts';
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
import {
  FAILED,
  NIGHTLY,
  NIGHTLY_CRON,
  ZONE,
  dayIn,
  nightly,
  raiseFailure,
  schedule,
} from '../src/worker/nightly.ts';
import { EXPIRY, EXPIRY_CRON, schedule as scheduleExpiry } from '../src/worker/sweep.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const INDEX = path.join(import.meta.dirname, '..', 'src', 'worker', 'index.ts');
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

/** A 64-character hex id, the shape `sessions` and `oauth_grants` both
 *  require. Neither table's own value matters to the sweep, only its age. */
function hexId(): string {
  return crypto.randomBytes(32).toString('hex');
}

/** `expired` picks a `created_at`/`expires_at` pair either side of now, both
 *  before `now()` or both after it, so the row satisfies the table's own
 *  rule that an expiry follows the row's creation. */
async function session(client: ClientBase, expired: boolean): Promise<string> {
  const id = hexId();
  const [created, expires] = expired
    ? ["now() - interval '2 hours'", "now() - interval '1 hour'"]
    : ['now()', "now() + interval '60 minutes'"];
  await client.query(
    `INSERT INTO sessions (id, owner_id, created_at, expires_at)
     VALUES ($1, 1, ${created}, ${expires})`,
    [id],
  );
  return id;
}

async function grant(client: ClientBase, expired: boolean): Promise<string> {
  const id = hexId();
  const [created, expires] = expired
    ? ["now() - interval '20 minutes'", "now() - interval '10 minutes'"]
    : ['now()', "now() + interval '10 minutes'"];
  await client.query(
    `INSERT INTO oauth_grants (id, provider, verifier, created_at, expires_at)
     VALUES ($1, 'google', $2, ${created}, ${expires})`,
    [id, 'v'.repeat(43)],
  );
  return id;
}

async function countRows(client: ClientBase, table: string): Promise<number> {
  const found = await client.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(found.rows[0]!.n);
}

// `main()` needs a live database and a live boss, so it is read as source
// rather than called. This is the check that catches KPA-157's actual gap:
// `sweepExpired` already worked and was already tested, and nothing called
// it from the worker. It needs no database, so it is not inside a describe
// that skips without one.
test('the worker calls the sweep schedule at start-up, the way it calls recheck', async () => {
  const source = await readFile(INDEX, 'utf8');
  assert.match(
    source,
    /schedule as scheduleExpiry\s*\}\s*from\s*'\.\/sweep\.ts'/,
    'index.ts imports the sweep schedule',
  );
  assert.match(
    source,
    /await scheduleExpiry\(boss, client\)/,
    'main() calls it, not only imports it',
  );
});

describe('the delivery backlog', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
    await refuseProduction(client);
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
    await refuseProduction(client);
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
    await client.query('DELETE FROM sessions');
    await client.query('DELETE FROM oauth_grants');
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

  test('schedules the nightly review at 03:30 Sydney, and takes one end to end', async () => {
    await schedule(boss, client, '/nonexistent-vault-for-kpa-85');

    const cron = await client.query<{ name: string; cron: string; timezone: string }>(
      `SELECT name, cron, timezone FROM ${QUEUE_SCHEMA}.schedule WHERE name = $1`,
      [NIGHTLY],
    );
    assert.equal(cron.rows[0]?.cron, NIGHTLY_CRON);
    assert.equal(cron.rows[0]?.timezone, ZONE, 'a job about days has to know whose day');

    // A stale fact, so the run has something to do and the proof is the row
    // it leaves rather than a job state alone.
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state,
                          valid_from, verified, verified_by, stale_after)
       VALUES ($1, 'shared/scheduled.md', 'reference', 'Scheduled', 'one line',
               'shared', 'proposed', '2026-01-01', '2026-01-01', 'human:shane',
               '2020-01-01')`,
      [node.rows[0]!.id],
    );
    await client.query('COMMIT');

    await boss.send(NIGHTLY, {});

    const deadline = Date.now() + 30_000;
    let opened = 0;
    while (opened === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const found = await client.query<{ n: string }>(
        "SELECT count(*) AS n FROM needs_you WHERE kind = 'deadline'",
      );
      opened = Number(found.rows[0]!.n);
    }

    assert.equal(opened, 1, 'the registered worker ran the review and the sweep wrote');

    // pg-boss marks the job completed only once the handler returns, and the
    // handler still has `problems(vault)` and `advisories(client)` to run
    // after the write above. Reading `needs_you` and reading `completed` are
    // two different effects of the same handler, in that order, so this polls
    // for the second rather than assuming it is already true the instant the
    // first lands. KPA-164 found this flaking on the single read.
    const jobDeadline = Date.now() + 30_000;
    let done = 0;
    while (done === 0 && Date.now() < jobDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const found = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${QUEUE_SCHEMA}.job
          WHERE name = $1 AND state = 'completed'`,
        [NIGHTLY],
      );
      done = Number(found.rows[0]!.n);
    }

    assert.equal(done, 1, 'and the queue records the job it finished');
  });

  test('a review that breaks leaves a needs_you row saying so', async () => {
    // A real failure, not a stub: the advisories read `edges`, so a rename
    // takes the table out from under the third of the three. The sweep has
    // already run and written by then, which is the honest shape of a
    // half-finished night.
    await client.query('ALTER TABLE edges RENAME TO edges_hidden');
    try {
      await boss.send(NIGHTLY, {});

      const deadline = Date.now() + 30_000;
      let raised: { detail: string } | undefined;
      while (!raised && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const found = await client.query<{ detail: string }>(
          'SELECT detail FROM needs_you WHERE title = $1',
          [FAILED],
        );
        raised = found.rows[0];
      }

      assert.ok(raised, 'the failure reached needs_you, not only the log');
      assert.match(raised.detail, /edges/, 'and it says what broke');
    } finally {
      await client.query('ALTER TABLE edges_hidden RENAME TO edges');
      await client.query('DELETE FROM needs_you');
    }
  });

  test('schedules the expiry sweep daily, and removes only what expired', async () => {
    // `scheduleExpiry` sends one start-up job itself, before any row below
    // exists, so that first run removes nothing. The job it registers is
    // what this test reads next.
    await scheduleExpiry(boss, client);

    const cron = await client.query<{ name: string; cron: string }>(
      `SELECT name, cron FROM ${QUEUE_SCHEMA}.schedule WHERE name = $1`,
      [EXPIRY],
    );
    assert.equal(cron.rows[0]?.cron, EXPIRY_CRON, 'the worker registered the sweep on a cron');

    const liveSession = await session(client, false);
    await session(client, true);
    const liveGrant = await grant(client, false);
    await grant(client, true);

    await boss.send(EXPIRY, {});

    const deadline = Date.now() + 30_000;
    let sessionsLeft = await countRows(client, 'sessions');
    let grantsLeft = await countRows(client, 'oauth_grants');
    while ((sessionsLeft > 1 || grantsLeft > 1) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      sessionsLeft = await countRows(client, 'sessions');
      grantsLeft = await countRows(client, 'oauth_grants');
    }

    const remainingSessions = await client.query<{ id: string }>('SELECT id FROM sessions');
    assert.deepEqual(remainingSessions.rows.map((row) => row.id), [liveSession]);
    const remainingGrants = await client.query<{ id: string }>('SELECT id FROM oauth_grants');
    assert.deepEqual(remainingGrants.rows.map((row) => row.id), [liveGrant]);
  });

  test('a sweep that fails does not stop the other, and the job still completes', async () => {
    // A real failure, not a stub, the same way the nightly review test above
    // breaks a table the advisories read.
    await scheduleExpiry(boss, client);
    const liveGrant = await grant(client, false);
    await grant(client, true);

    await client.query('ALTER TABLE sessions RENAME TO sessions_hidden');
    try {
      await boss.send(EXPIRY, {});

      const deadline = Date.now() + 30_000;
      let grantsLeft = await countRows(client, 'oauth_grants');
      while (grantsLeft > 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        grantsLeft = await countRows(client, 'oauth_grants');
      }

      const remaining = await client.query<{ id: string }>('SELECT id FROM oauth_grants');
      assert.deepEqual(
        remaining.rows.map((row) => row.id),
        [liveGrant],
        'the grants sweep ran and removed the expired one, even though sessions could not be reached',
      );

      const done = await client.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${QUEUE_SCHEMA}.job WHERE name = $1 AND state = 'completed'`,
        [EXPIRY],
      );
      assert.ok(
        Number(done.rows[0]!.n) > 0,
        'the handler did not reject, so pg-boss marked the job completed rather than retrying it',
      );
    } finally {
      await client.query('ALTER TABLE sessions_hidden RENAME TO sessions');
    }
  });
});

// ---------------------------------------------------------------------------
// The nightly review. Three things that already worked, on a schedule, plus
// the one thing none of them had: a run that breaks says so where Shane looks.
// ---------------------------------------------------------------------------

describe('the nightly review', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
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
    await client.query('DELETE FROM needs_you');
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM facts');
    await client.query("DELETE FROM nodes WHERE kind = 'fact'");
  });

  /** One live, verified fact, past its review date on `staleAfter`. */
  async function stale(path: string, staleAfter: string): Promise<void> {
    await client.query('BEGIN');
    const node = await client.query<{ id: string }>(
      "INSERT INTO nodes (kind) VALUES ('fact') RETURNING id",
    );
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, entity, state,
                          valid_from, verified, verified_by, stale_after)
       VALUES ($1, $2, 'reference', $2, 'one line', 'shared', 'Some Entity',
               'proposed', '2026-01-01', '2026-01-01', 'human:shane', $3)`,
      [node.rows[0]!.id, path, staleAfter],
    );
    await client.query('COMMIT');
  }

  /** Every column of every fact, as text. The sweep must change none of it. */
  async function factsNow(): Promise<string> {
    const rows = await client.query(
      'SELECT to_jsonb(f) AS row FROM facts f ORDER BY path',
    );
    return JSON.stringify(rows.rows);
  }

  async function items(): Promise<{ kind: string; title: string; detail: string }[]> {
    const found = await client.query<{ kind: string; title: string; detail: string }>(
      'SELECT kind, title, detail FROM needs_you ORDER BY id',
    );
    return found.rows;
  }

  test('reads the day in Sydney, as the text every date here is compared as', () => {
    // 31 December 2026, 14:00 UTC, is already 1 January in Sydney.
    assert.equal(dayIn(ZONE, new Date('2026-12-31T14:00:00Z')), '2027-01-01');
    assert.equal(dayIn('UTC', new Date('2026-12-31T14:00:00Z')), '2026-12-31');
  });

  test('runs all three, and reports what each found', async () => {
    await stale('shared/overdue.md', '2026-01-31');
    await stale('shared/not-yet.md', '2027-06-01');

    const report = await nightly(client, '2026-08-27', '/nonexistent-vault-for-kpa-85');

    assert.equal(report.today, '2026-08-27');
    assert.equal(report.stale, 1);
    assert.equal(report.raised, 1);
    assert.deepEqual(report.problems, [], 'no vault, so the six problems find nothing');
    // Both facts are in `shared`, which orphans exempts, and neither carries
    // an edge or a source, so the four advisories have nothing to say. An
    // empty list here is the checks running and finding nothing, not skipping.
    assert.deepEqual(report.advisories, []);
  });

  test('the sweep writes needs_you and leaves every fact exactly as it was', async () => {
    await stale('shared/overdue.md', '2026-01-31');
    const before = await factsNow();

    await nightly(client, '2026-08-27', '/nonexistent-vault-for-kpa-85');

    assert.equal(await factsNow(), before, 'the sweep must change no fact state');
    const raised = await items();
    assert.equal(raised.length, 1);
    assert.equal(raised[0]!.kind, 'deadline');
  });

  test('two runs in one night open no duplicate item', async () => {
    await stale('shared/overdue.md', '2026-01-31');

    const first = await nightly(client, '2026-08-27', '/nonexistent-vault-for-kpa-85');
    const second = await nightly(client, '2026-08-27', '/nonexistent-vault-for-kpa-85');

    assert.equal(first.raised, 1);
    assert.equal(second.raised, 0, 'the second run of the night raises nothing new');
    assert.equal((await items()).length, 1);
  });

  test('a failure opens one needs_you row, and a second failure opens no second', async () => {
    assert.equal(await raiseFailure(client, '2026-08-27: the database went away'), true);
    assert.equal(await raiseFailure(client, '2026-08-28: it is still away'), false);

    const raised = await items();
    assert.equal(raised.length, 1);
    assert.equal(raised[0]!.kind, 'question');
    assert.equal(raised[0]!.title, FAILED);
    assert.match(raised[0]!.detail, /the database went away/);
  });

  test('a failure raises again once Shane has closed the last one', async () => {
    await raiseFailure(client, '2026-08-27: broke');
    await client.query('UPDATE needs_you SET closed_at = now()');

    assert.equal(await raiseFailure(client, '2026-08-28: broke again'), true);
    assert.equal((await items()).length, 2, 'a job that will not run has to keep saying so');
  });
});
