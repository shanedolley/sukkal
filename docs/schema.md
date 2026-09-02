# The schema

Twelve tables and six enums. `migrations/001_core_schema.sql` created the
first ten, and migrations 003 to 005 changed what follows. The vault's own
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
| `facts` | One row per note in a space, whatever its `type`, with the dates that retire it and the state it starts in |
| `edges` | Typed, directional links between two nodes. A `derived_from` edge may name the chunk as well as the source |
| `entities` | People, organisations and the like. Created now, populated by a later slice |
| `tasks` | An inline `- [ ]` from a note, with its due, start and done dates and the original line |
| `questions` | A question Shane can answer, closed by writing the answer into the fact |
| `rejections` | A candidate that did not become a fact, and why, so a later run does not raise it again |
| `policies` | The rules a policy engine consults before every outbound action |
| `audit` | One entry per attempt, allowed or denied alike. Append only |

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

`edge_kind` is enumerated in one place so no call site invents a sixth.
`derived_from` comes from a `sources:` entry, `links_to` from a `[[wikilink]]`
in the body, and `supersedes` from a replacement to the fact it retires.

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

## Policy and audit

The brief calls the policy layer load bearing and the audit log the safety net.
Nothing approves an action before it runs, so these two tables carry that
weight alone. ADR-0005 says why a table rather than a paragraph in a prompt.

`policies` holds one row per rule: what it governs, what it allows or denies,
and whether it is on. `absolute` marks the two rules Shane may not turn off.
The migration seeds the four the brief names.

| Key | Absolute |
|---|---|
| `mail.send.never-unprompted` | yes |
| `never-delete-or-destructively-edit` | yes |
| `fact.verify.never-by-agent` | no |
| `space.collibra-koinon-separation` | no |

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
