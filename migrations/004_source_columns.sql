-- Gives sources the five fields the drawer shows, and lets a derived_from
-- edge name the passage a fact came from, not only the source.
--
-- Runs after 003_fact_state.sql, which drops facts.status. This migration
-- touches sources and edges only, so it depends on nothing that removes.
--
-- Every new column is nullable. KPA-5 is the story that writes the 32 vault
-- sources and fills these; filling them is out of scope here, and sources
-- already holds rows in other tests today, inserted before this migration
-- existed. A NOT NULL column with no default would reject every one of them.

-- The four kinds the interface renders. The vault's own kinds live in
-- facts.type; this is a source's kind, a narrower list because a source is
-- always one of these four things.
CREATE TYPE source_kind AS ENUM ('meeting', 'mail', 'document', 'chat');

ALTER TABLE sources
  ADD COLUMN kind   source_kind,
  ADD COLUMN title  text,
  ADD COLUMN date   date,
  ADD COLUMN author text,
  -- The same four-value space facts already uses. 'shared' is not vestigial:
  -- src/vault-mapping.ts exports it and facts are written with it, so this
  -- reuses the type rather than narrowing it to the three spaces the
  -- interface renders today. Docs/adr records why this needs no ADR of its
  -- own: dropping the value would break rows other stories already write,
  -- so keeping it is not a choice between two live options.
  ADD COLUMN space  space;

-- A derived_from edge already names the source a fact came from. This lets it
-- name the chunk too, so a citation opens at the passage rather than the top
-- of the file. Null on every edge kind but derived_from, and on a
-- derived_from edge written before chunking existed.
ALTER TABLE edges
  ADD COLUMN chunk_id bigint REFERENCES source_chunks (id);

-- @down

ALTER TABLE edges DROP COLUMN chunk_id;

ALTER TABLE sources
  DROP COLUMN kind,
  DROP COLUMN title,
  DROP COLUMN date,
  DROP COLUMN author,
  DROP COLUMN space;

DROP TYPE source_kind;
