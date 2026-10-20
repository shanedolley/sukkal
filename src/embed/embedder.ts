/**
 * Chunks the sources and embeds whatever has no embedding yet.
 *
 * `Embedder` is the one seam in front of the provider, so changing provider
 * touches `src/embed/voyage.ts` and nothing here. The tests pass a fake, and a
 * test suite never reaches the network.
 *
 * A NULL EMBEDDING MEANS UNEMBEDDED, and `embed_attempts` counts the calls
 * made for the row, the successful one included. Both change in one UPDATE
 * inside one transaction per batch, so a row is either embedded or untouched
 * and never half written. A batch that fails every try adds its tries to
 * `embed_attempts` and leaves `embedding` null. Once a row reaches
 * `GIVE_UP_AFTER` it is left alone rather than retried for ever, and the
 * result counts it as `skipped`.
 *
 * A second run is a no-op. `chunkSources` keeps a row whose byte range is
 * unchanged, embedding included, and replaces any other. The embedder selects
 * only rows with a null embedding.
 *
 * A fact is embedded as its title and description. The body of a note is not
 * stored (see `src/migrate/load.ts`), and a fact edited after it was embedded
 * is not re-embedded here. KPA-114 owns the job that does that.
 */
import type { ClientBase } from 'pg';
import { chunkText } from '../memory/source.ts';
import { chunkBody } from './chunk.ts';

/** `document` for a passage stored for later, `query` for a question put to them. */
export type InputKind = 'document' | 'query';

export interface Embedder {
  /** One vector per text, in order, each `EMBEDDING.dimension` wide. */
  embed(texts: string[], kind: InputKind): Promise<number[][]>;
}

