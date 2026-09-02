# The schema

Seventeen tables and eight enums. `migrations/001_core_schema.sql` created the
first ten, and migrations 003 to 010 changed what follows. Migration 011 adds
no table: it creates the schema the job queue lives in. The vault's own
`CLAUDE.md` is the authority for every enum the vault writes.

Two rules shape all of it. **Nothing is ever deleted**: retiring a fact sets
`valid_to`. And **a machine never marks its own work verified**, which is a
check constraint here rather than an instruction in a prompt.

## The tables

| Table | Holds |
|---|---|
| `nodes` | Every endpoint an edge can point at. `facts`, `sources` and `entities` take their `id` from here, so `edges` can carry real foreign keys |
| `users` | One row. Every `owner_id` defaults to it |
| `sources` | Raw material, verbatim, never edited. Carries the kind, title, date, author and space the drawer shows |
| `source_chunks` | What gets embedded, with the byte range in `sources.body` a citation opens at |
| `facts` | One row per note in a space, whatever its `type`, with the dates that retire it, the state it starts in, and the entity it concerns |
| `edges` | Typed, directional links between two nodes. A `derived_from` edge may name the chunk as well as the source |
| `entities` | People, organisations and the like. Created now, populated by a later slice |
| `tasks` | An inline `- [ ]` from a note, with its due, start and done dates and the original line |
| `rejections` | A candidate that did not become a fact, and why, so a later run does not raise it again |
| `policies` | The rules a policy engine consults before every outbound action |
| `audit` | One entry per attempt, allowed or denied alike. Append only |
| `needs_you` | The four kinds of item waiting on Shane. A row closes rather than disappears |
| `meetings` | A calendar event, never the transcript it produces |
| `conversations` | A chat, with the answers and citations below |
| `answers` | One question and its answer, read back in the order asked |
| `citations` | The source and the passage an answer's chip opens |
| `inbound_deliveries` | A webhook body, verbatim, waiting for a worker |

## The enums

| Type | Values |
|---|---|
| `node_kind` | `fact`, `source`, `entity`, `url`, `unresolved` |
| `fact_type` | `person`, `customer`, `engagement`, `system`, `policy`, `decision`, `preference`, `reference`, `source` |
| `space` | `collibra`, `koinon`, `personal`, `shared` |
| `fact_state` | `candidate`, `proposed`, `rejected` |
| `edge_kind` | `derived_from`, `links_to`, `supersedes` |
| `source_kind` | `meeting`, `mail`, `document`, `chat` |
| `audit_outcome` | `allowed`, `denied` |
| `needs_you_kind` | `draft`, `question`, `denied-action`, `deadline` |

`edge_kind` is enumerated in one place so no call site invents a sixth.
`derived_from` comes from a `sources:` entry, `links_to` from a `[[wikilink]]`
in the body, and `supersedes` from a replacement to the fact it retires.

`node_kind` has no value for a root page. The vault's `index.md`, `log.md`,
`CLAUDE.md` and `README.md` belong to none of the memory's three layers, so a
wikilink naming one resolves `unresolved`. ADR-0019 decided that and measures
what it costs: not the nine citations anyone would count, but two orphan
advisories, raised by links running the other way.

## A fact's state: three stored, three derived

The interface shows a fact in one of six states. `facts.state` stores three,
because each is a judgement somebody made. The other three read columns the
row already carries, so nothing holds one truth twice.

| State | Reads |
|---|---|
| `verified` | `verified IS NOT NULL` |
| `stale` | `verified IS NOT NULL AND stale_after < today AND valid_to IS NULL` |
| `retired` | `valid_to IS NOT NULL` |

`src/memory/state.ts` builds it from a row and a day. The day is an argument,
never a call to `now()` inside the function, because a fact goes stale when a
date passes and a test has to hold that day still.

Retirement settles the question first. A retired fact reads `retired` whatever
`stale_after` says, because `valid_to` is the later and more deliberate word.

This replaced `fact_status`, whose `draft`, `stable` and `deprecated` described
how finished a vault note was. ADR-0010 says why, and it leaves the vault's
three values for KPA-5 to translate on the way in.

## What a citation opens

A citation names a passage, so `edges` carries a nullable `chunk_id` beside the
source a `derived_from` edge already named. Without it a citation opens the top
of a file and leaves the reader to find the line.

`source_chunks` stores a byte range into `sources.body` rather than a second
copy of the text, because a source is verbatim and two copies drift.
`src/memory/source.ts` reads that range back through a `Buffer`, since the
offsets count bytes and `String.prototype.slice` counts UTF-16 code units. The
two disagree from the first character outside ASCII.

`chunkForFact` joins the chunk back to the source its edge points at, so a
`chunk_id` left by a data error resolves to nothing rather than to the wrong
passage.

