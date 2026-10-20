/**
 * The embedding job: chunk every source, embed every chunk and fact that needs
 * a vector. KPA-114.
 *
 * `src/embed/embedder.ts` does the work and `npm run embed` runs it by hand.
 * This gives it a clock and a place to run, so a source or a fact is embedded
 * without anyone running a script.
 *
 * TWO TRIGGERS, ONE JOB. It runs every five minutes and once when the worker
 * starts: that is the backlog sweep, which catches anything the other trigger
 * missed. An ingestion job that has just written a source or a fact sends
 * `EMBED` to start a run at once:
 *
 *     await boss.send(EMBED, {});
 *
 * The queue is `exclusive`, so a send while a run is queued or active adds
 * nothing. That is safe for the same reason the sweep exists: the rows written
 * meanwhile wait for the next run, at most five minutes.
 *
 * THE JOB OPENS ITS OWN CONNECTION. The worker's shared client is correct for a
 * job that sends single statements, because node-postgres runs them one at a
 * time. This job holds a transaction open across several statements, and on the
 * shared client another job's query would run inside it, and be rolled back with
 * it. So each run connects, works, and ends its own client.
 *
 * NO VOYAGE KEY MEANS NOTHING TO DO. Until someone adds a key on the
 * Connections screen the job logs that once and returns, so a missing key does
 * not fail the job on every tick. The next run that finds a key logs nothing
 * and works, and a key lost again logs again. It chunks nothing meanwhile: the
 * first run that finds a key chunks every source.
 *
 * A REJECTED KEY IS LOGGED AND DOES NOT FAIL THE JOB. pg-boss would retry a
 * failed job at once and call Voyage with the same key again. The embedder stops
 * the run at the first 401 or 403 and charges no row an attempt (see
 * `src/embed/embedder.ts`), so fixing the key resumes the backlog.
 *
 * AN OUTAGE PARKS NOTHING AND COSTS ONE BATCH. A failure of Voyage itself, a
 * 429, a 5xx or a timeout that uses up its tries, halts the run after that one
 * batch, logs it at error level and charges no row, so the first tick after
 * Voyage recovers embeds everything. Only a row whose own text Voyage refuses
 * counts toward `GIVE_UP_AFTER`. So does a refusal every text of a batch meets,
 * a renamed model for one: the run halts and charges nothing.
 *
 * A RUN HAS A TIME BUDGET BELOW THE QUEUE'S EXPIRY. A backlog is embedded in
 * batches, and a run that outlived `EXPIRE_IN_SECONDS` would be expired by
 * pg-boss while it still worked, freeing the exclusive queue for a second run
 * beside it. So the run stops picking batches at `RUN_BUDGET_SECONDS`, says so,
 * and the next tick continues.
 *
 * A LOST CONNECTION FAILS THE RUN. The client sits idle during every call to
 * Voyage, so a restart of the database in that window raises `error` on it. The
 * listener logs it, and the run's next query throws and fails the job.
 */
import type { PgBoss } from 'pg-boss';
import type { ClientBase } from 'pg';

import { connect } from '../db/connect.ts';
import {
  type Chunked,
  type Embedded,
  type Embedder,
  chunkSources,
  embedPending,
} from '../embed/embedder.ts';
import { NoVoyageKeyError, voyageFromConnection } from '../embed/voyage.ts';

export const EMBED = 'memory.embed';

/** Every five minutes: the longest a source waits when nothing sent `EMBED`. */
export const EMBED_CRON = '*/5 * * * *';

/**
 * The time a run may spend before it picks another batch. A batch already begun
 * runs to its end, and the longest one costs about 100 seconds: three calls of
 * 30 seconds and the waits between them. The rest of `EXPIRE_IN_SECONDS` covers it.
 */
export const RUN_BUDGET_SECONDS = 300;

/**
 * When pg-boss expires a run that has not finished: the budget, then the room for
 * the batch in flight. It is named here so that the budget has a known limit to
 * stay below, and a run never meets the expiry that frees the exclusive queue
 * for a second run beside it. A job lost with a crashed worker holds the queue
 * until this long has passed.
 */
export const EXPIRE_IN_SECONDS = 600;

/** What one run did. */
export interface Run {
  chunked: Chunked;
  embedded: Embedded;
}

/**
 * One run, or null when no Voyage connection holds a key. Anything else that
 * goes wrong, a database that cannot be reached or a key that will not open,
 * throws and fails the job.
 */
export async function run(client: ClientBase, fetcher: typeof fetch = fetch): Promise<Run | null> {
  let embedder: Embedder;
  try {
    embedder = await voyageFromConnection(client, fetcher);
  } catch (error) {
    if (error instanceof NoVoyageKeyError) return null;
    throw error;
  }
  const chunked = await chunkSources(client);
  const embedded = await embedPending(client, embedder, { budgetMs: RUN_BUDGET_SECONDS * 1000 });
  return { chunked, embedded };
}

/** The line a run prints, and one more for everything that went wrong. */
function report(found: Run): void {
  const { chunked, embedded } = found;
  console.log(
    `${EMBED}: chunked ${chunked.sources} sources into ${chunked.chunks} chunks, ` +
      `embedded ${embedded.embedded}, failed ${embedded.failed}, skipped ${embedded.skipped}, ` +
      `superseded ${embedded.superseded}`,
  );
  for (const failure of chunked.failures) {
    console.warn(`${EMBED}: source ${failure.sourceId} not chunked: ${failure.reason}`);
  }
  if (embedded.timedOut) {
    console.warn(`${EMBED}: the ${RUN_BUDGET_SECONDS} s time budget is spent, so the next run continues`);
  }
  for (const line of embedded.errors) {
    // The line that stopped the run is the one to notice.
    const log = line === embedded.halted ? console.error : console.warn;
    log(`${EMBED}: ${line}`);
  }
}

/**
 * The job's handler. `variable` names the environment variable holding the
 * connection string, and `fetcher` is replaced in a test so no suite reaches
 * Voyage.
 */
export function work(
  variable = 'DATABASE_URL',
  fetcher: typeof fetch = fetch,
): () => Promise<void> {
  // Whether the missing key has been said. A closure, so a test that builds its
  // own handler starts unsaid.
  let said = false;

  return async () => {
    const client = connect(variable);
    // Without a listener, an error on an idle client ends the process.
    client.on('error', (error) => console.error(`${EMBED}: database connection lost: ${error.message}`));
    try {
      await client.connect();
      const found = await run(client, fetcher);
      if (found === null) {
        if (!said) {
          console.warn(`${EMBED}: no voyage connection holds a key, so nothing is embedded. Add one on the Connections screen.`);
          said = true;
        }
        return;
      }
      said = false;
      report(found);
    } finally {
      await client.end();
    }
  };
}

export async function schedule(
  boss: PgBoss,
  variable = 'DATABASE_URL',
  fetcher: typeof fetch = fetch,
): Promise<void> {
  await boss.createQueue(EMBED, { policy: 'exclusive', expireInSeconds: EXPIRE_IN_SECONDS });

  await boss.work(EMBED, work(variable, fetcher));

  await boss.schedule(EMBED, EMBED_CRON);
  await boss.send(EMBED, {});
}
