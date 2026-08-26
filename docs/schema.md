# The schema

Ten tables and five enums, created by `migrations/001_core_schema.sql`. The
vault's own `CLAUDE.md` is the authority for every enum below.

Two rules shape all of it. **Nothing is ever deleted**: retiring a fact sets
`valid_to`. And **a machine never marks its own work verified**, which is a
check constraint here rather than an instruction in a prompt.

## The tables

| Table | Holds |
|---|---|
| `nodes` | Every endpoint an edge can point at. `facts`, `sources` and `entities` take their `id` from here, so `edges` can carry real foreign keys |
| `users` | One row. Every `owner_id` defaults to it |
| `sources` | Raw material, verbatim, never edited |
| `source_chunks` | What gets embedded, with the byte range in `sources.body` a citation opens at |
| `facts` | One row per note in a space, whatever its `type`, with the dates that retire it |
| `edges` | Typed, directional links between two nodes |
| `entities` | People, organisations and the like. Created now, populated by a later slice |
| `tasks` | An inline `- [ ]` from a note, with its due, start and done dates and the original line |
| `questions` | A question Shane can answer, closed by writing the answer into the fact |
| `rejections` | A candidate that did not become a fact, and why, so a later run does not raise it again |

## The enums

| Type | Values |
|---|---|
| `node_kind` | `fact`, `source`, `entity`, `url`, `unresolved` |
| `fact_type` | `person`, `customer`, `engagement`, `system`, `policy`, `decision`, `preference`, `reference`, `source` |
| `space` | `collibra`, `koinon`, `personal`, `shared` |
| `fact_status` | `draft`, `stable`, `deprecated` |
| `edge_kind` | `derived_from`, `links_to`, `supersedes` |

`edge_kind` is enumerated in one place so no call site invents a sixth.
`derived_from` comes from a `sources:` entry, `links_to` from a `[[wikilink]]`
in the body, and `supersedes` from a replacement to the fact it retires.

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
