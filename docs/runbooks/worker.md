# Running the worker

Written for KPA-109, and checked against a local database on 2 September 2026.

The worker is the second of the three containers planned for amaterasu. None
runs there on 19 October 2026. It holds
everything long running: ingestion, agent runs, the nightly sweep, the Jira
poller. The web tier reads and serves, and nothing long running belongs in a
request handler.

Nothing in this process imports `apps/web`, and nothing in `apps/web` imports
this process. They meet at the database and nowhere else.

| | |
|---|---|
| Entry point | `src/worker/index.ts` |
| Command | `npm run worker` |
| Reads | `DATABASE_URL`, from `~/.config/sukkal/env` on the Mac and `/etc/sukkal/env` on amaterasu |
| Queue | pg-boss, in the `pgboss` schema of the same database |
| Jobs today | `deliveries.drain` every minute, `deliveries.take` on demand, `nightly.review` at 03:30 Sydney, `connections.recheck` at five past every hour, `expired.sweep` at quarter past four, and `memory.embed` every five minutes |

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

## The connection recheck

`connections.recheck` runs at five past every hour and once when the worker
starts, in `src/worker/recheck.ts`. It asks each provider whether each stored
credential still works and writes the answer to `connection_credentials`:
`verified_ok`, `verified_at`, `verified_on` and `verdict`. The Connections screen
outlines a failing card in red, and the navigation marks the set. KPA-107.

```
connections.recheck: checked 3, 2 failing
connections.recheck: shanevdolley@gmail.com: https://oauth2.googleapis.com/token refused the request. invalid_grant: Token has been expired or revoked.
```

**It records and nothing more.** A failure never removes or disables a
connection. Reconnecting is a person's job, through the Connections screen.

**It never spends money.** A probe `src/connections/verify.ts` marks
`metered`, Voyage today, is skipped, and that connection stays unchecked.

**A credential checked in the last 50 minutes is skipped**, so a restart right
after the hourly run costs no second call.

**`invalid_grant` on a Google connection seven days after it was made** is most
likely Google's limit for an OAuth client whose consent screen is in Testing.
Reconnecting fixes it for another seven days. Moving the consent screen to In
production ends the limit.

## The expiry sweep

`expired.sweep` runs once a day, at quarter past four, and once when the
worker starts, in `src/worker/sweep.ts`. It removes two kinds of row.

1. Session rows past `expires_at`, with `sweepExpired` in `src/auth/session.ts`.
2. Abandoned OAuth grants past `expires_at`, with `sweepExpired` in
   `src/connections/oauth.ts`.

A session row past its expiry is already inert: `src/auth/session.ts` refuses
to read one. An OAuth grant row holds a PKCE verifier until the browser
returns, so an abandoned one is a small standing exposure rather than only
growth, and clearing it is the reason this job exists.

The two sweeps run together and neither waits on the other. One throwing
leaves the row behind for the next run and still lets the other sweep finish,
so the job never fails as a whole over one broken table. The run prints one
line naming both counts.

```
expired.sweep: sessions 2, grants 1
```

A sweep that fails prints a second line naming which one and why, and the
count beside it reads `failed` rather than a number.

```
expired.sweep: sessions failed, grants 1
expired.sweep: sessions sweep failed: error: relation "sessions" does not exist
```

## The embedding job

`memory.embed` runs every five minutes and once when the worker starts, in
`src/worker/embed.ts`. It chunks every source and embeds each chunk and fact
that needs a vector. KPA-114. `npm run embed` runs the same code by hand, and
the two may run together.

```
memory.embed: chunked 30 sources into 101 chunks, embedded 4, failed 0, skipped 0, superseded 0
```

**A row needs a vector when it has none, or when its text has changed since it
was embedded.** `embedded_hash` on `source_chunks` and `facts` holds the SHA-256
of the text the vector was made from (migration 034), and the job compares it
with the text the row holds now. So a fact whose title or description is edited,
or a source body edited in place under an unchanged chunk range, is embedded
again. A row embedded before that migration has no hash and is embedded once
more.

**An ingestion job that writes a source or a fact starts a run at once** with
`await boss.send(EMBED, {})`, importing `EMBED` from `src/worker/embed.ts`. The
queue is `exclusive`, so a send while a run is queued or active adds nothing,
and the rows written in the meantime wait for the five-minute sweep.

**The vector is written only if the row is still the one that was read.** The
update names the hash of the text that was embedded and matches only a row that
still holds that text and still needs the vector. A write that matches nothing
counts as `superseded`, and the run that holds the current text embeds the row.
Two workers, or the job beside `npm run embed`, never leave a vector for text a
row no longer holds.

