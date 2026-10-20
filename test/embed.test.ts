import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { ClientBase } from 'pg';
import { connect, refuseProduction } from '../src/db/connect.ts';
import { down, up } from '../src/db/migrate.ts';
import { EMBEDDING } from '../src/embedding.ts';
import {
  BACKOFF_MS,
  chunkSources,
  EmbedError,
  type Embedder,
  embedPending,
  GIVE_UP_AFTER,
  type InputKind,
  MAX_WAIT_MS,
  TRIES_PER_RUN,
} from '../src/embed/embedder.ts';
import { parseRetryAfter, voyage } from '../src/embed/voyage.ts';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const url = process.env['DATABASE_URL_TEST'];

/** A vector no real model would make, distinct per text, the right width. */
function vectorFor(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING.dimension }, () => 0);
  vector[text.length % EMBEDDING.dimension] = 1;
  return vector;
}

/** Answers without the network, and remembers what it was asked. */
function fake(): Embedder & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    embed(texts: string[], _kind: InputKind): Promise<number[][]> {
      calls.push(texts);
      return Promise.resolve(texts.map(vectorFor));
    },
  };
}

/** Throws `error` on every call. */
function failing(error: Error): Embedder & { calls: number } {
  const self = {
    calls: 0,
    embed(): Promise<number[][]> {
      self.calls += 1;
      return Promise.reject(error);
    },
  };
  return self;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** A promise settled from outside, to hold one run between its read and its write. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A refusal every row would meet: a rejected key. */
const rejectedKey = (): EmbedError => new EmbedError('voyage answered 401: bad key', false, undefined, true);

describe('embedding', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
  /** A second connection, for the run that overtakes the first. */
  let other: ClientBase & { end: () => Promise<void> };
  const sleeps: number[] = [];
  const sleep = (ms: number): Promise<void> => {
    sleeps.push(ms);
    return Promise.resolve();
  };

  before(async () => {
    client = connect('DATABASE_URL_TEST');
    await client.connect();
    await refuseProduction(client);
    await down(client, MIGRATIONS);
    await up(client, MIGRATIONS);
    other = connect('DATABASE_URL_TEST');
    await other.connect();
  });

  after(async () => {
    await other.end();
    await down(client, MIGRATIONS);
    await client.end();
  });

  beforeEach(async () => {
    sleeps.length = 0;
    await client.query('DELETE FROM edges');
    await client.query('DELETE FROM source_chunks');
    await client.query('DELETE FROM facts');
    await client.query('DELETE FROM sources');
    await client.query("DELETE FROM nodes WHERE kind IN ('fact', 'source')");
  });

  async function node(kind: string): Promise<string> {
    const created = await client.query<{ id: string }>(
      'INSERT INTO nodes (kind) VALUES ($1) RETURNING id',
      [kind],
    );
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

  const section = (word: string): string =>
    Array.from({ length: 20 }, (_, i) => `${word} sentence ${i}.`).join(' ');

  /** Two sources and one fact: three chunks in all, plus the fact. */
  async function seed(): Promise<void> {
    await source('a.md', `# One\n\n${section('alpha')}\n\n# Two\n\n${section('beta')}\n`);
    await source('b.md', `日本語 ${section('gamma')}`);
    await fact('f.md', 'A title', 'A description.');
  }

  async function counts(): Promise<{ chunks: number; facts: number; chunksEmbedded: number; factsEmbedded: number }> {
    const found = await client.query<Record<string, string>>(
      `SELECT (SELECT count(*) FROM source_chunks) AS chunks,
              (SELECT count(*) FROM facts) AS facts,
              (SELECT count(embedding) FROM source_chunks) AS chunks_embedded,
              (SELECT count(embedding) FROM facts) AS facts_embedded`,
    );
    const row = found.rows[0]!;
    return {
      chunks: Number(row['chunks']),
      facts: Number(row['facts']),
      chunksEmbedded: Number(row['chunks_embedded']),
      factsEmbedded: Number(row['facts_embedded']),
    };
  }

  test('chunks each source with ranges that read back as the stored text', async () => {
    await seed();
    const chunked = await chunkSources(client);

    assert.deepEqual(chunked, { sources: 2, chunks: 3, failures: [] });
    const rows = await client.query<{ path: string; ordinal: number; text: string }>(
      `SELECT s.path, c.ordinal,
              convert_from(substring(convert_to(s.body, 'UTF8') FROM c.byte_start + 1
                                     FOR c.byte_end - c.byte_start), 'UTF8') AS text
         FROM source_chunks c JOIN sources s ON s.id = c.source_id ORDER BY s.path, c.ordinal`,
    );
    assert.deepEqual(
      rows.rows.map((row) => [row.path, row.ordinal, row.text.slice(0, 7)]),
      [['a.md', 0, '# One\n\n'], ['a.md', 1, '# Two\n\n'], ['b.md', 0, '日本語 gam']],
    );
  });

  test('embeds every chunk and fact, and a second run changes nothing', async () => {
    await seed();
    const embedder = fake();

    await chunkSources(client);
    const first = await embedPending(client, embedder, { sleep });
    assert.deepEqual([first.embedded, first.failed, first.skipped], [4, 0, 0]);
    const before = await counts();
    assert.deepEqual(before, { chunks: 3, facts: 1, chunksEmbedded: 3, factsEmbedded: 1 });

    const ids = await client.query('SELECT id FROM source_chunks ORDER BY id');
    const calls = embedder.calls.length;
    await chunkSources(client);
    const second = await embedPending(client, embedder, { sleep });

    assert.deepEqual([second.embedded, second.failed], [0, 0]);
    assert.equal(embedder.calls.length, calls, 'nothing was sent the second time');
    assert.deepEqual(await counts(), before);
    assert.deepEqual(await client.query('SELECT id FROM source_chunks ORDER BY id'), ids, 'same rows, same ids');
  });

  test('embeds a fact as its title and description', async () => {
    await fact('f.md', 'A title', 'A description.');
    const embedder = fake();
    await embedPending(client, embedder, { sleep });

    assert.deepEqual(embedder.calls, [['A title\n\nA description.']]);
  });

  test('keeps an embedding when the range is unchanged and replaces the row when the range moves', async () => {
    const id = await source('a.md', `# One\n\n${section('alpha')}\n`);
    await chunkSources(client);
    await embedPending(client, fake(), { sleep });
    const kept = await client.query<{ id: string }>('SELECT id FROM source_chunks');
    await chunkSources(client);
    assert.equal((await counts()).chunksEmbedded, 1, 'unchanged range keeps its vector');
    assert.deepEqual((await client.query('SELECT id FROM source_chunks')).rows, kept.rows, 'and its id');

    await client.query('UPDATE sources SET body = $2 WHERE id = $1', [id, `# One\n\n${section('omega')}\nmore.\n`]);
    const result = await chunkSources(client);
    assert.deepEqual(result.failures, []);
    const after = await client.query<{ id: string; embedding: string | null; embed_attempts: number }>(
      'SELECT id, embedding, embed_attempts FROM source_chunks',
    );
    assert.equal(after.rowCount, 1);
    assert.notEqual(after.rows[0]?.id, kept.rows[0]?.id, 'an uncited moved chunk gets a new id');
    assert.equal(after.rows[0]?.embedding, null, 'the vector described other text');
    assert.equal(after.rows[0]?.embed_attempts, 0);
  });

  /** A fact citing one chunk of a source, the way a derived_from edge does. */
  async function cite(sourceId: string): Promise<string> {
    const chunk = await client.query<{ id: string }>('SELECT id FROM source_chunks WHERE source_id = $1', [sourceId]);
    await client.query('BEGIN');
    const from = await node('fact');
    await client.query(
      `INSERT INTO facts (id, path, type, title, description, space, state, valid_from)
       VALUES ($1, 'cites.md', 'reference', 't', 'd', 'shared', 'proposed', '2026-01-01')`,
      [from],
    );
    await client.query("INSERT INTO edges (from_id, to_id, kind, chunk_id) VALUES ($1, $2, 'derived_from', $3)", [
      from,
      sourceId,
      chunk.rows[0]!.id,
    ]);
    await client.query('COMMIT');
    return chunk.rows[0]!.id;
  }

  const passage = async (chunkId: string): Promise<string> =>
    (
      await client.query<{ text: string }>(
        `SELECT convert_from(substring(convert_to(s.body, 'UTF8') FROM c.byte_start + 1
                                       FOR c.byte_end - c.byte_start), 'UTF8') AS text
           FROM source_chunks c JOIN sources s ON s.id = c.source_id WHERE c.id = $1`,
        [chunkId],
      )
    ).rows[0]!.text;

  test('a cited chunk whose range moves fails its source and keeps the citation on the old text', async () => {
    const body = `# One\n\n${section('alpha')}\n`;
    const id = await source('a.md', body);
    await chunkSources(client);
    const chunkId = await cite(id);
    const range = await client.query('SELECT byte_start, byte_end FROM source_chunks WHERE id = $1', [chunkId]);

    await client.query('UPDATE sources SET body = $2 WHERE id = $1', [id, `${body}\nmore.\n`]);
    const result = await chunkSources(client);

    assert.equal(result.failures.length, 1);
    assert.equal(result.failures[0]?.sourceId, id);
    assert.match(result.failures[0]?.reason ?? '', /foreign key/);
    const edge = await client.query('SELECT chunk_id FROM edges');
    assert.deepEqual(edge.rows, [{ chunk_id: chunkId }], 'the citation is unchanged');
    assert.deepEqual(
      await client.query('SELECT byte_start, byte_end FROM source_chunks WHERE id = $1', [chunkId]),
      range,
      'the row still holds the cited range',
    );
    assert.equal((await passage(chunkId)).slice(0, 5), '# One');
  });

  test('one failing source does not stop the sources after it', async () => {
    const body = `# One\n\n${section('alpha')}\n`;
    const first = await source('a.md', body);
    await chunkSources(client);
    await cite(first);
    await client.query('UPDATE sources SET body = $2 WHERE id = $1', [first, `${body}\nmore.\n`]);
    const later = await source('b.md', `# Two\n\n${section('beta')}\n`);

    const result = await chunkSources(client);

    assert.deepEqual(result.failures.map((failure) => failure.sourceId), [first]);
    assert.equal(result.sources, 2);
    assert.equal(result.chunks, 1, 'counts the chunks of the source that succeeded');
    const written = await client.query('SELECT 1 FROM source_chunks WHERE source_id = $1', [later]);
    assert.equal(written.rowCount, 1, 'the later source was chunked');
  });

  test('one bad text does not fail the rest of its batch', async () => {
    const ids: string[] = [];
    for (const [i, label] of ['a', 'b', 'POISON', 'd', 'e'].entries()) {
      ids.push(await fact(`f${i}.md`, `title ${label}`, 'A description.'));
    }
    const calls: string[][] = [];
    const picky: Embedder = {
      embed(texts) {
        calls.push(texts);
        if (texts.some((text) => text.includes('POISON'))) {
          return Promise.reject(new EmbedError('voyage answered 400: bad text', false));
        }
        return Promise.resolve(texts.map(vectorFor));
      },
    };

    const result = await embedPending(client, picky, { sleep });

    assert.deepEqual([result.embedded, result.failed], [4, 1]);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]?.includes(ids[2]!), 'names the bad row');
    const rows = await client.query<{ title: string; embedded: boolean; embed_attempts: number }>(
      'SELECT title, embedding IS NOT NULL AS embedded, embed_attempts FROM facts ORDER BY path',
    );
    assert.deepEqual(
      rows.rows.map((row) => [row.title.slice(-1), row.embedded]),
      [['a', true], ['b', true], ['N', false], ['d', true], ['e', true]],
    );
    assert.equal(rows.rows.find((row) => row.title.endsWith('N'))?.embed_attempts, 1, 'one try on the bad row');
    for (const row of rows.rows.filter((r) => r.embedded)) {
      assert.equal(row.embed_attempts, 1, 'a good row counts only its own successful call');
    }
    assert.ok(calls.length <= 1 + 2 * Math.ceil(Math.log2(5)) + 1, `${calls.length} calls`);
    assert.deepEqual(sleeps, [], 'a refusal that would repeat waits for nothing');
  });

  /** Throws each of `errors` in turn, then answers. */
  function flaky(errors: EmbedError[]): Embedder {
    let call = 0;
    return {
      embed(texts) {
        const error = errors[call++];
        return error ? Promise.reject(error) : Promise.resolve(texts.map(vectorFor));
      },
    };
  }

  test('waits for Retry-After when it is longer than the backoff', async () => {
    await fact('f.md', 'A title', 'A description.');
    const provider = flaky([
      new EmbedError('voyage answered 429: slow down', true, BACKOFF_MS * 5),
      new EmbedError('voyage answered 429: slow down', true, 10),
    ]);

    const result = await embedPending(client, provider, { sleep });

    assert.equal(result.embedded, 1);
    assert.deepEqual(sleeps, [BACKOFF_MS * 5, BACKOFF_MS * 2], 'the ask wins, then the backoff when it is longer');
  });

  test('never waits longer than MAX_WAIT_MS, whatever Retry-After asks', async () => {
    await fact('f.md', 'A title', 'A description.');
    const provider = flaky([new EmbedError('voyage answered 503: busy', true, 60 * 60 * 1000)]);

    await embedPending(client, provider, { sleep });

    assert.deepEqual(sleeps, [MAX_WAIT_MS]);
  });

  test('a failing provider halts the run, leaves rows null and charges no row', async () => {
    await seed();
    await chunkSources(client);
    const provider = failing(new EmbedError('voyage answered 503: busy', true));

    const result = await embedPending(client, provider, { sleep });

    assert.equal(result.embedded, 0);
    assert.equal(result.failed, 0, 'no row was refused; the provider was down');
    assert.equal(provider.calls, TRIES_PER_RUN, 'the chunks use up their tries and the facts are not tried');
    assert.deepEqual(sleeps, [BACKOFF_MS, BACKOFF_MS * 2], 'waits double');
    assert.match(result.halted ?? '', /^source_chunks: .*503/);
    assert.deepEqual(result.errors, [result.halted]);
    const rows = await client.query<{ embedding: string | null; embed_attempts: number }>(
      `SELECT embedding, embed_attempts FROM source_chunks
       UNION ALL SELECT embedding, embed_attempts FROM facts`,
    );
    assert.equal(rows.rowCount, 4);
    for (const row of rows.rows) {
      assert.equal(row.embedding, null);
      assert.equal(row.embed_attempts, 0, 'a provider fault is not the row\'s fault');
    }

    const later = await embedPending(client, fake(), { sleep });
    assert.equal(later.embedded, 4, 'a later run embeds what failed');
  });

  test('an outage of any length parks nothing: every call a 503, run after run', async () => {
    await seed();
    await chunkSources(client);
    const outage = failing(new EmbedError('voyage answered 503: busy', true));

    // Under the old count three tries a run reached GIVE_UP_AFTER in four runs.
    for (let run = 1; run <= GIVE_UP_AFTER; run += 1) {
      const result = await embedPending(client, outage, { sleep });
      assert.deepEqual([result.embedded, result.failed, result.skipped], [0, 0, 0], `run ${run}`);
      assert.match(result.halted ?? '', /503/, `run ${run} says why it stopped`);
    }
    assert.equal(outage.calls, TRIES_PER_RUN * GIVE_UP_AFTER, 'three calls a run and no more');

    const rows = await client.query<{ embedding: string | null; embed_attempts: number }>(
      `SELECT embedding, embed_attempts FROM source_chunks
       UNION ALL SELECT embedding, embed_attempts FROM facts`,
    );
    assert.equal(rows.rowCount, 4);
    for (const row of rows.rows) {
      assert.equal(row.embedding, null);
      assert.equal(row.embed_attempts, 0);
    }
    const recovered = await embedPending(client, fake(), { sleep });
    assert.deepEqual([recovered.embedded, recovered.skipped], [4, 0], 'the first tick after recovery embeds everything');
  });

  test('three batches against an always-503 provider cost TRIES_PER_RUN calls, not three times that', async () => {
    for (let i = 0; i < 150; i += 1) await fact(`f${i}.md`, `title ${i}`, 'A description.');
    const outage = failing(new EmbedError('voyage answered 503: busy', true));

    const result = await embedPending(client, outage, { sleep });

    assert.equal(outage.calls, TRIES_PER_RUN, '150 facts are 64 + 64 + 22, and only the first batch is tried');
    assert.match(result.halted ?? '', /^facts: .*503/);
    assert.deepEqual([result.embedded, result.failed], [0, 0]);
    const charged = await client.query("SELECT count(*) AS n FROM facts WHERE embed_attempts <> 0");
    assert.equal(charged.rows[0]?.['n'], '0');
  });

  test('a provider that goes down part way keeps the batches already written', async () => {
    for (let i = 0; i < 150; i += 1) await fact(`f${i}.md`, `title ${i}`, 'A description.');
    let call = 0;
    const failsAfterOne: Embedder = {
      embed(texts) {
        call += 1;
        return call === 1
          ? Promise.resolve(texts.map(vectorFor))
          : Promise.reject(new EmbedError('voyage answered 503: busy', true));
      },
    };

    const result = await embedPending(client, failsAfterOne, { sleep });

    assert.equal(call, 1 + TRIES_PER_RUN, 'one good batch, then the second batch uses its tries and the run stops');
    assert.equal(result.embedded, 64);
    assert.match(result.halted ?? '', /503/);
    assert.equal((await counts()).factsEmbedded, 64);
    const charged = await client.query("SELECT count(*) AS n FROM facts WHERE embed_attempts > 1");
    assert.equal(charged.rows[0]?.['n'], '0', 'only the successful calls are counted');
  });

  test('the outage rule covers every provider fault: a timeout, a network error and a raw error', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    for (const error of [
      new EmbedError('voyage timed out after 30000 ms', true),
      new EmbedError('voyage unreachable: socket hang up', true),
      new Error('something the embedder did not classify'),
    ]) {
      await embedPending(client, failing(error), { sleep });
    }
    const row = await client.query<{ embed_attempts: number }>('SELECT embed_attempts FROM facts WHERE id = $1', [id]);
    assert.equal(row.rows[0]?.embed_attempts, 0);
  });

  test('a poison row still reaches GIVE_UP_AFTER while the others embed', async () => {
    const ids: string[] = [];
    for (const [i, label] of ['a', 'b', 'POISON', 'd', 'e'].entries()) {
      ids.push(await fact(`f${i}.md`, `title ${label}`, 'A description.'));
    }
    const calls: string[][] = [];
    const picky: Embedder = {
      embed(texts) {
        calls.push(texts);
        if (texts.some((text) => text.includes('POISON'))) {
          return Promise.reject(new EmbedError('voyage answered 400: bad text', false));
        }
        return Promise.resolve(texts.map(vectorFor));
      },
    };
    const attemptsOf = async (): Promise<number> =>
      (await client.query<{ embed_attempts: number }>('SELECT embed_attempts FROM facts WHERE id = $1', [ids[2]!])).rows[0]!
        .embed_attempts;

    const first = await embedPending(client, picky, { sleep });
    assert.deepEqual([first.embedded, first.failed], [4, 1]);
    for (let run = 2; run <= GIVE_UP_AFTER; run += 1) {
      assert.equal(await attemptsOf(), run - 1, 'one attempt a run');
      await embedPending(client, picky, { sleep });
    }
    assert.equal(await attemptsOf(), GIVE_UP_AFTER);

    const sent = calls.length;
    const last = await embedPending(client, picky, { sleep });

    assert.equal(calls.length, sent, 'a parked row is not sent again');
    assert.deepEqual([last.embedded, last.failed, last.skipped], [0, 0, 1]);
    assert.equal((await counts()).factsEmbedded, 4, 'and the good rows kept their vectors');
  });

  test('a refusal that would repeat is tried once', async () => {
    await fact('f.md', 'A title', 'A description.');
    const provider = failing(new EmbedError('voyage answered 401: bad key', false));

    await embedPending(client, provider, { sleep });

    assert.equal(provider.calls, 1);
    assert.deepEqual(sleeps, []);
    const row = await client.query<{ embed_attempts: number }>('SELECT embed_attempts FROM facts');
    assert.equal(row.rows[0]?.embed_attempts, 1);
  });

  test('a reply with the wrong number of vectors writes nothing', async () => {
    await fact('f.md', 'A title', 'A description.');
    const short: Embedder = { embed: () => Promise.resolve([]) };

    const result = await embedPending(client, short, { sleep });

    assert.equal(result.failed, 1);
    assert.equal((await counts()).factsEmbedded, 0);
  });

  test('leaves a row alone once it has failed GIVE_UP_AFTER times', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    await client.query('UPDATE facts SET embed_attempts = $2 WHERE id = $1', [id, GIVE_UP_AFTER]);
    const embedder = fake();

    const result = await embedPending(client, embedder, { sleep });

    assert.equal(embedder.calls.length, 0);
    assert.deepEqual([result.embedded, result.skipped], [0, 1]);
  });

  // ---------------------------------------------------------------------------
  // KPA-114. A vector describes the text it was made from, so an edit must be
  // noticed, and a write must not land on a row that has moved since it was read.
  // ---------------------------------------------------------------------------

  /** The stored vector of one row, as numbers. */
  async function vectorOf(table: 'facts' | 'source_chunks', id: string): Promise<number[]> {
    const found = await client.query<{ v: string }>(`SELECT embedding::text AS v FROM ${table} WHERE id = $1`, [id]);
    return JSON.parse(found.rows[0]!.v) as number[];
  }

  async function rowOf(
    table: 'facts' | 'source_chunks',
    id: string,
  ): Promise<{ embedded_hash: string | null; embed_attempts: number }> {
    const found = await client.query<{ embedded_hash: string | null; embed_attempts: number }>(
      `SELECT embedded_hash, embed_attempts FROM ${table} WHERE id = $1`,
      [id],
    );
    return found.rows[0]!;
  }

  test('embeds a fact again when its text changed, and not when it did not', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    const embedder = fake();
    await embedPending(client, embedder, { sleep });
    assert.equal((await rowOf('facts', id)).embedded_hash, sha256('A title\n\nA description.'));

    await embedPending(client, embedder, { sleep });
    assert.equal(embedder.calls.length, 1, 'an unchanged fact is not sent again');

    await client.query("UPDATE facts SET description = 'A longer description than before.' WHERE id = $1", [id]);
    const again = await embedPending(client, embedder, { sleep });

    assert.equal(again.embedded, 1);
    assert.deepEqual(embedder.calls.at(-1), ['A title\n\nA longer description than before.']);
    assert.deepEqual(await vectorOf('facts', id), vectorFor('A title\n\nA longer description than before.'));
    assert.equal((await rowOf('facts', id)).embedded_hash, sha256('A title\n\nA longer description than before.'));

    await client.query("UPDATE facts SET title = 'A new title' WHERE id = $1", [id]);
    assert.equal((await embedPending(client, embedder, { sleep })).embedded, 1, 'a changed title counts too');
  });

  test('embeds a chunk again when the body changed under the same byte range', async () => {
    const id = await source('a.md', `# One\n\n${section('alpha')}\n`);
    await chunkSources(client);
    const embedder = fake();
    await embedPending(client, embedder, { sleep });
    const before = await client.query<{ id: string; byte_start: number; byte_end: number }>(
      'SELECT id, byte_start, byte_end FROM source_chunks',
    );

    // Five letters for five, so the chunker cuts the same range.
    await client.query('UPDATE sources SET body = replace(body, $2, $3) WHERE id = $1', [id, 'alpha', 'omega']);
    await chunkSources(client);
    assert.deepEqual(
      (await client.query('SELECT id, byte_start, byte_end FROM source_chunks')).rows,
      before.rows,
      'the range, and so the row, is unchanged',
    );
    const again = await embedPending(client, embedder, { sleep });

    assert.equal(again.embedded, 1);
    assert.match(embedder.calls.at(-1)?.[0] ?? '', /omega sentence 0/);
    const chunkId = before.rows[0]!.id;
    assert.deepEqual(await vectorOf('source_chunks', chunkId), vectorFor(embedder.calls.at(-1)![0]!));
    assert.equal((await rowOf('source_chunks', chunkId)).embedded_hash, sha256(embedder.calls.at(-1)![0]!));
  });

  test('refuses a hash with no vector, and a hash that is not a SHA-256', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    const hash = sha256('A title\n\nA description.');

    await assert.rejects(
      client.query('UPDATE facts SET embedded_hash = $2 WHERE id = $1', [id, hash]),
      /facts_hash_needs_vector/,
    );
    await embedPending(client, fake(), { sleep });
    await assert.rejects(
      client.query("UPDATE facts SET embedded_hash = 'not a hash' WHERE id = $1", [id]),
      /facts_hash_needs_vector/,
    );

    const sourceId = await source('a.md', `# One\n\n${section('alpha')}\n`);
    await chunkSources(client);
    await assert.rejects(
      client.query('UPDATE source_chunks SET embedded_hash = $2 WHERE source_id = $1', [sourceId, hash]),
      /source_chunks_hash_needs_vector/,
    );
  });

  test('embeds a row once more when it was embedded before the hash existed', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    const embedder = fake();
    await embedPending(client, embedder, { sleep });
    await client.query('UPDATE facts SET embedded_hash = NULL WHERE id = $1', [id]);

    assert.equal((await embedPending(client, embedder, { sleep })).embedded, 1);
    assert.equal((await rowOf('facts', id)).embedded_hash, sha256('A title\n\nA description.'));
  });

  test('a success resets the count, so a fact edited many times is not given up on', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    await client.query('UPDATE facts SET embed_attempts = $2 WHERE id = $1', [id, GIVE_UP_AFTER - 1]);
    const embedder = fake();

    await embedPending(client, embedder, { sleep });
    assert.equal((await rowOf('facts', id)).embed_attempts, 1, 'the successful call alone');

    await client.query("UPDATE facts SET description = 'Edited.' WHERE id = $1", [id]);
    assert.equal((await embedPending(client, embedder, { sleep })).embedded, 1, 'the edit is embedded');
  });

  test('leaves a stale row alone once it has failed GIVE_UP_AFTER times', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    const embedder = fake();
    await embedPending(client, embedder, { sleep });
    await client.query("UPDATE facts SET description = 'Edited.', embed_attempts = $2 WHERE id = $1", [id, GIVE_UP_AFTER]);

    const result = await embedPending(client, embedder, { sleep });

    assert.equal(embedder.calls.length, 1);
    assert.deepEqual([result.embedded, result.skipped], [0, 1]);
  });

  /** Holds a run inside its call to the embedder, after it has read the row and before it writes. */
  function held(): { embedder: Embedder; entered: Promise<void>; release: () => void } {
    const entered = deferred();
    const gate = deferred();
    return {
      entered: entered.promise,
      release: gate.resolve,
      embedder: {
        async embed(texts: string[]): Promise<number[][]> {
          entered.resolve();
          await gate.promise;
          return texts.map(vectorFor);
        },
      },
    };
  }

  test('a run overtaken by an edit writes nothing for the old text', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    const slow = held();
    const first = embedPending(client, slow.embedder, { sleep });
    await slow.entered;

    // While the first run waits on the provider, the fact changes and a second run embeds the change.
    await other.query("UPDATE facts SET description = 'A much longer description than the one first read.' WHERE id = $1", [id]);
    const second = await embedPending(other, fake(), { sleep });
    assert.equal(second.embedded, 1);
    slow.release();
    const overtaken = await first;

    assert.deepEqual([overtaken.embedded, overtaken.superseded], [0, 1]);
    const newest = 'A title\n\nA much longer description than the one first read.';
    assert.deepEqual(await vectorOf('facts', id), vectorFor(newest), 'the vector is the newest text');
    assert.equal((await rowOf('facts', id)).embedded_hash, sha256(newest));
  });

  test('a run overtaken by an edit to the body writes nothing for the old chunk text', async () => {
    const id = await source('a.md', `# One\n\n${section('alpha')}\n`);
    await chunkSources(client);
    const chunk = (await client.query<{ id: string }>('SELECT id FROM source_chunks')).rows[0]!.id;
    const slow = held();
    const first = embedPending(client, slow.embedder, { sleep });
    await slow.entered;

    await other.query('UPDATE sources SET body = replace(body, $2, $3) WHERE id = $1', [id, 'alpha', 'omega']);
    const second = await embedPending(other, fake(), { sleep });
    assert.equal(second.embedded, 1);
    slow.release();
    const overtaken = await first;

    assert.deepEqual([overtaken.embedded, overtaken.superseded], [0, 1]);
    // The one chunk is the whole body without its trailing newline.
    const newest = (await client.query<{ body: string }>('SELECT body FROM sources WHERE id = $1', [id])).rows[0]!.body.trimEnd();
    assert.ok(newest.includes('omega'));
    assert.equal((await rowOf('source_chunks', chunk)).embedded_hash, sha256(newest), 'the hash is the new text');
    assert.deepEqual(await vectorOf('source_chunks', chunk), vectorFor(newest), 'the vector is the new text');
  });

  test('two runs that read the same row write one vector between them', async () => {
    const id = await fact('f.md', 'A title', 'A description.');
    const slow = held();
    const first = embedPending(client, slow.embedder, { sleep });
    await slow.entered;

    const second = await embedPending(other, fake(), { sleep });
    slow.release();
    const late = await first;

    assert.equal(second.embedded, 1);
    assert.deepEqual([late.embedded, late.superseded], [0, 1], 'the run that lost counts nothing as embedded');
    assert.equal((await rowOf('facts', id)).embed_attempts, 1);
  });

  test('a rejected key costs one call, however many rows wait, and charges no row an attempt', async () => {
    for (let i = 0; i < 70; i += 1) await fact(`f${i}.md`, `title ${i}`, 'A description.');
    const provider = failing(rejectedKey());

    const result = await embedPending(client, provider, { sleep });

    assert.equal(provider.calls, 1, 'splitting the first batch of 64 would cost 127 calls');
    assert.deepEqual([result.embedded, result.failed, result.skipped], [0, 0, 0]);
    assert.match(result.halted ?? '', /^facts: .*401/);
    assert.deepEqual(result.errors, [result.halted]);
    assert.deepEqual(sleeps, []);
    const spent = await client.query("SELECT count(*) AS n FROM facts WHERE embed_attempts <> 0");
    assert.equal(spent.rows[0]?.['n'], '0', 'no row was charged');

    const later = await embedPending(client, fake(), { sleep });
    assert.equal(later.embedded, 70, 'once the key is fixed every row embeds');
    assert.equal(later.halted, null);
  });

  test('a rejected key on the chunks stops the facts too', async () => {
    await seed();
    await chunkSources(client);
    const provider = failing(rejectedKey());

    const result = await embedPending(client, provider, { sleep });

    assert.equal(provider.calls, 1, 'the facts would meet the same refusal');
    assert.match(result.halted ?? '', /^source_chunks: /);
    assert.deepEqual(await counts(), { chunks: 3, facts: 1, chunksEmbedded: 0, factsEmbedded: 0 });
  });

  test('a rejected key half way through keeps the batches already written', async () => {
    for (let i = 0; i < 70; i += 1) await fact(`f${i}.md`, `title ${i}`, 'A description.');
    let call = 0;
    const revoked: Embedder = {
      embed(texts) {
        call += 1;
        return call === 1 ? Promise.resolve(texts.map(vectorFor)) : Promise.reject(rejectedKey());
      },
    };

    const result = await embedPending(client, revoked, { sleep });

    assert.equal(result.embedded, 64);
    assert.match(result.halted ?? '', /401/);
    assert.equal((await counts()).factsEmbedded, 64);
  });

  test('a rejected key found after a split does not try the other half', async () => {
    for (let i = 0; i < 4; i += 1) await fact(`f${i}.md`, `title ${i}`, 'A description.');
    const answers = [new EmbedError('voyage answered 400: bad text', false), rejectedKey()];
    let calls = 0;
    const provider: Embedder = {
      embed() {
        calls += 1;
        return Promise.reject(answers[calls - 1] ?? new Error('called too often'));
      },
    };

    const result = await embedPending(client, provider, { sleep });

    assert.equal(calls, 2, 'the whole batch, then its first half');
    assert.match(result.halted ?? '', /401/);
    assert.equal(result.failed, 0);
  });
});

