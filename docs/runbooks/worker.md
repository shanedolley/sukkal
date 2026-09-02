# Running the worker

Written for KPA-109, and checked against a local database on 2 September 2026.

The worker is the second of the three services on amaterasu. It holds
everything long running: ingestion, agent runs, the nightly sweep, the Jira
poller. The web tier reads and serves, and nothing long running belongs in a
request handler.

Nothing in this process imports `apps/web`, and nothing in `apps/web` imports
this process. They meet at the database and nowhere else.

| | |
|---|---|
| Entry point | `src/worker/index.ts` |
| Command | `npm run worker` |
| Reads | `DATABASE_URL`, from `~/.config/kpa/env` |
| Queue | pg-boss, in the `pgboss` schema of the same database |
| Jobs today | `deliveries.drain` every minute, and `deliveries.take` on demand |

## Before you start it

Run the migrations. `migrations/011_worker_queue.sql` creates the `pgboss`
schema, and the worker is built with `createSchema: false`, so it stops
against a database nobody migrated rather than installing a schema no ledger
records.

```bash
npm run migrate
```

pg-boss owns every table inside that schema. It creates them the first time it
starts, and it migrates them between its own versions. The migration owns the
schema, and nothing else.

## Starting it

```bash
npm run worker
```

It prints the queues it registered. Stop it with Ctrl-C: it takes the signal,
lets what is running finish, and closes both connections.

## The one job it runs

`deliveries.drain` reads `inbound_deliveries` for the rows nobody has taken.
That is `processed_at IS NULL`, ordered by `received_at`, which is the shape of
`inbound_deliveries_unprocessed`, the partial index migration 009 created.

For every row whose `event` has a handler, the drain queues one
`deliveries.take` job carrying the row's id. The queue holds the id and never
the body: a nabium payload runs to megabytes, and a second copy earns nothing.
The `deliveries.take` queue is `exclusive` on that id, so a drain that runs
again before the job does adds nothing.

`deliveries.take` reads the row, runs the handler, and writes the row's ending.
A handler never writes to `inbound_deliveries` itself.

**No handler is registered today, and that is the honest state.** KPA-110 adds
`session.ready`. Until it lands, the drain leaves every delivery unprocessed
and prints the events it could not place. It marks nothing failed, because
nobody has failed at anything yet.

## When a delivery fails

The handler throws. Three things then follow, in this order.

1. pg-boss fails the job and retries it, at `retryCount` 0, 1 and 2. The delay
   grows: five seconds, then exponential backoff with jitter.
2. The row stays in the backlog through every attempt but the last, because
   the work is still owed.
3. The third failure is the last. The reason goes to the row's `error` column
   and `processed_at` is set, so a brief outage costs a delay rather than a
   delivery marked failed.

Read what failed with one query. The row carries the reason, and a check in
migration 009 refuses a reason with no processing time.

```sql
SELECT id, source, delivery_id, event, processed_at, error
  FROM inbound_deliveries
 WHERE error IS NOT NULL
 ORDER BY processed_at DESC;
```

To make the worker try again, clear both columns. The next drain finds the row
in the backlog.

```sql
UPDATE inbound_deliveries SET processed_at = NULL, error = NULL WHERE id = $1;
```

## Under systemd

The unit belongs beside the web tier's on amaterasu. Nothing installs it yet.

```ini
[Unit]
Description=KPA worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=kpa
WorkingDirectory=/opt/kpa
EnvironmentFile=/home/kpa/.config/kpa/env
ExecStart=/usr/bin/node src/worker/index.ts
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`Restart=on-failure` is safe. A job survives a restart because pg-boss holds it
in Postgres, so the worker comes back and takes what it left.

## Reading the queue

The queue is rows in the same database, so `psql` answers every question about
it. `pgboss.job` holds what is waiting, and `pgboss.schedule` holds the cron
entries.

```sql
SELECT name, state, count(*) FROM pgboss.job GROUP BY name, state;
SELECT name, cron FROM pgboss.schedule;
```

## Removing it

`npm run migrate down` drops the `pgboss` schema and everything in it, which
includes every queued job. That is deliberate, and it happens only on the way
to an empty database.
