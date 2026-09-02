/**
 * The backlog over `inbound_deliveries`, and what taking one row means.
 *
 * `src/webhooks/receive.ts` authenticates a delivery and stores the body
 * verbatim. Nothing reads it. This module is the other half: it finds what
 * has arrived and nobody has taken, and it runs the handler for that event.
 *
 * The rule the whole file exists for: a delivery that fails leaves its reason
 * on its own row. Migration 009 gives `error` and `processed_at` for that,
 * with a check that a reason needs a processing time. A failure that lands
 * only in a log is a failure nobody finds.
 */
import type { ClientBase } from 'pg';

/** One row of `inbound_deliveries`, as a worker reads it. */
export interface Delivery {
  /** `bigint`, which this driver hands back as a string. */
  id: string;
  source: string;
  deliveryId: string;
  event: string;
  payload: unknown;
}

/**
 * What turns one delivery into whatever it is worth.
 *
 * A handler throws to fail the delivery. It writes nothing to
 * `inbound_deliveries`: `runDelivery` owns that row's ending, so no handler
 * has to remember to.
 */
export type Handler = (client: ClientBase, delivery: Delivery) => Promise<void>;

interface Row {
  id: string;
  source: string;
  delivery_id: string;
  event: string;
  payload: unknown;
}

/**
 * The deliveries nobody has taken, oldest first.
 *
 * `processed_at IS NULL` and an order on `received_at` is exactly the shape
 * of `inbound_deliveries_unprocessed`, migration 009's partial index, so this
 * reads the index rather than the table however far the table grows.
 */
export async function backlog(client: ClientBase, limit = 100): Promise<Delivery[]> {
  const result = await client.query<Row>(
    `SELECT id, source, delivery_id, event, payload
       FROM inbound_deliveries
      WHERE processed_at IS NULL
      ORDER BY received_at
      LIMIT $1`,
    [limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    source: row.source,
    deliveryId: row.delivery_id,
    event: row.event,
    payload: row.payload,
  }));
}

/** One delivery by id, or null when the row has gone. A job outlives the row
 *  it names whenever a `down` runs between the two. */
export async function read(client: ClientBase, id: string): Promise<Delivery | null> {
  const result = await client.query<Row>(
    `SELECT id, source, delivery_id, event, payload
       FROM inbound_deliveries
      WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        source: row.source,
        deliveryId: row.delivery_id,
        event: row.event,
        payload: row.payload,
      }
    : null;
}

/** Ends a delivery. `reason` is null on success and the failure on the last
 *  attempt, which is the only pair the row's check accepts. */
export async function finish(
  client: ClientBase,
  id: string,
  reason: string | null,
): Promise<void> {
  await client.query(
    'UPDATE inbound_deliveries SET processed_at = now(), error = $2 WHERE id = $1',
    [id, reason],
  );
}

/**
 * Runs one delivery through `handler`, and ends its row.
 *
 * `lastAttempt` decides what a failure means. Before the last attempt this
 * rethrows, so pg-boss fails the job and retries it on its own backoff, and
 * the row stays unprocessed because the work is still owed. On the last
 * attempt it writes the reason to the row and returns, so the job completes
 * and the delivery stops being retried by anybody.
 *
 * A handler that succeeds after a failure leaves no error behind: `finish`
 * writes null over whatever an earlier attempt might have written.
 */
export async function runDelivery(
  client: ClientBase,
  delivery: Delivery,
  handler: Handler,
  lastAttempt: boolean,
): Promise<void> {
  try {
    await handler(client, delivery);
  } catch (cause) {
    if (!lastAttempt) throw cause;
    await finish(client, delivery.id, cause instanceof Error ? cause.message : String(cause));
    return;
  }
  await finish(client, delivery.id, null);
}
