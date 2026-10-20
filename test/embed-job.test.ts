import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import type { ClientBase } from 'pg';

import { KEY_VARIABLE } from '../src/connections/crypto.ts';
import { addConnection, removeConnection, setCredential } from '../src/connections/store.ts';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { EMBEDDING } from '../src/embedding.ts';
import { EMBED, EMBED_CRON, EXPIRE_IN_SECONDS, RUN_BUDGET_SECONDS, run, schedule, work } from '../src/worker/embed.ts';
import { QUEUE_SCHEMA, leave, queue } from '../src/worker/index.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const INDEX = path.join(import.meta.dirname, '..', 'src', 'worker', 'index.ts');
const url = process.env['DATABASE_URL_TEST'];

const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const SECRET = 'test-voyage-key-not-real';

/** A vector no real model would make, distinct per text length, the right width. */
function vectorFor(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING.dimension }, () => 0);
  vector[text.length % EMBEDDING.dimension] = 1;
  return vector;
}

/** Voyage, played locally. It remembers the key and the texts of every call. */
function voyageFetch(): { fetcher: typeof fetch; calls: Array<{ key: string; input: string[] }> } {
  const calls: Array<{ key: string; input: string[] }> = [];
  const fetcher = (async (target: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(target), VOYAGE_URL, 'the test Voyage answers one address');
    const { input } = JSON.parse(String(init?.body)) as { input: string[] };
    const bearer = new Headers(init?.headers).get('authorization') ?? '';
    calls.push({ key: bearer.replace('Bearer ', ''), input });
    return Response.json({ data: input.map((text, index) => ({ index, embedding: vectorFor(text) })) });
  }) as typeof fetch;
  return { fetcher, calls };
}

