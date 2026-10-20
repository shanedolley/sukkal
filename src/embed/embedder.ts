/**
 * Chunks the sources and embeds whatever needs an embedding.
 *
 * `Embedder` is the one seam in front of the provider, so changing provider
 * touches `src/embed/voyage.ts` and nothing here. The tests pass a fake, and a
 * test suite never reaches the network.
 *
 * A ROW NEEDS EMBEDDING when its `embedding` is null, or when the text it holds
 * now no longer hashes to `embedded_hash`, the SHA-256 of the text its vector
 * was made from (migration 034). The second case is an edit: a fact whose title
 * or description changed, or a source body changed in place under a chunk whose
 * byte range stayed the same. A row embedded before that migration has no hash
 * and is embedded once more.
 *
 * THE UPDATE WRITES ONLY IF THE ROW IS STILL THE ONE THAT WAS READ. Embedding
 * takes seconds and holds no lock, so a second run, a queued job beside
 * `npm run embed`, or an edit can move the row in between. The update names the
 * id and the hash of the text that was embedded, and it matches only while the
 * row still hashes to that text and still needs the vector. A write that
 * matches nothing is counted as `superseded`, and the row is left for the run
 * that holds its current text.
 *
 * `embed_attempts` counts the calls made for the row since its last success,
 * the successful one included. The vector, its hash and the count change in one
 * UPDATE inside one transaction per batch, so a row is either embedded or
 * untouched and never half written. Once a row reaches `GIVE_UP_AFTER` it is
 * left alone rather than retried for ever, and the result counts it as
 * `skipped`. A success resets the count, so a fact edited ten times is not given
 * up on the tenth edit.
 *
 * THE COUNT PARKS A POISON ROW, AND ONLY A POISON ROW. A poison row is one whose
 * own text the provider refuses: a non-retryable failure that the split of a
 * batch has narrowed to that one row. That failure adds its call to
 * `embed_attempts`. A provider fault is not the row's fault, so it charges
 * nothing, and it stops the run. Four kinds: a rejected key (401, 403), a
 * retryable failure that uses up its tries (429, 5xx, a timeout, a network
 * error, an unreadable answer), a reply of the wrong count or width, and a
 * refusal that the split of a batch finds every row meeting (a 400, 402, 404 or
 * 422 for each text, such as a renamed model). The provider fails every later
 * batch as well, so the run halts, keeps what it has written, skips the facts
 * after a halt in the chunks, and reports why in `halted`. The next tick tries
 * again.
 * A count that charged these would give up on every row within a few ticks of
 * the queue, during any outage of the provider, and leave them skipped after it
 * ended; a run that went on would spend `TRIES_PER_RUN` calls on every batch of
 * a backlog to learn the same thing.
 *
 * A second run is a no-op. `chunkSources` keeps a row whose byte range is
 * unchanged, embedding included, and replaces any other. `embedPending` then
 * selects only the rows that need a vector.
 *
 * A fact is embedded as its title and description. The body of a note is not
 * stored (see `src/migrate/load.ts`).
 */
import { createHash } from 'node:crypto';
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
  /**
   * True for a refusal every row would meet, such as a rejected key. The run
   * stops on it rather than splitting the batch to find a bad row.
   */
  readonly fatal: boolean;
  constructor(message: string, retryable: boolean, retryAfterMs?: number, fatal = false) {
    super(message);
    this.name = 'EmbedError';
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.fatal = fatal;
  }
}

/** Calls made for one batch in one run before it is left for the next run. */
export const TRIES_PER_RUN = 3;

/** The first wait, doubled before each further try. */
export const BACKOFF_MS = 1000;

/**
 * The longest single wait, whatever `Retry-After` asks. A longer ask is cut to
 * this and the call is tried again, so it still uses one of the `TRIES_PER_RUN`.
 */
export const MAX_WAIT_MS = 30_000;

/** `embed_attempts` at which a row is left alone. Only a row the provider refuses on its own text reaches it. */
export const GIVE_UP_AFTER = 10;

/** Texts per call. 64 chunks stay far under the provider's token limit per request. */
export const BATCH = 64;

