-- Needs you: the four kinds of item that wait on a decision from Shane.
--
-- The brief names four: a draft waiting to send, a question waiting for an
-- answer, an action the policy refused, and a deadline coming. The screen
-- reads them as one list, ordered by when each arrived, so they need one
-- shape and one table rather than four.
--
-- THE DECISION THIS MIGRATION CARRIES: questions becomes a kind of this
-- queue, and the questions table this migration drops.
--
-- Keeping questions separate would mean joining it to facts for the space
-- and the entity the screen needs on every row. That join cannot work today:
-- facts carries no entity column, and KPA-51 is the story that adds one.
-- Even once it lands, a question with no fact_id (questions.fact_id is
-- nullable) would still have nowhere to read space or entity from. A second
-- table that answers the same question as this one, only partly, is the
-- outcome the brief asks this migration to avoid rather than to build.
--
-- This table is empty today. KPA-8 created it when the vault's index.md
-- carried headers and no rows, so it migrated nothing, and KPA-5 has not run.
-- The two answered questions the brief names sit in the vault's markdown, not
-- here, and KPA-5 is the story that reads them.
--
-- The guard below still earns its place. Once rows exist this migration
-- cannot carry them forward: without facts.entity there is no entity to give
-- them, and inventing one is the guess the vault's never-guess rule forbids.
-- So it refuses rather than drop a row silently, the same guard
-- 003_fact_state.sql used for the same reason.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM questions) THEN
    RAISE EXCEPTION 'questions already holds row(s) this migration cannot map: facts '
      'carries no entity column yet, and a needs_you row requires one. Move '
      'these rows into needs_you by hand first, or run this migration before '
      'questions holds any.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

DROP TABLE questions;

-- ---------------------------------------------------------------------------
-- needs_you
-- ---------------------------------------------------------------------------
--
-- A row may point at the fact it concerns, the source it came from, or
-- neither, but never both: a fact already has its own source through
-- derived_from, so naming a source here as well would leave two answers to
-- the same question. A denied-action row also names the audit entry that
-- refused it, which is where the rule and the policy's reasoning live.
--
-- A row closes rather than disappears. closed_at is null while a row waits
-- on Shane and is set once he deals with it, so the briefing can still show
-- what was dealt with and when, the same as a fact retires instead of
-- deleting.

CREATE TYPE needs_you_kind AS ENUM ('draft', 'question', 'denied-action', 'deadline');

CREATE TABLE needs_you (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind      needs_you_kind NOT NULL,
  title     text NOT NULL,
  detail    text NOT NULL,
  space     space NOT NULL,
  entity    text NOT NULL,
  raised_at timestamptz NOT NULL DEFAULT now(),

  fact_id   bigint REFERENCES facts (id),
  source_id bigint REFERENCES sources (id),
  chunk_id  bigint REFERENCES source_chunks (id),

  -- Drafts open in Gmail. Nothing else in this table sends mail, so this is
  -- the only outbound link a row carries.
  gmail_url text,

  -- Present only on a denied-action row, so the panel can show what the
  -- policy said. audit already carries the rule that fired, so this table
  -- does not carry a second copy of it.
  audit_id  bigint REFERENCES audit (id),

  closed_at timestamptz,

  CONSTRAINT needs_you_denial_names_its_audit
    CHECK (kind <> 'denied-action' OR audit_id IS NOT NULL),
  CONSTRAINT needs_you_provenance_is_fact_xor_source
    CHECK (fact_id IS NULL OR source_id IS NULL),
  CONSTRAINT needs_you_chunk_needs_a_source
    CHECK (chunk_id IS NULL OR source_id IS NOT NULL)
);

COMMENT ON TABLE needs_you IS
  'The four kinds the briefing shows: draft, question, denied-action, '
  'deadline. A row closes by setting closed_at rather than by disappearing.';

-- The screen filters by space, the same as facts_space. The default view
-- reads the open rows newest first, so a partial index on that shape serves
-- it without a sequential scan once the table has grown.
CREATE INDEX needs_you_space ON needs_you (space);
CREATE INDEX needs_you_open  ON needs_you (raised_at DESC) WHERE closed_at IS NULL;

-- @down

DROP TABLE needs_you;
DROP TYPE needs_you_kind;

-- No guard here, for the reason 003_fact_state.sql's down gives for the same
-- shape of problem: by the time anyone reverses this, needs_you may hold
-- rows this runner did not put there, and none of them started life as a
-- questions row. Mapping them back would be a guess, so questions comes back
-- empty, exactly as 001_core_schema.sql first defined it, rather than
-- fabricated from rows that were never questions to begin with.

CREATE TABLE questions (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fact_id  bigint REFERENCES facts (id),
  question text NOT NULL,
  answer   text,
  asked    date NOT NULL DEFAULT CURRENT_DATE
);

COMMENT ON TABLE questions IS
  'Closed by writing the answer into the fact, not by deleting the row.';
