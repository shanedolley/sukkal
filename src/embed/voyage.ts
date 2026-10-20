/**
 * The Voyage AI implementation of `Embedder`, and the one place that knows its
 * wire format. Changing provider means a new file beside this one.
 *
 * The model and the width come from `EMBEDDING` in `src/embedding.ts` and
 * appear nowhere else. A vector of any other width is refused here, since the
 * column would reject it later with a worse message.
 *
 * The key lives in the `voyage` connection, sealed by `src/connections/crypto.ts`.
 * It reaches memory through `secretFor` at the moment of the call, goes out in a
 * header, and appears in no message, log line or error this file throws.
 */
import type { ClientBase } from 'pg';
import { secretFor } from '../connections/store.ts';
import { EMBEDDING } from '../embedding.ts';
import { EmbedError, type Embedder, type InputKind } from './embedder.ts';

const URL = 'https://api.voyageai.com/v1/embeddings';

/** A request that has not finished by now is abandoned and counted as retryable. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** `Retry-After` as milliseconds. It is whole seconds or an HTTP date, and anything else is no ask. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** The reason Voyage gave, which it writes as `{ "detail": "..." }`. */
async function reason(answer: Response): Promise<string> {
  try {
    const body: unknown = await answer.json();
    const detail = (body as { detail?: unknown } | null)?.detail;
    return typeof detail === 'string' ? detail.slice(0, 200) : 'no reason given';
  } catch {
    return 'no reason given';
  }
}

/** `fetchImpl` and `timeoutMs` are replaced in a test of this file only. */
export function voyage(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Embedder {
  return {
    async embed(texts: string[], kind: InputKind): Promise<number[][]> {
      let answer: Response;
      try {
        answer = await fetchImpl(URL, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            input: texts,
            model: EMBEDDING.model,
            input_type: kind,
            output_dimension: EMBEDDING.dimension,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') {
          throw new EmbedError(`voyage timed out after ${timeoutMs} ms`, true);
        }
        // fetch's own message names the host and nothing secret.
        throw new EmbedError(`voyage unreachable: ${(error as Error).message}`, true);
      }

      if (!answer.ok) {
        // 429 and 5xx pass with time. Any other refusal would repeat. A bad or
        // forbidden key is refused for every text, so it is fatal to the run.
        const retryable = answer.status === 429 || answer.status >= 500;
        const fatal = answer.status === 401 || answer.status === 403;
        const wait = retryable ? parseRetryAfter(answer.headers.get('retry-after')) : undefined;
        throw new EmbedError(`voyage answered ${answer.status}: ${await reason(answer)}`, retryable, wait, fatal);
      }

      // The timeout covers the body as well as the headers, so it can fire here.
      let body: { data?: Array<{ index: number; embedding: number[] }> };
      try {
        body = (await answer.json()) as typeof body;
      } catch (error) {
        if ((error as Error).name === 'TimeoutError') {
          throw new EmbedError(`voyage timed out after ${timeoutMs} ms`, true);
        }
        throw new EmbedError(`voyage answer could not be read: ${(error as Error).message}`, true);
      }
      const data = [...(body.data ?? [])].sort((a, b) => a.index - b.index);
      if (data.length !== texts.length || data.some((row) => row.embedding.length !== EMBEDDING.dimension)) {
        throw new EmbedError(
          `voyage returned ${data.length} vectors for ${texts.length} texts, or a width other than ${EMBEDDING.dimension}`,
          false,
        );
      }
      return data.map((row) => row.embedding);
    },
  };
}

/** No `voyage` connection holds a key. The queue job treats this as nothing to do, and a script as an error. */
export class NoVoyageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoVoyageKeyError';
  }
}

/**
 * The embedder for the first `voyage` connection that holds a key.
 *
 * Throws `NoVoyageKeyError`, naming the Connections screen, when there is none.
 * `fetchImpl` is replaced in a test, so no suite reaches Voyage.
 */
export async function voyageFromConnection(
  client: ClientBase,
  fetchImpl: typeof fetch = fetch,
): Promise<Embedder> {
  const found = await client.query<{ id: string }>(
    `SELECT c.id FROM connections c
       JOIN connection_credentials k ON k.connection = c.id
      WHERE c.provider = 'voyage' ORDER BY c.created_at, c.id LIMIT 1`,
  );
  const id = found.rows[0]?.id;
  if (id === undefined) {
    throw new NoVoyageKeyError('no voyage connection holds a key. Add one on the Connections screen.');
  }
  const secret = await secretFor(client, id);
  if (secret === null) {
    throw new NoVoyageKeyError(`voyage connection ${id} holds no key.`);
  }
  return voyage(secret, fetchImpl);
}
