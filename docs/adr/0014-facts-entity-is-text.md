# facts.entity is text, not a foreign key

`facts` carries no `entity` column, and the briefing groups every queue by
one. `entities` exists since migration 001 but holds no rows, because entity
resolution is a later slice, not this one. This decides what `facts.entity`
is: plain, nullable text naming the customer, engagement, or person a fact
concerns, not a foreign key into `entities`. Decided while building KPA-65,
2 September 2026.

## Why not a foreign key

A foreign key needs a row in `entities` to point at. Nothing creates one
today. The vault's own frontmatter, read in `~/Development/obsidian_vaults/
Memory/CLAUDE.md`, carries no `entity` field either: a note names its type,
title, and tags, and a reader infers who it concerns from those, from
wikilinks, or from being a `person`/`customer`/`engagement` note itself.
Resolving that inference into a row in `entities` is the work the comment on
`entities` in migration 001 reserves for "the slice that ingests a second
source of people." KPA-65 is not that slice.

Two production call sites insert into `facts` today: `src/memory/gates.ts`,
where a candidate becomes a fact, and eight test files across the suite.
None of them name an entity, because none of them can resolve one yet. A
`NOT NULL` column, foreign key or not, would reject every one of those
inserts, breaking files this story does not own to fix. `migrations/
004_source_columns.sql` met the same shape of problem when `sources` gained
columns nothing yet filled, and answered it the same way: nullable, because a
`NOT NULL` column with no default rejects every writer that predates the
story filling it in.

## Considered options

1. **A nullable foreign key into `entities` now.** Every fact could point at
   an entity once resolution exists, and the database would enforce that a
   named entity is a real one. Rejected: `entities` is empty, so every row
   would carry `NULL` until the resolution slice lands, and the constraint
   buys nothing a later migration could not add once there is data to
   enforce it against.
2. **A foreign key, backed by a migration that invents entities from
   existing fact titles or paths.** Makes the column real immediately.
   Rejected: guessing an entity from a title is the guess the vault's
   "Never guess, ask instead" rule forbids. An invented entity is wrong in
   the same way an invented deadline is wrong, and this story exists to
   remove one guess, not add another.
3. **Plain, nullable text.** Chosen. It says what today's writers can
   actually supply, an entity's name, or nothing, and it is honest that
   nothing enforces the name matches a real entity yet.

## Consequences

- `facts.entity` and `entities.name` can disagree: nothing ties them
  together. That is the cost this decision accepts, paid back once the
  entity-resolution slice lands and can convert the column to a foreign key
  (or add one alongside it) and migrate the text values already written.
- `src/memory/sweep.ts` reads `facts.entity` for the `needs_you` row it
  opens, and `needs_you.entity` stays `NOT NULL`. A fact the sweep finds due
  for review with no entity set still has nowhere to write, the same gap
  migration 001 already left for entity resolution generally. Nothing calls
  `sweep()` outside its own tests, so this gap has nothing live to break
  today; the resolution slice that fills `facts.entity` closes it before
  sweep gets a scheduler.
- Every existing writer of `facts`, `src/memory/gates.ts`'s insert and each
  test file's, keeps working unchanged: an unlisted nullable column defaults
  to `NULL`.