describe('voyage', () => {
  const key = 'test-key-not-real';
  const ok = (vectors: number[][]): typeof fetch =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: vectors.map((embedding, index) => ({ index, embedding })) })),
      )) as typeof fetch;

  test('sends the model and width from EMBEDDING and the key in a header only', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const spy = ((url: string, init: RequestInit) => {
      seen = { url, init };
      return ok([vectorFor('a')])(url, init);
    }) as typeof fetch;

    await voyage(key, spy).embed(['a'], 'query');

    assert.ok(seen);
    assert.ok(!seen.url.includes(key), 'the key is not in the URL');
    assert.deepEqual(JSON.parse(String(seen.init.body)), {
      input: ['a'],
      model: EMBEDDING.model,
      input_type: 'query',
      output_dimension: EMBEDDING.dimension,
    });
    assert.equal((seen.init.headers as Record<string, string>)['authorization'], `Bearer ${key}`);
  });

  test('puts vectors back in input order', async () => {
    const a = vectorFor('a');
    const bb = vectorFor('bb');
    const swapped = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [{ index: 1, embedding: bb }, { index: 0, embedding: a }] })),
      )) as typeof fetch;

    assert.deepEqual(await voyage(key, swapped).embed(['a', 'bb'], 'document'), [a, bb]);
  });

  test('retries 429 and 5xx, and does not retry a bad key; no message holds the key', async () => {
    const answer = (status: number): typeof fetch =>
      (() => Promise.resolve(new Response(JSON.stringify({ detail: 'nope' }), { status }))) as typeof fetch;

    for (const [status, retryable] of [[429, true], [503, true], [401, false], [400, false]] as const) {
      await assert.rejects(voyage(key, answer(status)).embed(['a'], 'document'), (error: unknown) => {
        assert.ok(error instanceof EmbedError);
        assert.equal(error.retryable, retryable, String(status));
        assert.ok(!error.message.includes(key));
        return true;
      });
    }
    const unreachable = (() => Promise.reject(new Error('socket hang up'))) as typeof fetch;
    await assert.rejects(voyage(key, unreachable).embed(['a'], 'document'), (error: unknown) =>
      error instanceof EmbedError && error.retryable,
    );
  });

  test('treats a rejected or forbidden key as fatal to the run, and nothing else', async () => {
    const answer = (status: number): typeof fetch =>
      (() => Promise.resolve(new Response(JSON.stringify({ detail: 'nope' }), { status }))) as typeof fetch;

    for (const [status, fatal] of [[401, true], [403, true], [400, false], [422, false], [429, false], [503, false]] as const) {
      await assert.rejects(voyage(key, answer(status)).embed(['a'], 'document'), (error: unknown) => {
        assert.ok(error instanceof EmbedError);
        assert.equal(error.fatal, fatal, String(status));
        return true;
      });
    }
  });

  test('a timeout while the body is read is the same retryable timeout as one before it', async () => {
    const stalls = (() =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
            },
          }),
        ),
      )) as typeof fetch;

    await assert.rejects(voyage(key, stalls, 20).embed(['a'], 'document'), (error: unknown) => {
      assert.ok(error instanceof EmbedError, 'not a raw TimeoutError');
      assert.equal(error.retryable, true);
      assert.match(error.message, /timed out after 20 ms/);
      return true;
    });
  });

  test('an answer that cannot be read is a retryable EmbedError', async () => {
    const html = (() => Promise.resolve(new Response('<html>bad gateway</html>'))) as typeof fetch;

    await assert.rejects(voyage(key, html).embed(['a'], 'document'), (error: unknown) => {
      assert.ok(error instanceof EmbedError);
      assert.equal(error.retryable, true);
      assert.ok(!error.message.includes(key));
      return true;
    });
  });

  test('reads Retry-After as seconds or as an HTTP date', async () => {
    assert.equal(parseRetryAfter('7'), 7000);
    assert.equal(parseRetryAfter(' 0 '), 0);
    const now = Date.parse('2026-10-20T00:00:00Z');
    assert.equal(parseRetryAfter('Tue, 20 Oct 2026 00:00:20 GMT', now), 20_000);
    assert.equal(parseRetryAfter('Mon, 19 Oct 2026 00:00:00 GMT', now), 0, 'a date in the past is no wait');
    assert.equal(parseRetryAfter('soon', now), undefined);
    assert.equal(parseRetryAfter(null, now), undefined);
  });

  test('carries Retry-After from a 429 or 503 onto the error, and from nothing else', async () => {
    const answer = (status: number, headers: Record<string, string>): typeof fetch =>
      (() => Promise.resolve(new Response('{"detail":"x"}', { status, headers }))) as typeof fetch;

    for (const status of [429, 503]) {
      await assert.rejects(voyage(key, answer(status, { 'retry-after': '7' })).embed(['a'], 'document'), (error: unknown) => {
        assert.ok(error instanceof EmbedError);
        assert.equal(error.retryAfterMs, 7000, String(status));
        return true;
      });
    }
    const date = new Date(Date.now() + 20_000).toUTCString();
    await assert.rejects(voyage(key, answer(429, { 'retry-after': date })).embed(['a'], 'document'), (error: unknown) => {
      assert.ok(error instanceof EmbedError);
      assert.ok(error.retryAfterMs !== undefined && error.retryAfterMs > 17_000 && error.retryAfterMs <= 20_000);
      return true;
    });
    await assert.rejects(voyage(key, answer(401, { 'retry-after': '7' })).embed(['a'], 'document'), (error: unknown) =>
      error instanceof EmbedError && error.retryAfterMs === undefined,
    );
  });

  test('gives each request a timeout, and a timeout is retryable', async () => {
    let signal: AbortSignal | null | undefined;
    const hangs = ((_url: string, init: RequestInit) => {
      signal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        // Without a signal the fake gives up on its own, so a missing timeout fails the test rather than hanging it.
        const bail = setTimeout(() => reject(new Error('no signal given')), 500);
        signal?.addEventListener('abort', () => {
          clearTimeout(bail);
          reject(signal?.reason);
        });
      });
    }) as typeof fetch;

    await assert.rejects(voyage(key, hangs, 20).embed(['a'], 'document'), (error: unknown) => {
      assert.ok(error instanceof EmbedError);
      assert.equal(error.retryable, true);
      assert.match(error.message, /timed out after 20 ms/);
      return true;
    });
    assert.ok(signal);
  });

  test('refuses a vector of the wrong width', async () => {
    await assert.rejects(voyage(key, ok([[1, 2, 3]])).embed(['a'], 'document'), /width/);
  });
});
