-- Chat history: a conversation, its answers in order, and what each answer
-- cited.
--
-- Two things stay derived rather than stored, so the database can never
-- disagree with the code that reads them.
--   - lib/context-window.ts counts a conversation's tokens from its answers.
--     No column here holds a total.
--   - lib/space.ts flags a crossing when an answer's citations span more
--     than one space. No column here holds that flag. citations.source_id
--     already reaches sources.space, added in 004, and that join is where a
--     reader derives the flag.
--
-- citations names both a source and a chunk, the way edges already does for
-- derived_from, and the database holds the two together. edges tolerates a
-- mismatch because it predates chunking and resolves it in code. This table
-- is new and carries no such history, so a composite key refuses one.
--
-- Answering a question is KPA-57. This migration only gives the three tables
-- somewhere real to read.

CREATE TABLE conversations (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title      text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE answers (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id bigint NOT NULL REFERENCES conversations (id),
  question        text NOT NULL,
  answer          text NOT NULL,
  asked_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE answers IS
  'Read back ordered by asked_at, never by id. An id only happens to track '
  'the order rows arrived, and nothing enforces that the two agree.';

-- A composite reference needs a key to point at. nodes (id, kind) already
-- carries this shape for the same purpose: it lets a child row prove its
-- parent rather than asking every caller to remember the rule.
ALTER TABLE source_chunks
  ADD CONSTRAINT source_chunks_id_source UNIQUE (id, source_id);

CREATE TABLE citations (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  answer_id bigint NOT NULL REFERENCES answers (id),
  source_id bigint NOT NULL REFERENCES sources (id),
  chunk_id  bigint NOT NULL,
  label     text NOT NULL,

  -- A citation opens one passage of one source. Naming a chunk from another
  -- source opens the wrong text under the right title, which reads as a
  -- correct answer and is not one. The drawer cannot tell the difference,
  -- and neither can the reader, so this refuses it here.
  CONSTRAINT citations_chunk_belongs_to_source
    FOREIGN KEY (chunk_id, source_id) REFERENCES source_chunks (id, source_id)
);

-- One index per foreign key, the same rule 001 and 005 follow. The first
-- pair also carries the column each table's owning query reads by, the way
-- audit_outcome_at does for audit: history reads a conversation's answers in
-- asked_at order, so the index serves both the join and the order in one.
CREATE INDEX answers_conversation ON answers (conversation_id, asked_at);
CREATE INDEX citations_answer     ON citations (answer_id);

-- @down

DROP TABLE citations;
DROP TABLE answers;
DROP TABLE conversations;

ALTER TABLE source_chunks DROP CONSTRAINT source_chunks_id_source;
