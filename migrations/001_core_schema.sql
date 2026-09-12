-- The core schema: the tables the memory lives in.
--
-- The vault's own CLAUDE.md is the authority for every enum below. Where this
-- file and that one disagree, that one is right.
--
-- Two rules shape the whole design. Nothing is ever deleted: retiring a fact
-- sets valid_to. And a machine never marks its own work verified, which is a
-- check constraint here rather than an instruction in a prompt.

CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- The five things an edge can point at. 'url' and 'unresolved' have no child
-- table, so they carry their value in nodes.ref.
CREATE TYPE node_kind AS ENUM ('fact', 'source', 'entity', 'url', 'unresolved');

-- The nine values the vault defines.
CREATE TYPE fact_type AS ENUM (
  'person', 'customer', 'engagement', 'system', 'policy',
  'decision', 'preference', 'reference', 'source'
);

CREATE TYPE space AS ENUM ('collibra', 'koinon', 'personal', 'shared');

CREATE TYPE fact_status AS ENUM ('draft', 'stable', 'deprecated');

-- Enumerated in one place, so no call site invents a sixth.
--   derived_from  a fact to a source it was compiled out of, from `sources:`
--   links_to      a [[wikilink]] in the body
--   supersedes    a replacement to the fact it retires
CREATE TYPE edge_kind AS ENUM ('derived_from', 'links_to', 'supersedes');

-- ---------------------------------------------------------------------------
-- nodes: the registry that makes the graph enforceable
-- ---------------------------------------------------------------------------
--
-- An edge points at a fact, a source, an entity, a URL, or a wikilink whose
-- target does not exist. Postgres cannot enforce a foreign key against a
-- column whose target table varies by row, so facts, sources and entities take
-- their id from here and edges carries two ordinary foreign keys into it.
--
-- See docs/adr/0007-a-node-registry-for-edges.md.

CREATE TABLE nodes (
  id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind node_kind NOT NULL,
  -- The URL, or the raw text of a wikilink that resolved to nothing. Null for
  -- the three kinds that have a child table holding the detail.
  ref  text,

  CONSTRAINT nodes_ref_suits_kind CHECK (
    CASE kind
      WHEN 'url'        THEN ref IS NOT NULL
      WHEN 'unresolved' THEN ref IS NOT NULL
      ELSE ref IS NULL
    END
  ),

  -- A child table pins its own kind through this, so a node of one kind
  -- cannot be claimed by the table belonging to another.
  CONSTRAINT nodes_id_kind UNIQUE (id, kind)
);

COMMENT ON TABLE nodes IS
  'Every edge endpoint. facts, sources and entities take their id from here.';

-- ---------------------------------------------------------------------------
-- users: one row, and every owner_id defaults to it
-- ---------------------------------------------------------------------------
--
-- Sukkal is single user. This column exists only so that adding a second user
-- later is not a migration of every table holding anything personal. Nothing
-- else in the design may assume a second user exists.

CREATE TABLE users (
  id   bigint PRIMARY KEY,
  name text NOT NULL UNIQUE
);

INSERT INTO users (id, name) VALUES (1, 'shane');

-- ---------------------------------------------------------------------------
-- sources: raw material, verbatim, never edited
-- ---------------------------------------------------------------------------

CREATE TABLE sources (
  id          bigint PRIMARY KEY,
  node_kind   node_kind NOT NULL DEFAULT 'source' CHECK (node_kind = 'source'),
  owner_id    bigint NOT NULL DEFAULT 1 REFERENCES users (id),

  -- Relative to the vault root, so it identifies the file and resolves a
  -- wikilink pointing at it.
  path        text NOT NULL UNIQUE,
  body        text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),

  FOREIGN KEY (id, node_kind) REFERENCES nodes (id, kind)
);

COMMENT ON COLUMN sources.body IS
  'The file as it arrived, frontmatter included. Imported material keeps '
  'whatever frontmatter it came with, so nothing here is validated.';

-- ---------------------------------------------------------------------------
-- source_chunks: what gets embedded, and where it came from
-- ---------------------------------------------------------------------------