The five columns `sources` gained are all nullable. KPA-5 fills them, and a
`NOT NULL` column with no default would reject every row written before this
migration existed.

**The drawer cuts the passage out of the body.** `apps/web/lib/sources.ts`
reads the source and its chunks and calls `chunkText`, which is the one place
the byte range is resolved. `String.prototype.slice` counts UTF-16 code units
and agrees with a byte offset only while every character is ASCII, so one
accented character moves every passage after it by one position.

The five columns migration 004 added are nullable and nothing fills them yet.
A source missing any of them opens nothing, and the drawer says so, rather
than drawing a heading with no kind and no date.

## Policy and audit

The brief calls the policy layer load bearing and the audit log the safety net.
Nothing approves an action before it runs, so these two tables carry that
weight alone. ADR-0005 says why a table rather than a paragraph in a prompt.

`policies` holds one row per rule: what it governs, what it allows or denies,
and whether it is on. `absolute` marks a rule Shane may not turn off, and
`src/policy/engine.ts` denies on an absolute rule whether `enabled` is true or
false. Migration 005 seeds the four rules the brief names. Migration 012 adds
`deny-by-default`, which is the engine's own behaviour rather than a fifth rule
about what KPA may do. ADR-0021.

| Key | Absolute | Seeded by |
|---|---|---|
| `mail.send.never-unprompted` | yes | 005 |
| `never-delete-or-destructively-edit` | yes | 005 |
| `fact.verify.never-by-agent` | no | 005 |
| `space.collibra-koinon-separation` | no | 005 |
| `deny-by-default` | yes | 012 |

`deny-by-default` exists because two failures name no other rule: an action the
engine's allowlist does not describe, and any action proposed while the table
is empty, unreadable or malformed. Both must deny, and
`audit_denial_names_a_rule` refuses a denial that names no rule. So the engine
either names a rule that did not fire, returns a denial the log cannot record,
or names this one.

`audit` holds one row per attempt. Every row carries the four fields the brief
requires: `intent`, `before`, `result`, and `reverse`. A denial names the rule
by `rule`, a foreign key into `policies.key` rather than a copy of its prose,
so a rule can be reworded without rewriting every entry that ever cited it.
`audit_denial_names_a_rule` holds a denial to that promise, and lets an allowed
entry name none.

**Append only, and enforced.** This table is what catches a mistake after the
fact, so two triggers guard it rather than a convention. `audit_append_only`
raises on every `UPDATE` and `DELETE`, in the same style as
`nodes_must_be_claimed`. `audit_never_truncated` raises on `TRUNCATE`, which
fires no row-level trigger and would otherwise empty the whole log in one
statement and leave nothing saying it happened. Neither stops `DROP TABLE`,
which belongs to role permissions once the worker owns a database user.

`audit_outcome_at` indexes `(outcome, at DESC)`, so the screen's two questions,
just the denials and newest first, come from one index.

## The needs-you queue

Four kinds wait on Shane: a draft to send, a question to answer, an action the
policy refused, and a deadline coming. The screen reads them as one list in
arrival order, so they share one table and one shape.

A denial names the audit entry that refused it, so the screen can show what the
policy said rather than only that something was stopped. A row may point at the
fact or the source it came from, and may point at neither.

Nothing here disappears. A row closes by setting `closed_at`, which is the same
rule retirement follows for a fact.

`questions` used to hold one of these four kinds and `006_needs_you.sql` drops
it. Every row on the screen shows a space and an entity, and `questions` held
neither. ADR-0012 records why the join that would have supplied them cannot
work.

## Chat history

`conversations`, `answers`, and `citations` hold what the chat screen reads.
Two things stay derived, so the database can never disagree with the code above
it. A conversation's token count reads from its answers rather than a stored
total. An answer crosses spaces when its citations came from more than one, and
`apps/web/lib/space.ts` holds that rule for the interface.

`answers` reads back by `asked_at`, never by `id`. An id only happens to track
the order rows arrived, and nothing makes the two agree.

A citation names a source and a chunk together, through one composite key into
`source_chunks (id, source_id)`. Naming a chunk from another source would open
the wrong text under the right title, which reads as a correct answer and is
not one. `edges` tolerates that mismatch because it predates chunking and
resolves it in code; this table carries no such history.

## What arrives over a webhook

`inbound_deliveries` takes a posted body verbatim and parses it no further.
The sender owns the shape, and a receiver that interprets on the way in loses
whatever it failed to understand. That is the rule `sources` already obeys.

The table is not nabium's. `source` names the sender, so a second sender needs
a value rather than a table. `(source, delivery_id)` is unique, and that pair
is the whole retry story: a sender repeating a delivery writes nothing twice.

`processed_at` is null while the work is owed, so the backlog is one query and
a crash loses nothing. `error` holds what went wrong, and a check refuses a
reason for a failure that has not happened.