/** What an `Embedder` throws. `retryable` is false for a refusal that would repeat. */
export class EmbedError extends Error {
  readonly retryable: boolean;
  /** How long the provider asked us to wait, from `Retry-After`. */
  readonly retryAfterMs: number | undefined;
  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.name = 'EmbedError';
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Calls made for one batch in one run before it is left for the next run. */
export const TRIES_PER_RUN = 3;

/** The first wait, doubled before each further try. */
export const BACKOFF_MS = 1000;

/** The longest single wait, whatever `Retry-After` asks. A longer ask is left for the next run. */
export const MAX_WAIT_MS = 30_000;

/** `embed_attempts` at which a row is left alone. */
export const GIVE_UP_AFTER = 10;

/** Texts per call. 64 chunks stay far under the provider's token limit per request. */
export const BATCH = 64;

export interface Options {
  /** Replaced in tests so a retry waits for nothing. */
  sleep?: (ms: number) => Promise<void>;
}

/** A source whose chunks were not written. Its transaction rolled back and the run went on. */
export interface ChunkFailure {
  sourceId: string;
  reason: string;
}

export interface Chunked {
  sources: number;
  /** Chunks of the sources that succeeded. */
  chunks: number;
  failures: ChunkFailure[];
}

export interface Embedded {
  embedded: number;
  failed: number;
  skipped: number;
  /** One line per row or batch that failed. */
  errors: string[];
}

/**
 * Writes the chunks of every source, one transaction per source.
 *
 * Re-running it adds no row. A chunk id always means one byte range: a chunk
 * whose range is unchanged keeps its row and its embedding, and any other row
 * at that ordinal is deleted and a new one inserted, so a citation never
 * follows an id to other text. A row still cited stops its delete with a
 * foreign key error. That source rolls back whole and is returned in
 * `failures`, and the run goes on to the next source.
 */
export async function chunkSources(client: ClientBase): Promise<Chunked> {
  const sources = await client.query<{ id: string; body: string }>(
    'SELECT id, body FROM sources ORDER BY id',
  );

  let chunks = 0;
  const failures: ChunkFailure[] = [];
  for (const source of sources.rows) {
    const ranges = chunkBody(source.body);
    const wanted = [
      ranges.map((_, ordinal) => ordinal),
      ranges.map((range) => range.byteStart),
      ranges.map((range) => range.byteEnd),
    ];
    await client.query('BEGIN');
    try {
      await client.query(
        `DELETE FROM source_chunks c
          WHERE c.source_id = $1
            AND NOT EXISTS (
              SELECT 1 FROM unnest($2::int[], $3::int[], $4::int[]) AS n(ordinal, byte_start, byte_end)
               WHERE n.ordinal = c.ordinal AND n.byte_start = c.byte_start AND n.byte_end = c.byte_end)`,
        [source.id, ...wanted],
      );
      await client.query(
        `INSERT INTO source_chunks (source_id, ordinal, byte_start, byte_end)
         SELECT $1, ordinal, byte_start, byte_end FROM unnest($2::int[], $3::int[], $4::int[])
           AS n(ordinal, byte_start, byte_end)
         ON CONFLICT (source_id, ordinal) DO NOTHING`,
        [source.id, ...wanted],
      );
      await client.query('COMMIT');
      chunks += ranges.length;
    } catch (error) {
      await client.query('ROLLBACK');
      failures.push({ sourceId: source.id, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sources: sources.rows.length, chunks, failures };
}

interface Pending {
  id: string;
  text: string;
}

async function pendingChunks(client: ClientBase): Promise<Pending[]> {
  const found = await client.query<{ id: string; body: string; byte_start: number; byte_end: number }>(
    `SELECT c.id, s.body, c.byte_start, c.byte_end
       FROM source_chunks c JOIN sources s ON s.id = c.source_id
      WHERE c.embedding IS NULL AND c.embed_attempts < $1
      ORDER BY c.id`,
    [GIVE_UP_AFTER],
  );
  return found.rows.map((row) => ({
    id: row.id,
    text: chunkText(row.body, { byteStart: row.byte_start, byteEnd: row.byte_end }),
  }));
}

async function pendingFacts(client: ClientBase): Promise<Pending[]> {
  const found = await client.query<{ id: string; title: string; description: string }>(
    `SELECT id, title, description FROM facts
      WHERE embedding IS NULL AND embed_attempts < $1 ORDER BY id`,
    [GIVE_UP_AFTER],
  );
  return found.rows.map((row) => ({ id: row.id, text: `${row.title}\n\n${row.description}` }));
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Call {
  tries: number;
  vectors?: number[][];
  error?: string;
  /** False when the last error would repeat, so a smaller batch may succeed. */
  retryable?: boolean;
}

/**
 * One batch, retried with doubling waits. `tries` counts the calls made.
 * A wait is the longer of the backoff and the provider's `Retry-After`, never
 * more than `MAX_WAIT_MS`.
 */
async function callWithBackoff(
  embedder: Embedder,
  texts: string[],
  sleep: (ms: number) => Promise<void>,
): Promise<Call> {
  for (let tries = 1; ; tries += 1) {
    try {
      const vectors = await embedder.embed(texts, 'document');
      if (vectors.length !== texts.length) {
        throw new EmbedError(`asked for ${texts.length} vectors and got ${vectors.length}`, false);
      }
      return { tries, vectors };
    } catch (error) {
      const retryable = !(error instanceof EmbedError) || error.retryable;
      if (!retryable || tries >= TRIES_PER_RUN) {
        return { tries, error: error instanceof Error ? error.message : String(error), retryable };
      }
      const asked = error instanceof EmbedError ? (error.retryAfterMs ?? 0) : 0;
      await sleep(Math.min(MAX_WAIT_MS, Math.max(BACKOFF_MS * 2 ** (tries - 1), asked)));
    }
  }
}

interface Done {
  row: Pending;
  vector: number[];
  tries: number;
}

interface Failed {
  rows: Pending[];
  error: string;
  tries: number;
}

/**
 * Embeds a batch. A refusal that would repeat splits the batch in halves and
 * tries each half, so the good rows embed and only the bad text keeps its
 * failure. Halving costs about log2(n) extra calls for one bad text, where
 * one-by-one costs n.
 */
async function embedBatch(
  embedder: Embedder,
  batch: Pending[],
  sleep: (ms: number) => Promise<void>,
): Promise<{ done: Done[]; failed: Failed[] }> {
  const result = await callWithBackoff(embedder, batch.map((row) => row.text), sleep);
  if (result.vectors) {
    const vectors = result.vectors;
    return { done: batch.map((row, i) => ({ row, vector: vectors[i]!, tries: result.tries })), failed: [] };
  }
  if (result.retryable === false && batch.length > 1) {
    const middle = Math.ceil(batch.length / 2);
    const first = await embedBatch(embedder, batch.slice(0, middle), sleep);
    const second = await embedBatch(embedder, batch.slice(middle), sleep);
    return { done: [...first.done, ...second.done], failed: [...first.failed, ...second.failed] };
  }
  return { done: [], failed: [{ rows: batch, error: result.error ?? 'unknown error', tries: result.tries }] };
}

/** `table` is one of two literals below, never input. */
async function embedRows(
  client: ClientBase,
  embedder: Embedder,
  table: 'source_chunks' | 'facts',
  rows: Pending[],
  sleep: (ms: number) => Promise<void>,
  into: Embedded,
): Promise<void> {
  for (let from = 0; from < rows.length; from += BATCH) {
    const outcome = await embedBatch(embedder, rows.slice(from, from + BATCH), sleep);

    await client.query('BEGIN');
    try {
      for (const { row, vector, tries } of outcome.done) {
        await client.query(
          `UPDATE ${table} SET embedding = $2::vector, embed_attempts = embed_attempts + $3
            WHERE id = $1`,
          [row.id, JSON.stringify(vector), tries],
        );
      }
      into.embedded += outcome.done.length;
      for (const { rows: bad, error, tries } of outcome.failed) {
        await client.query(
          `UPDATE ${table} SET embed_attempts = embed_attempts + $2 WHERE id = ANY($1::bigint[])`,
          [bad.map((row) => row.id), tries],
        );
        into.failed += bad.length;
        into.errors.push(`${table} ${bad.map((row) => row.id).join(',')}: ${error}`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

/** Embeds every chunk and fact that has no embedding yet. */
export async function embedPending(
  client: ClientBase,
  embedder: Embedder,
  options: Options = {},
): Promise<Embedded> {
  const sleep = options.sleep ?? wait;
  const result: Embedded = { embedded: 0, failed: 0, skipped: 0, errors: [] };

  await embedRows(client, embedder, 'source_chunks', await pendingChunks(client), sleep, result);
  await embedRows(client, embedder, 'facts', await pendingFacts(client), sleep, result);

  const left = await client.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM source_chunks WHERE embedding IS NULL AND embed_attempts >= $1)
          + (SELECT count(*) FROM facts WHERE embedding IS NULL AND embed_attempts >= $1) AS n`,
    [GIVE_UP_AFTER],
  );
  result.skipped = Number(left.rows[0]?.n ?? 0);
  return result;
}
