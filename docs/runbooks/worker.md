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
| Jobs today | `deliveries.drain` every minute, `deliveries.take` on demand, and `nightly.review` at 03:30 Sydney |

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

## The delivery backlog

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

## The nightly review

`nightly.review` runs three things at 03:30 Sydney, in `src/worker/nightly.ts`.

1. The staleness sweep, `src/memory/sweep.ts`. It opens one `needs_you` row of
   kind `deadline` for every live, verified fact past its review date.
2. The six problems, `src/checks/problems.ts`. They read the vault.
3. The four advisories, `src/checks/advisories.ts`. They read the database.

The sweep is the only one of the three that writes. It changes no fact state,
which is ADR-0010: a stale fact is doing its job, and only a source or a human
retires one.

The run prints one line, and every problem and advisory line after it.

```
nightly.review: 2026-09-02, 3 stale (1 raised), 0 problems, 4 advisories
```

**Read the schedule in the queue, not here.** The cron and the timezone are
rows, so `psql` answers what is registered.

```sql
SELECT name, cron, timezone FROM pgboss.schedule;
```

`Australia/Sydney` is the timezone, because the job asks what today is and
Shane's day is the one it means. `apps/web/lib/format.ts` pins the same zone.

The problems find nothing on amaterasu. They read the Obsidian vault, the vault
sits on Shane's Mac, and no copy of it reaches the server. The line stays in the
report so the check runs wherever the vault does.

### Closing a review item without re-confirming the fact

Shane can close a `deadline` item and leave the fact alone. The fact is then
still stale, so the sweep would open the same item the next night, and every
night after that.

`needs_you.raised_for` stops that. It records the `stale_after` the item was
raised for, and the sweep opens nothing for a staleness a row already names,
open or closed. So closing an item settles that one review, and the fact
returns the night its `stale_after` moves past. Re-confirming moves it, and so
does an edit by hand. Nothing else does.

**A dismissed fact is not a lost fact.** `factState` derives `stale` from the
dates and reads no `needs_you` row, so a fact whose item you closed still reads
stale on the review screen. Only the briefing stops asking. Shane ruled on that
in KPA-136 on 3 September 2026.

Re-confirming needs no special case. ADR-0017 gives the fact a new
`stale_after`, the fact stops being stale, and the sweep closes the open item.
A fresh item opens the night that new date passes, however short the interval.

### When the review fails

The job opens one `needs_you` row of kind `question`, titled *The nightly review
did not finish*. The reason and the date go in `detail`.

```sql
SELECT id, detail, raised_at FROM needs_you
 WHERE title = 'The nightly review did not finish' AND closed_at IS NULL;
```

One row stands at a time. Closing it lets the next failure open another, which
is the opposite of the sweep's rule and is deliberate: a job that will not run
has to keep saying so.

A failure the job cannot write reaches nobody, because the database is what
broke. pg-boss still records the job, so read `pgboss.job` for the state and the
output.

The audit table is the better home for this record. KPA-82 builds the audit
write; route the failure through it once that lands.

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