ADR-0013 records why nabium sends the payload rather than a trigger, and why a
webhook is acceptable here where ADR-0008 refused one for Jira.

`src/worker/deliveries.ts` reads the backlog and ends each row.
`docs/runbooks/worker.md` says how to see what failed, and how to make the
worker try a delivery again.

## The column KPA-94 has not created yet

`src/auth/password.ts` hashes and verifies a password, and nothing stores one.
KPA-94 creates the account row, and the column that holds this module's output
is `text`, never `varchar(n)`.

An encoded hash is 88 characters at today's cost:

```
$scrypt$ln=17,r=8,p=1$<22 chars of base64>$<43 chars of base64>
```

The length changes whenever the cost, the salt or the key size changes, and
ADR-0020 records that raising the cost is expected. A width chosen from today's
88 characters would refuse a hash the same code wrote a year later.

## The queue lives in its own schema

Migration 011 creates the schema `pgboss` and nothing inside it. pg-boss owns
every table there: it creates them the first time the worker starts, and it
migrates them between its own versions.

The worker is built with `createSchema: false`, so the schema has one owner.
A worker started against a database nobody migrated stops with a missing
schema rather than installing one no ledger records, which is the answer the
migration runner already gives when it finds a database it did not create.

Reversing migration 011 drops the schema and every queued job with it. That is
deliberate, and it happens only on the way to an empty database.

## The entity a fact concerns

`facts.entity` and `needs_you.entity` are both nullable text, and neither is a
foreign key into `entities`. ADR-0014 records why.

`entities` exists and holds no rows. The vault's frontmatter carries no entity
field at all: a note's type, title and tags only imply who it concerns, and
resolving that is reserved for the slice that ingests a second source of
people. Eight callers insert a fact today and none names an entity, so a
`NOT NULL` column would reject every one of them.

**`needs_you.entity` had to follow, and that is the half worth knowing about.**
It was `NOT NULL` when the queue was built. The sweep reads `facts.entity`
straight into it, so one due fact naming no entity failed the whole insert and
the run raised nothing at all. Not a row lost, every row lost, on a job that
exists so Shane sees what is waiting. A constraint no writer can satisfy is a
constraint against the product.

Reversing migration 010 leaves `needs_you.entity` nullable rather than
restoring the constraint, because rows the sweep already raised would violate
it, and the only ways round that are to invent a value or to delete a review
item.

## The frontmatter mapping

`src/vault-mapping.ts` holds it, and `test/schema.test.ts` fails on any key a
note in a space carries and the mapping does not. That test runs against the
real vault, so a schema gap is found before ingestion rather than after.

Notes under `sources/` are excluded. They store verbatim in `sources.body` and
keep whatever frontmatter they arrived with, so they have no schema to fit.

## Three decisions a reader would otherwise question

**`facts.path` is not in the PRD's column list.** It is here because a wikilink
resolves against a note's file name, and `title` is prose. Without `path`
nothing can turn `[[a-note]]` back into a row. This is a schema gap the mapping
work found, recorded rather than quietly added.

**`facts.description` carries no length constraint**, though the vault's
convention says under 200 characters. `check.py` reports an over-length
description and migrates the note anyway. A constraint here would reject where
the old system continues, and KPA-13 verifies the migration by diffing the two
reports, so they have to agree.

**`entities.kind` is `text`, not an enum.** Nothing populates the table this
slice. An enum invented before there is a row to put in it is a guess, and this
schema is meant to record what is known.

The same reasoning leaves `verified` set without `verified_by` unconstrained.
`check.py` raises it as a problem and continues, and KPA-11 ports that message
unchanged. A constraint would turn a report into a failure.

## The registry, and what it enforces

`docs/adr/0007-a-node-registry-for-edges.md` carries the reasoning. In short,
three constraints hold the invariant and they cover different directions.

1. Each child table's `node_kind` column is fixed to its own value by a check,
   so `facts` can only claim a node of kind `fact`.
2. A composite foreign key into `nodes (id, kind)` stops one id being claimed by
   two child tables.
3. A deferred constraint trigger, `nodes_must_be_claimed`, rejects at commit a
   `nodes` row of kind `fact`, `source` or `entity` with no child row. Deferred,
   so the two inserts may run in either order inside one transaction.

## The embedding width

`src/embedding.ts` names the model and the dimension, and both vector columns
declare that width. **Changing either is a migration**, not a configuration
change: the existing vectors are the wrong width and the wrong model's output,
so they have to be rebuilt. A test asserts the schema and that file agree.

Today: `voyage-4` at 1024 dimensions.

## Applying it

```
npm run migrate          # applies to DATABASE_URL
npm run migrate down     # reverses it, leaving the database empty
```

The down migration removes children before the registry, and leaves the
`vector` extension alone, because `scripts/provision-amaterasu.sh` installed it
and this migration did not.