CREATE TABLE source_chunks (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id      bigint NOT NULL REFERENCES sources (id),
  ordinal        integer NOT NULL,

  -- Byte offsets into sources.body, so a citation opens at the right place.
  byte_start     integer NOT NULL,
  byte_end       integer NOT NULL,

  -- Null means unembedded. embed_attempts lets the embedder back off rather
  -- than retry a failing chunk for ever.
  embedding      vector(1024),
  embed_attempts integer NOT NULL DEFAULT 0,

  CONSTRAINT source_chunks_ordinal UNIQUE (source_id, ordinal),
  CONSTRAINT source_chunks_range CHECK (byte_end > byte_start AND byte_start >= 0)
);

-- ---------------------------------------------------------------------------
-- facts: one row per note in a space, whatever its type
-- ---------------------------------------------------------------------------

CREATE TABLE facts (
  id                bigint PRIMARY KEY,
  node_kind         node_kind NOT NULL DEFAULT 'fact' CHECK (node_kind = 'fact'),
  owner_id          bigint NOT NULL DEFAULT 1 REFERENCES users (id),

  -- Relative to the vault root. A wikilink resolves against its basename, so
  -- without this nothing can turn [[a-note]] back into a row.
  path              text NOT NULL UNIQUE,

  type              fact_type NOT NULL,
  title             text NOT NULL,

  -- No length constraint on purpose. check.py reports an over-length
  -- description and migrates the note anyway, so a constraint here would
  -- reject where the old system continues and the two reports would disagree.
  description       text NOT NULL,

  space             space NOT NULL,
  tags              text[] NOT NULL DEFAULT '{}',
  project           text[] NOT NULL DEFAULT '{}',
  status            fact_status NOT NULL,

  -- Who wrote it is not who confirmed it. Both read human:<id> or
  -- agent:<model>, and they stay separate columns for that reason.
  generated         date,
  generated_by      text,
  verified          date,
  verified_by       text,

  stale_after       date,

  -- Retirement is a date, never a delete. valid_to_inferred records that the
  -- date came from the source's own date rather than from a stated one,
  -- because the vault's never-guess rule requires saying which.
  valid_from        date NOT NULL DEFAULT CURRENT_DATE,
  valid_to          date,
  valid_to_inferred boolean NOT NULL DEFAULT false,

  embedding         vector(1024),
  embed_attempts    integer NOT NULL DEFAULT 0,

  FOREIGN KEY (id, node_kind) REFERENCES nodes (id, kind),

  -- The policy's hardest rule, enforced by the database rather than by a
  -- prompt: a machine never marks its own work verified.
  CONSTRAINT facts_machine_never_verifies
    CHECK (verified_by IS NULL OR verified_by NOT LIKE 'agent:%'),

  CONSTRAINT facts_valid_range
    CHECK (valid_to IS NULL OR valid_to >= valid_from),

  CONSTRAINT facts_inferred_needs_a_date
    CHECK (NOT valid_to_inferred OR valid_to IS NOT NULL)
);

-- ---------------------------------------------------------------------------
-- edges: typed and directional
-- ---------------------------------------------------------------------------
--
-- Named from_id and to_id so neither reads as the sources table.

CREATE TABLE edges (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_id bigint NOT NULL REFERENCES nodes (id),
  to_id   bigint NOT NULL REFERENCES nodes (id),
  kind    edge_kind NOT NULL,

  CONSTRAINT edges_unique UNIQUE (from_id, to_id, kind),
  CONSTRAINT edges_not_self CHECK (from_id <> to_id)
);

-- ---------------------------------------------------------------------------
-- entities: created now, populated by a later slice
-- ---------------------------------------------------------------------------
--
-- Every note in a space becomes a facts row whatever its type. Entity
-- resolution arrives with the slice that ingests a second source of people, so
-- entities.kind is text rather than an enum: an enum invented before there is
-- a row to put in it is a guess.

CREATE TABLE entities (
  id        bigint PRIMARY KEY,
  node_kind node_kind NOT NULL DEFAULT 'entity' CHECK (node_kind = 'entity'),
  kind      text NOT NULL,
  name      text NOT NULL,

  FOREIGN KEY (id, node_kind) REFERENCES nodes (id, kind),
  CONSTRAINT entities_unique UNIQUE (kind, name)
);

-- ---------------------------------------------------------------------------
-- tasks: an inline checkbox, attached to the note it sat on
-- ---------------------------------------------------------------------------