export interface Options {
  /** Replaced in tests so a retry waits for nothing. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * The time the run may spend before it picks another batch. A batch already
   * begun runs to its end, so the run can pass this by one batch. Unset means no
   * limit.
   */
  budgetMs?: number;
  /** The clock `budgetMs` is read against. Replaced in tests. */
  now?: () => number;
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
  /** Vectors not written because the row had changed, or another run had embedded it, since it was read. */
  superseded: number;
  /** Why the run stopped early, or null. A rejected key or a provider that stays down stops it, and no row is charged an attempt. */
  halted: string | null;
  /** True when the run stopped because `budgetMs` was spent. The next run continues. */
  timedOut: boolean;
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
 *
 * Keeping the embedding of an unchanged range is safe because `embedPending`
 * compares the text against `embedded_hash`: a body edited in place under the
 * same range is embedded again.
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

/** The SHA-256, in hex, of the text a row is embedded from. */
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The same hash computed by the database, over the text a row holds now.
 * `convert_to` gives the UTF-8 bytes Node hashes, so the two agree for any
 * valid text. Needs `c` (source_chunks) and `s` (sources) in scope.
 *
 * ponytail: every run hashes every embedded chunk, which costs 0.4 s for one
 * 1.5 MB source of 1000 chunks (measured 20 October 2026, 177 ms with the
 * `convert_to` hoisted into a LATERAL). Keep a body hash on `sources` if the
 * corpus outgrows a five-minute tick.
 */
const CHUNK_HASH = `encode(sha256(substring(convert_to(s.body, 'UTF8') FROM c.byte_start + 1
                                              FOR c.byte_end - c.byte_start)), 'hex')`;

/** A fact is its title, a blank line, then its description: what `pendingFacts` sends. */
const FACT_HASH = `encode(sha256(convert_to(title || chr(10) || chr(10) || description, 'UTF8')), 'hex')`;

interface Pending {
  id: string;
  text: string;
  /** The hash of `text`. The update writes only while the row still hashes to this. */
  hash: string;
  attempts: number;
}

/** Every chunk that needs a vector, those past `GIVE_UP_AFTER` included. */
async function pendingChunks(client: ClientBase): Promise<Pending[]> {
  const found = await client.query<{
    id: string;
    body: string;
    byte_start: number;
    byte_end: number;
    embed_attempts: number;
  }>(
    `SELECT c.id, s.body, c.byte_start, c.byte_end, c.embed_attempts
       FROM source_chunks c JOIN sources s ON s.id = c.source_id
      WHERE c.embedding IS NULL OR c.embedded_hash IS DISTINCT FROM ${CHUNK_HASH}
      ORDER BY c.id`,
  );
  return found.rows.map((row) => {
    const text = chunkText(row.body, { byteStart: row.byte_start, byteEnd: row.byte_end });
    return {
      id: row.id,
      text,
      hash: sha256(text),
      attempts: row.embed_attempts,
    };
  });
}

/** Every fact that needs a vector, those past `GIVE_UP_AFTER` included. */
async function pendingFacts(client: ClientBase): Promise<Pending[]> {
  const found = await client.query<{ id: string; title: string; description: string; embed_attempts: number }>(
    `SELECT id, title, description, embed_attempts FROM facts
      WHERE embedding IS NULL OR embedded_hash IS DISTINCT FROM ${FACT_HASH}
      ORDER BY id`,
  );
  return found.rows.map((row) => {
    const text = `${row.title}\n\n${row.description}`;
    return { id: row.id, text, hash: sha256(text), attempts: row.embed_attempts };
  });
}

/**
 * The vector goes in only while the row still holds the text that was embedded
 * and still needs the vector. `$3` is the hash of that text, so an edit to a
 * fact, or to a body under an unchanged range, fails the first test, and a run
 * that got there first fails the second. A chunk replaced because its range
 * moved has another id and matches nothing. Zero rows updated means the row
 * moved on, and the caller counts it as superseded.
 */
const WRITE = {
  source_chunks: `UPDATE source_chunks c
                     SET embedding = $2::vector, embedded_hash = $3, embed_attempts = $4
                    FROM sources s
                   WHERE c.id = $1 AND s.id = c.source_id
                     AND ${CHUNK_HASH} = $3
                     AND (c.embedding IS NULL OR c.embedded_hash IS DISTINCT FROM $3)`,
  facts: `UPDATE facts
             SET embedding = $2::vector, embedded_hash = $3, embed_attempts = $4
           WHERE id = $1
             AND ${FACT_HASH} = $3
             AND (embedding IS NULL OR embedded_hash IS DISTINCT FROM $3)`,
} as const;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Call {
  tries: number;
  vectors?: number[][];
  error?: string;
  /** False when the last error would repeat, so a smaller batch may succeed. */
  retryable?: boolean;
  /** True when every row would meet the same refusal, so no smaller batch can succeed. */
  fatal?: boolean;
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
        throw new EmbedError(`asked for ${texts.length} vectors and got ${vectors.length}`, false, undefined, true);
      }
      return { tries, vectors };
    } catch (error) {
      const retryable = !(error instanceof EmbedError) || error.retryable;
      if (!retryable || tries >= TRIES_PER_RUN) {
        return {
          tries,
          error: error instanceof Error ? error.message : String(error),
          retryable,
          fatal: error instanceof EmbedError && error.fatal,
        };
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

interface Outcome {
  done: Done[];
  failed: Failed[];
  /** Why the run must stop, or null. */
  halt: string | null;
}

/**
 * Embeds a batch. A refusal that would repeat splits the batch in halves and
 * tries each half, so the good rows embed and only the bad text keeps its
 * failure. Halving costs about log2(n) extra calls for one bad text, where
 * one-by-one costs n.
 *
 * A refusal every row shares, a 401 or a 403, does not split. Splitting would
 * cost 127 calls for a batch of 64 and learn nothing, so it halts the run.
 *
 * A retryable failure that uses up its tries does not split either. The
 * provider failed, not the text, and every later batch would fail the same way,
 * so it halts the run too.
 *
 * A split that ends with every row of the batch failing and none embedded is a
 * provider fault as well: a refusal the provider gives every text, such as a
 * renamed model. It halts the run and charges no row. Only the whole batch is
 * judged this way (`whole`), since two bad texts side by side fail together
 * inside a split without the provider being at fault.
 */
async function embedBatch(
  embedder: Embedder,
  batch: Pending[],
  sleep: (ms: number) => Promise<void>,
  whole = true,
): Promise<Outcome> {
  const result = await callWithBackoff(embedder, batch.map((row) => row.text), sleep);
  if (result.vectors) {
    const vectors = result.vectors;
    return { done: batch.map((row, i) => ({ row, vector: vectors[i]!, tries: result.tries })), failed: [], halt: null };
  }
  // A provider fault: a refusal every row shares, or a retryable failure that
  // used up its tries. Nothing is charged and nothing more is tried this run.
  if (result.fatal || result.retryable !== false) {
    return { done: [], failed: [], halt: result.error ?? 'unknown error' };
  }
  if (result.retryable === false && batch.length > 1) {
    const middle = Math.ceil(batch.length / 2);
    const first = await embedBatch(embedder, batch.slice(0, middle), sleep, false);
    if (first.halt !== null) return first;
    const second = await embedBatch(embedder, batch.slice(middle), sleep, false);
    const merged = {
      done: [...first.done, ...second.done],
      failed: [...first.failed, ...second.failed],
      halt: second.halt,
    };
    if (whole && merged.halt === null && merged.done.length === 0) {
      return { done: [], failed: [], halt: `every text of a batch of ${batch.length} was refused: ${merged.failed[0]?.error ?? result.error}` };
    }
    return merged;
  }
  // One row the provider refused on its own text, with nothing left to split.
  return { done: [], failed: [{ rows: batch, error: result.error ?? 'unknown error', tries: result.tries }], halt: null };
}

/** `table` is one of two literals below, never input. */
async function embedRows(
  client: ClientBase,
  embedder: Embedder,
  table: 'source_chunks' | 'facts',
  rows: Pending[],
  sleep: (ms: number) => Promise<void>,
  into: Embedded,
  clock: { now: () => number; start: number; budgetMs: number },
): Promise<void> {
  const { now, start, budgetMs } = clock;
  for (let from = 0; from < rows.length; from += BATCH) {
    if (now() - start >= budgetMs) {
      into.timedOut = true;
      return;
    }
    const outcome = await embedBatch(embedder, rows.slice(from, from + BATCH), sleep);

    await client.query('BEGIN');
    try {
      for (const { row, vector, tries } of outcome.done) {
        const written = await client.query(WRITE[table], [row.id, JSON.stringify(vector), row.hash, tries]);
        if (written.rowCount === 1) into.embedded += 1;
        else into.superseded += 1;
      }
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

    if (outcome.halt !== null) {
      into.halted = `${table}: ${outcome.halt}`;
      into.errors.push(into.halted);
      return;
    }
  }
}

/** The rows still worth a call. Those at `GIVE_UP_AFTER` are counted into `skipped` and left alone. */
function due(rows: Pending[], into: Embedded): Pending[] {
  const left = rows.filter((row) => row.attempts < GIVE_UP_AFTER);
  into.skipped += rows.length - left.length;
  return left;
}

/** Embeds every chunk and fact that has no embedding, or whose text has changed since it was embedded. */
export async function embedPending(
  client: ClientBase,
  embedder: Embedder,
  options: Options = {},
): Promise<Embedded> {
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;
  const clock = { now, start: now(), budgetMs: options.budgetMs ?? Infinity };
  const result: Embedded = { embedded: 0, failed: 0, skipped: 0, superseded: 0, halted: null, timedOut: false, errors: [] };

  await embedRows(client, embedder, 'source_chunks', due(await pendingChunks(client), result), sleep, result, clock);
  // A halted or timed out run stops here: the facts would meet the same refusal or outage, or the same clock.
  if (result.halted === null && !result.timedOut) {
    await embedRows(client, embedder, 'facts', due(await pendingFacts(client), result), sleep, result, clock);
  }
  return result;
}