describe('the embedding job', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  const held: Record<string, string | undefined> = {};

  before(async () => {
    held[KEY_VARIABLE] = process.env[KEY_VARIABLE];
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
    if (held[KEY_VARIABLE] === undefined) delete process.env[KEY_VARIABLE];
    else process.env[KEY_VARIABLE] = held[KEY_VARIABLE];
  });

  beforeEach(async () => {
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM source_chunks');
    await client.query('DELETE FROM facts');
    await client.query('DELETE FROM sources');
    await client.query("DELETE FROM nodes WHERE kind IN ('fact', 'source')");
    await client.query('DELETE FROM connections');
  });

  afterEach(() => {
    mock.restoreAll();
  });

  async function node(kind: string): Promise<string> {
    const created = await client.query<{ id: string }>('INSERT INTO nodes (kind) VALUES ($1) RETURNING id', [kind]);
    return created.rows[0]!.id;
  }

  async function source(sourcePath: string, body: string): Promise<string> {
    await client.query('BEGIN');
    const id = await node('source');
    await client.query('INSERT INTO sources (id, path, body) VALUES ($1, $2, $3)', [id, sourcePath, body]);
    await client.query('COMMIT');
    return id;
  }

  async function fact(factPath: string, title: string, description: string): Promise<string> {
    await client.query('BEGIN');
    const id = await node('fact');
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, $2, 'reference', $3, $4, 'shared', 'proposed', '2026-01-01')`,
      [id, factPath, title, description],
    );
    await client.query('COMMIT');
    return id;
  }

  async function voyageConnection(): Promise<string> {
    const id = await addConnection(client, { provider: 'voyage', name: 'Voyage', method: 'key' });
    await setCredential(client, id, SECRET);
    return id;
  }

  async function counts(): Promise<{ chunks: number; chunksEmbedded: number; factsEmbedded: number }> {
    const found = await client.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM source_chunks) AS chunks,
              (SELECT count(embedding) FROM source_chunks) AS chunks_embedded,
              (SELECT count(embedding) FROM facts) AS facts_embedded`,
    );
    const row = found.rows[0]!;
    return {
      chunks: Number(row['chunks']),
      chunksEmbedded: Number(row['chunks_embedded']),
      factsEmbedded: Number(row['facts_embedded']),
    };
  }

  /** Polls `read` until `done` holds or thirty seconds pass, and returns the last answer. */
  async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 30_000;
    let value = await read();
    while (!done(value) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      value = await read();
    }
    return value;
  }

  test('does nothing, and says so, when no voyage connection holds a key', async () => {
    await source('a.md', '# One\n\nSome text.\n');
    await fact('f.md', 'A title', 'A description.');
    const voyage = voyageFetch();

    assert.equal(await run(client, voyage.fetcher), null);

    assert.equal(voyage.calls.length, 0);
    assert.deepEqual(await counts(), { chunks: 0, chunksEmbedded: 0, factsEmbedded: 0 });
  });

  test('reads the key from the connection, then chunks and embeds a source and a fact', async () => {
    await voyageConnection();
    await source('a.md', '# One\n\nSome text.\n');
    await fact('f.md', 'A title', 'A description.');
    const voyage = voyageFetch();

    const found = await run(client, voyage.fetcher);

    assert.deepEqual(await counts(), { chunks: 1, chunksEmbedded: 1, factsEmbedded: 1 });
    assert.deepEqual([found?.embedded.embedded, found?.embedded.failed], [2, 0]);
    assert.deepEqual(
      voyage.calls.map((call) => call.key),
      [SECRET, SECRET],
      'the key in the connection went out as the bearer',
    );
  });

  test('a second run sends nothing and changes no row count, and a later arrival is embedded', async () => {
    await voyageConnection();
    await source('a.md', '# One\n\nSome text.\n');
    const voyage = voyageFetch();
    await run(client, voyage.fetcher);
    const rows = await client.query('SELECT id FROM source_chunks ORDER BY id');

    await run(client, voyage.fetcher);

    assert.equal(voyage.calls.length, 1, 'nothing was sent the second time');
    assert.deepEqual((await client.query('SELECT id FROM source_chunks ORDER BY id')).rows, rows.rows);

    await fact('f.md', 'Late', 'Arrived after the first run.');
    await run(client, voyage.fetcher);

    assert.equal(voyage.calls.length, 2);
    assert.deepEqual(voyage.calls[1]?.input, ['Late\n\nArrived after the first run.']);
  });

  test('logs a missing key once, and again only after a key was there and went', async () => {
    const warn = mock.method(console, 'warn', () => {});
    mock.method(console, 'log', () => {});
    const handler = work('DATABASE_URL_TEST', voyageFetch().fetcher);

    await handler();
    await handler();
    await handler();
    assert.equal(warn.mock.callCount(), 1, 'three ticks, one line');
    assert.match(String(warn.mock.calls[0]?.arguments[0]), /no voyage connection holds a key/);

    const id = await voyageConnection();
    await handler();
    assert.equal(warn.mock.callCount(), 1, 'a run that finds a key logs no warning');

    await removeConnection(client, id);
    await handler();
    await handler();
    assert.equal(warn.mock.callCount(), 2, 'a key lost again is said again, once');
  });

  test('a handler leaves no connection open', async () => {
    await voyageConnection();
    mock.method(console, 'log', () => {});
    const open = async (): Promise<number> =>
      Number(
        (await client.query<{ n: string }>('SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database()'))
          .rows[0]!.n,
      );
    const before = await open();

    await work('DATABASE_URL_TEST', voyageFetch().fetcher)();

    // The server drops a closed backend a moment after the client says goodbye.
    assert.equal(await until(open, (n) => n <= before), before);
  });

  /** Ends every other session on the test database: the one under test, idle between its statements. */
  async function terminateOthers(): Promise<void> {
    await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()',
    );
    // The socket closes a moment later, and the listener hears of it then.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  test('a connection lost while the run waits on Voyage fails the run and leaves the process alive', async () => {
    await voyageConnection();
    await source('a.md', '# One\n\nSome text.\n');
    const logged = mock.method(console, 'error', () => {});
    mock.method(console, 'log', () => {});
    const voyage = voyageFetch();
    const killing = (async (target: string | URL | Request, init?: RequestInit) => {
      await terminateOthers();
      return voyage.fetcher(target, init);
    }) as typeof fetch;

    await assert.rejects(work('DATABASE_URL_TEST', killing)());

    assert.match(String(logged.mock.calls[0]?.arguments[0]), /memory\.embed: database connection lost/);
  });

  test('the time budget is below the queue expiry', () => {
    assert.ok(RUN_BUDGET_SECONDS < EXPIRE_IN_SECONDS);
  });

  test('the worker exits non-zero when its shared connection is lost', async () => {
    const child = spawn(process.execPath, [INDEX], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += String(chunk)));
    child.stderr.on('data', (chunk: Buffer) => (output += String(chunk)));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    const killer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    try {
      await until(
        () => Promise.resolve(output),
        (text) => text.includes(`${EMBED} at ${EMBED_CRON}`),
      );
      await terminateOthers();
      assert.equal(await exited, 1, output);
      assert.match(output, /kpa-worker: database connection lost/);
    } finally {
      clearTimeout(killer);
      child.kill('SIGKILL');
      await client.query('DELETE FROM pgboss.job');
      await client.query('DELETE FROM pgboss.schedule');
    }
  });

  test('a lost connection stops the queue before it exits, and exits even when the stop hangs', async () => {
    mock.method(console, 'error', () => {});
    const exits: number[] = [];
    let stopped: unknown;
    const stops = { stop: (options?: unknown) => ((stopped = options), Promise.resolve()) };
    await leave(stops, new Error('gone'), (code) => exits.push(code), 50);
    assert.deepEqual(exits, [1]);
    assert.ok(stopped, 'the queue was stopped first');

    const hung = { stop: () => new Promise<void>(() => {}) };
    const started = Date.now();
    await leave(hung, new Error('gone'), (code) => exits.push(code), 50);
    assert.deepEqual(exits, [1, 1]);
    assert.ok(Date.now() - started < 2000, 'a hung stop does not hold the exit');

    const broken = { stop: () => Promise.reject(new Error('stop failed')) };
    await leave(broken, new Error('gone'), (code) => exits.push(code), 50);
    assert.deepEqual(exits, [1, 1, 1]);
  });

  test('main() calls the embed schedule at start-up', async () => {
    const text = await readFile(INDEX, 'utf8');
    assert.match(text, /schedule as scheduleEmbed\s*\}\s*from\s*'\.\/embed\.ts'/, 'index.ts imports it');
    assert.match(text, /await scheduleEmbed\(boss\)/, 'main() calls it, not only imports it');
  });

  describe('on the queue', () => {
    let boss: ReturnType<typeof queue>;

    before(async () => {
      boss = queue('DATABASE_URL_TEST');
      boss.on('error', () => {});
      await boss.start();
    });

    after(async () => {
      await boss.stop();
    });

    test('runs on a cron and at start-up, finds no key and completes, then embeds once a key arrives', async () => {
      const voyage = voyageFetch();
      await source('a.md', '# One\n\nSome text.\n');
      await fact('f.md', 'A title', 'A description.');
      mock.method(console, 'warn', () => {});

      // schedule() sends one start-up job, and no connection exists yet.
      await schedule(boss, 'DATABASE_URL_TEST', voyage.fetcher);

      const cron = await client.query<{ cron: string }>(`SELECT cron FROM ${QUEUE_SCHEMA}.schedule WHERE name = $1`, [EMBED]);
      assert.equal(cron.rows[0]?.cron, EMBED_CRON, 'the backlog sweep is on a cron');
      const expiry = await client.query<{ expire_seconds: number }>(
        `SELECT expire_seconds FROM ${QUEUE_SCHEMA}.queue WHERE name = $1`,
        [EMBED],
      );
      assert.equal(expiry.rows[0]?.expire_seconds, EXPIRE_IN_SECONDS, 'the queue sets its own expiry');

      const states = (): Promise<Record<string, number>> =>
        client
          .query<{ state: string; n: string }>(
            `SELECT state, count(*) AS n FROM ${QUEUE_SCHEMA}.job WHERE name = $1 GROUP BY state`,
            [EMBED],
          )
          .then((found) => Object.fromEntries(found.rows.map((row) => [row.state, Number(row.n)])));
      const first = await until(states, (found) => (found['completed'] ?? 0) >= 1);
      assert.equal(first['completed'], 1, 'a missing key completes the job');
      assert.equal(first['failed'] ?? 0, 0, 'and does not fail it');
      assert.equal(first['retry'] ?? 0, 0);
      assert.equal(voyage.calls.length, 0);
      assert.deepEqual(await counts(), { chunks: 0, chunksEmbedded: 0, factsEmbedded: 0 }, 'it did nothing');

      // The key arrives, and an ingestion job asks for a run.
      await voyageConnection();
      await boss.send(EMBED, {});

      const done = await until(counts, (found) => found.chunksEmbedded >= 1 && found.factsEmbedded >= 1);
      assert.deepEqual(done, { chunks: 1, chunksEmbedded: 1, factsEmbedded: 1 }, 'embedded with nobody running a script');
      assert.ok(voyage.calls.length >= 1);
      assert.ok(voyage.calls.every((call) => call.key === SECRET));
    });
  });
});
