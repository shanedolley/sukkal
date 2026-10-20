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
 * A second run is a no-op. `chunkSources` upserts on `(source_id, ordinal)`,
 * and keeps an embedding unless the byte range under it changed. The embedder
 * selects only rows with a null embedding.
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
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'EmbedError';
    this.retryable = retryable;
  }
}

/** Calls made for one batch in one run before it is left for the next run. */
export const TRIES_PER_RUN = 3;

/** The first wait, doubled before each further try. */
export const BACKOFF_MS = 500;

/** `embed_attempts` at which a row is left alone. */
export const GIVE_UP_AFTER = 10;

/** Texts per call. 64 chunks stay far under the provider's token limit per request. */
export const BATCH = 64;

export interface Options {
  /** Replaced in tests so a retry waits for nothing. */
  sleep?: (ms: number) => Promise<void>;
}

export interface Chunked {
  sources: number;
  chunks: number;
}

export interface Embedded {
  embedded: number;
  failed: number;
  skipped: number;
  /** One line per batch that failed every try. */
  errors: string[];
}

/**
 * Writes the chunks of every source, in place.
 *
 * Re-running it adds no row. A chunk whose range is unchanged keeps its
 * embedding. One whose range moved is reset to unembedded, because the vector
 * describes other text. A chunk past the new end is deleted, and a citation
 * still pointing at it stops the delete with a foreign key error: that is the
 * right outcome, since the passage a person cited would otherwise vanish
 * silently. Sources are verbatim, so this only happens to a source rewritten.
 */
export async function chunkSources(client: ClientBase): Promise<Chunked> {
  const sources = await client.query<{ id: string; body: string }>(
    'SELECT id, body FROM sources ORDER BY id',
  );

  let chunks = 0;
  for (const source of sources.rows) {
    const ranges = chunkBody(source.body);
    await client.query('BEGIN');
    try {
      for (const [ordinal, range] of ranges.entries()) {
        await client.query(
          `INSERT INTO source_chunks (source_id, ordinal, byte_start, byte_end)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_id, ordinal) DO UPDATE
              SET embedding = CASE WHEN source_chunks.byte_start = EXCLUDED.byte_start
                                    AND source_chunks.byte_end = EXCLUDED.byte_end
                                   THEN source_chunks.embedding END,
                  embed_attempts = CASE WHEN source_chunks.byte_start = EXCLUDED.byte_start
                                         AND source_chunks.byte_end = EXCLUDED.byte_end
                                        THEN source_chunks.embed_attempts ELSE 0 END,
                  byte_start = EXCLUDED.byte_start,
                  byte_end = EXCLUDED.byte_end`,
          [source.id, ordinal, range.byteStart, range.byteEnd],
        );
      }
      await client.query('DELETE FROM source_chunks WHERE source_id = $1 AND ordinal >= $2', [
        source.id,
        ranges.length,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    chunks += ranges.length;
  }
  return { sources: sources.rows.length, chunks };
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

/** One batch, retried with doubling waits. `tries` counts the calls made. */
async function callWithBackoff(
  embedder: Embedder,
  texts: string[],
  sleep: (ms: number) => Promise<void>,
): Promise<{ tries: number; vectors?: number[][]; error?: string }> {
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
        return { tries, error: error instanceof Error ? error.message : String(error) };
      }
      await sleep(BACKOFF_MS * 2 ** (tries - 1));
    }
  }
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
    const batch = rows.slice(from, from + BATCH);
    const result = await callWithBackoff(embedder, batch.map((row) => row.text), sleep);

    await client.query('BEGIN');
    try {
      if (result.vectors) {
        for (const [i, row] of batch.entries()) {
          await client.query(
            `UPDATE ${table} SET embedding = $2::vector, embed_attempts = embed_attempts + $3
              WHERE id = $1`,
            [row.id, JSON.stringify(result.vectors[i]), result.tries],
          );
        }
        into.embedded += batch.length;
      } else {
        await client.query(
          `UPDATE ${table} SET embed_attempts = embed_attempts + $2 WHERE id = ANY($1::bigint[])`,
          [batch.map((row) => row.id), result.tries],
        );
        into.failed += batch.length;
        into.errors.push(`${table}: ${result.error ?? 'unknown error'}`);
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
