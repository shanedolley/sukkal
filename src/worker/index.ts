/**
 * The worker: everything long running, and nothing that answers a request.
 *
 * The brief calls the split between this process and the web tier load
 * bearing. An agent run or a mail backfill inside a request handler holds a
 * connection open for minutes and dies with the request. So the web tier
 * reads and serves, and every job in the project runs here.
 *
 * This process imports nothing from `apps/web`, and `apps/web` imports
 * nothing from here. The two meet at the database and nowhere else.
 *
 * Four jobs run today: the backlog over `inbound_deliveries`, every minute,
 * the nightly review in `./nightly.ts`, the hourly credential recheck in
 * `./recheck.ts`, and the daily expiry sweep in `./sweep.ts`. Every other scheduled job in the
 * project waits on this file for somewhere to run, and each belongs to the
 * epic whose work it does rather than to this one.
 */
import path from 'node:path';
import { PgBoss } from 'pg-boss';
import type { ClientBase } from 'pg';
import { connect, connectionString } from '../db/connect.ts';
import { backlog, read, runDelivery, type Handler } from './deliveries.ts';
import { NIGHTLY, NIGHTLY_CRON, schedule as scheduleNightly } from './nightly.ts';
import { RECHECK, RECHECK_CRON, schedule as scheduleRecheck } from './recheck.ts';
import { EXPIRY, EXPIRY_CRON, schedule as scheduleExpiry } from './sweep.ts';

/** Migration 011 creates this. pg-boss owns every table inside it. */
export const QUEUE_SCHEMA = 'pgboss';

/** Finds what has arrived and queues one job for each row it can place. */
export const DRAIN = 'deliveries.drain';

/** One delivery. The job carries the row's id, never its body: a payload runs
 *  to megabytes and the queue has no reason to hold a second copy. */
export const TAKE = 'deliveries.take';

/** How often the drain looks. A meeting summary is not urgent, and a minute
 *  bounds how long a delivery waits without polling the table all day. */
export const DRAIN_CRON = '* * * * *';

/**
 * Every inbound event this worker knows how to turn into something.
 *
 * Empty today, and that is the honest state: KPA-110 adds `session.ready`,
 * and the stories after it add their own. A delivery whose event names no
 * handler is left unprocessed rather than marked failed, because nobody has
 * failed at it yet. `drain` reports what it could not place, so a backlog
 * nobody owns is visible rather than silent.
 */
const HANDLERS: Record<string, Handler> = {};

/**
 * Queues a job for every delivery whose event has a handler.
 *
 * The `TAKE` queue is `exclusive` on the delivery's id, so a drain that runs
 * again before a job does adds nothing. That matters: this runs every minute
 * and a row stays unprocessed until its job finishes.
 *
 * Returns what it found, which the caller logs.
 */
export async function drain(
  client: ClientBase,
  boss: PgBoss,
  handlers: Record<string, Handler>,
): Promise<{ queued: number; unhandled: string[] }> {
  const waiting = await backlog(client);
  const unhandled = new Set<string>();
  let queued = 0;

  for (const delivery of waiting) {
    if (!handlers[delivery.event]) {
      unhandled.add(delivery.event);
      continue;
    }
    await boss.send(TAKE, { id: delivery.id }, { singletonKey: delivery.id });
    queued += 1;
  }

  return { queued, unhandled: [...unhandled].sort() };
}

/** Builds the queue against the same connection string every other part of
 *  Sukkal connects with. `createSchema: false` because migration 011 owns the
 *  schema, so a worker started against an unmigrated database stops rather
 *  than installing one nobody recorded. */
export function queue(variable = 'DATABASE_URL'): PgBoss {
  return new PgBoss({
    connectionString: connectionString(variable),
    schema: QUEUE_SCHEMA,
    createSchema: false,
    application_name: 'kpa-worker',
  });
}

/**
 * Creates both queues, registers both workers, and schedules the drain.
 *
 * A delivery retries three times with exponential backoff: at
 * `retryCount` 0, 1 and 2. The third failure is the last, and only then does
 * the reason reach the row, so a database that is briefly unreachable costs a
 * delay rather than a delivery marked failed.
 */
export async function register(
  boss: PgBoss,
  client: ClientBase,
  handlers: Record<string, Handler>,
): Promise<void> {
  await boss.createQueue(DRAIN, { policy: 'exclusive' });
  await boss.createQueue(TAKE, {
    policy: 'exclusive',
    retryLimit: 2,
    retryDelay: 5,
    retryBackoff: true,
  });

  await boss.work(DRAIN, async () => {
    const found = await drain(client, boss, handlers);
    if (found.queued > 0) console.log(`${DRAIN}: queued ${found.queued}`);
    if (found.unhandled.length > 0) {
      console.warn(`${DRAIN}: no handler for ${found.unhandled.join(', ')}`);
    }
  });

  // includeMetadata, because the handler needs to know which attempt this is:
  // only the last one writes the reason to the delivery's row.
  await boss.work<{ id: string }, void, { includeMetadata: true }>(
    TAKE,
    { includeMetadata: true },
    async ([job]) => {
      if (!job) return;
      const delivery = await read(client, job.data.id);
      if (!delivery) {
        console.warn(`${TAKE}: delivery ${job.data.id} has gone`);
        return;
      }
      const handler = handlers[delivery.event];
      if (!handler) {
        console.warn(`${TAKE}: no handler for ${delivery.event}`);
        return;
      }
      await runDelivery(client, delivery, handler, job.retryCount >= job.retryLimit);
    },
  );

  await boss.schedule(DRAIN, DRAIN_CRON);
}

async function main(): Promise<void> {
  // ponytail: one client for the worker's own queries, alongside the pool
  // pg-boss opens for the queue. node-postgres serialises on a client, so
  // this is correct and serial. Give it a pool when a job needs two queries
  // running at once.
  const client = connect('DATABASE_URL');
  await client.connect();

  const boss = queue('DATABASE_URL');
  boss.on('error', (error) => console.error('pg-boss:', error));

  await boss.start();
  await register(boss, client, HANDLERS);
  await scheduleNightly(boss, client);
  await scheduleRecheck(boss, client);
  await scheduleExpiry(boss, client);
  console.log(
    `kpa-worker: ${DRAIN} every minute, ${TAKE} on demand, ` +
      `${NIGHTLY} at ${NIGHTLY_CRON}, ${RECHECK} at ${RECHECK_CRON}, ` +
      `${EXPIRY} at ${EXPIRY_CRON}`,
  );

  const stop = async (signal: string): Promise<void> => {
    console.log(`kpa-worker: ${signal}, finishing what is running`);
    await boss.stop();
    await client.end();
  };
  process.once('SIGINT', () => void stop('SIGINT'));
  process.once('SIGTERM', () => void stop('SIGTERM'));
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
