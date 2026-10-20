import assert from 'node:assert/strict';
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

describe('embedding', { skip: url ? false : 'DATABASE_URL_TEST is unset' }, () => {
  let client: ClientBase & { end: () => Promise<void> };
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
  });

  after(async () => {
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

  test('a failing provider leaves rows null and counts every try', async () => {
    await seed();
    await chunkSources(client);
    const provider = failing(new EmbedError('voyage answered 503: busy', true));

    const result = await embedPending(client, provider, { sleep });

    assert.equal(result.embedded, 0);
    assert.equal(result.failed, 4);
    assert.equal(provider.calls, TRIES_PER_RUN * 2, 'one batch of chunks and one of facts');
    assert.deepEqual(sleeps, [BACKOFF_MS, BACKOFF_MS * 2, BACKOFF_MS, BACKOFF_MS * 2], 'waits double');
    assert.match(result.errors[0] ?? '', /503/);
    const rows = await client.query<{ embedding: string | null; embed_attempts: number }>(
      `SELECT embedding, embed_attempts FROM source_chunks
       UNION ALL SELECT embedding, embed_attempts FROM facts`,
    );
    assert.equal(rows.rowCount, 4);
    for (const row of rows.rows) {
      assert.equal(row.embedding, null);
      assert.equal(row.embed_attempts, TRIES_PER_RUN);
    }

    const later = await embedPending(client, fake(), { sleep });
    assert.equal(later.embedded, 4, 'a later run embeds what failed');
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