CREATE TABLE tasks (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id bigint NOT NULL DEFAULT 1 REFERENCES users (id),
  fact_id  bigint NOT NULL REFERENCES facts (id),

  -- The original markdown, character for character. This is what makes the
  -- round-trip test exact.
  raw_line text NOT NULL,
  text     text NOT NULL,

  -- The Tasks plugin's three signifiers. A task with no established deadline
  -- stays undated, because an invented deadline is an invented fact.
  due      date,  -- from the calendar emoji
  start    date,  -- from the aeroplane emoji, which hides it until then
  done     date   -- from the tick, stamped when it was ticked
);

-- ---------------------------------------------------------------------------
-- questions: the rows on the vault's index.md, which a person answers
-- ---------------------------------------------------------------------------

CREATE TABLE questions (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fact_id  bigint REFERENCES facts (id),
  question text NOT NULL,
  answer   text,
  asked    date NOT NULL DEFAULT CURRENT_DATE
);

COMMENT ON TABLE questions IS
  'Closed by writing the answer into the fact, not by deleting the row.';

-- ---------------------------------------------------------------------------
-- rejections: why a candidate did not become a fact
-- ---------------------------------------------------------------------------
--
-- A rejected candidate never became a fact, so it has no node of its own.
-- subject_id names the node the rejection concerned: the source it came from,
-- or the fact it contradicted. A later run reads this so it does not raise the
-- same candidate twice.

CREATE TABLE rejections (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_id bigint NOT NULL REFERENCES nodes (id),
  candidate  text NOT NULL,
  reason     text NOT NULL,
  raised     date NOT NULL DEFAULT CURRENT_DATE
);

-- ---------------------------------------------------------------------------
-- Every node of a kind with a child table must have its child row
-- ---------------------------------------------------------------------------
--
-- The composite foreign keys above stop a node being claimed by the wrong
-- table, and stop one id being claimed by two. They cannot see the other
-- direction: a nodes row of kind 'fact' with no facts row. This does, at
-- commit time, so the two inserts may run in either order inside one
-- transaction.

CREATE FUNCTION node_must_be_claimed() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind NOT IN ('fact', 'source', 'entity') THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM facts    WHERE id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM sources  WHERE id = NEW.id)
     AND NOT EXISTS (SELECT 1 FROM entities WHERE id = NEW.id)
  THEN
    RAISE EXCEPTION 'node % has kind % and no % row to match it',
      NEW.id, NEW.kind, NEW.kind
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER nodes_must_be_claimed
  AFTER INSERT OR UPDATE ON nodes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION node_must_be_claimed();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
--
-- The vector width is pinned by the model. src/embedding.ts names both, and a
-- test asserts the two agree. Changing the model is a migration.

CREATE INDEX source_chunks_embedding ON source_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX facts_embedding ON facts
  USING hnsw (embedding vector_cosine_ops);

-- Traversal walks edges in both directions.
CREATE INDEX edges_from ON edges (from_id);
CREATE INDEX edges_to   ON edges (to_id);

CREATE INDEX source_chunks_source ON source_chunks (source_id);
CREATE INDEX tasks_fact           ON tasks (fact_id);
CREATE INDEX rejections_subject   ON rejections (subject_id);

-- The staleness sweep, and retrieval filtered by space.
CREATE INDEX facts_stale_after ON facts (stale_after) WHERE valid_to IS NULL;
CREATE INDEX facts_space       ON facts (space);

-- @down

DROP TRIGGER nodes_must_be_claimed ON nodes;
DROP FUNCTION node_must_be_claimed;

-- Children before the registry, which is the reverse of the insert order.
DROP TABLE rejections;
DROP TABLE questions;
DROP TABLE tasks;
DROP TABLE edges;
DROP TABLE entities;
DROP TABLE source_chunks;
DROP TABLE facts;
DROP TABLE sources;
DROP TABLE users;
DROP TABLE nodes;

DROP TYPE edge_kind;
DROP TYPE fact_status;
DROP TYPE space;
DROP TYPE fact_type;
DROP TYPE node_kind;

-- The vector extension stays. scripts/provision-amaterasu.sh installed it, and
-- this migration did not.