**No Voyage key means nothing to do.** With no `voyage` connection holding a
key, the job logs that once, writes nothing and completes. It logs again only
after a key was there and went. Add the key on the Connections screen.

```
memory.embed: no voyage connection holds a key, so nothing is embedded. Add one on the Connections screen.
```

**A rejected key stops the run.** Voyage answering 401 or 403 stops the run
after one call and logs an error. No row is charged an attempt, so fixing the
key resumes the backlog. The job completes rather than fails, because pg-boss
would retry it at once with the same key. Nothing else flags a dead Voyage key,
because the hourly recheck skips Voyage as metered.

```
memory.embed: source_chunks: voyage answered 401: Provided API key is invalid.
```

**A Voyage outage stops the run too, and charges no row.** A 429, a 5xx, a
timeout, a network error or an unreadable answer is Voyage's fault and not the
row's. When a batch uses up its three tries on one, Voyage is down for every
later batch as well, so the run halts there: what it has already written stays,
the facts are skipped if the chunks halted, and the error is logged. An outage
costs three calls a tick, whatever the backlog. The next tick tries again, and
the first tick after Voyage recovers embeds everything. `embed_attempts` is left
where it was, because a count that charged these would park every row within a
few ticks of any outage and leave them skipped after it ended.

```
memory.embed: facts: voyage answered 503: busy
```

**A refusal every row meets stops the run too, and charges no row.** A 401, 402,
403 or 404, or a reply of the wrong count or width, is Voyage's fault and not the
rows'. The run halts at once, with no split. A 400 or 422 may be one bad text or
a renamed model, and the status cannot say which. So the run splits the first
batch, and when every row is refused it sends one more call: the text `canary`.
If Voyage refuses that too, the run halts and charges nothing. If it embeds, the
rows are poison, each is charged one attempt as below, and the run goes on to
the next batch and the facts. The canary's vector is thrown away. A batch where
some rows embed and some are refused is not this case: only the refused rows are
charged. The fix is the cause, such as the model name in `src/embedding.ts`, and
the next tick embeds everything.

```
memory.embed: facts: every text of a batch of 64 was refused, and so was a canary: voyage answered 400: invalid model
```

**A poison row is left alone after ten attempts.** Voyage refuses its text with a
non-retryable answer, such as a 400. The run splits the batch until that one row
is alone, the good rows embed, and the poison row is charged one attempt. At ten
it is counted as `skipped` and never sent again. `embed_attempts` counts the
calls made since the row's last success. To try parked rows again:

```sql
UPDATE facts SET embed_attempts = 0 WHERE embed_attempts >= 10;
UPDATE source_chunks SET embed_attempts = 0 WHERE embed_attempts >= 10;
```

**The job opens its own database connection for each run.** It holds a
transaction across several statements, and on the worker's shared client another
job's query would run inside it.

**A run stops picking batches after 300 seconds.** `RUN_BUDGET_SECONDS` in
`src/worker/embed.ts` is the budget, and the queue expires a run at
`EXPIRE_IN_SECONDS`, 600, so a run never meets the expiry. A batch already begun
finishes, and the longest takes about 100 seconds. The log says the budget is
spent, and the next tick continues. Without a budget, a run that outlived the
expiry would free the exclusive queue and a second run would start beside it.

```
memory.embed: the 300 s time budget is spent, so the next run continues
```

**A lost database connection fails the run, and in the worker it ends the
process.** The run's client is idle while Voyage answers, so a restart of the
database in that window is logged as `memory.embed: database connection lost`
and the job fails. The worker's shared client does the same on loss: it logs
`kpa-worker: database connection lost`, stops the queue for up to 5 seconds so
that a running job is handed back, and exits 1. The supervisor
(`restart: unless-stopped` under Docker) starts it again. pg-boss holds the
queued jobs in Postgres, so none are lost.

## Under Docker

On amaterasu the worker runs as the `worker` service of `compose.yaml`, from the
same image as the web tier, and reads `/etc/sukkal/env`. `docs/runbooks/deploy.md`
says how to start it, read its logs and roll it back. ADR-0026 records the choice.

`restart: unless-stopped` is safe. A job survives a restart because pg-boss holds
it in Postgres, so the worker comes back and takes what it left. The container
gets a stop signal and `init: true` passes it on, so the worker still lets a
running job finish and closes both connections.

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
