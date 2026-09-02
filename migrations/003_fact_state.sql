-- Replaces fact_status with fact_state.
--
-- ADR-0010 settled the fact-state vocabulary on 1 September 2026: the
-- interface shows six states, and the database stores three of them.
-- draft/stable/deprecated described how finished a vault note was, which
-- answers a different question from the one the review queue asks, and has
-- no word for a fact waiting on Shane. src/memory/state.ts builds the other
-- three -- verified, stale, retired -- from columns facts already carries, so
-- this migration adds no column for any of them.
--
-- facts holds no rows yet, because nothing has migrated. KPA-5 is the story
-- that starts writing them, against this vocabulary rather than the old one,
-- which is why this migration runs first. A facts table already holding rows
-- would lose whatever status they carried, so this refuses rather than guess
-- a mapping.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM facts) THEN
    RAISE EXCEPTION 'facts already holds rows. This migration drops '
      'fact_status with no mapping to fact_state, which loses what those '
      'rows carried. KPA-5 writes the vault parser against fact_state -- run '
      'this migration before that story lands, not after.';
  END IF;
END $$;

CREATE TYPE fact_state AS ENUM ('candidate', 'proposed', 'rejected');

ALTER TABLE facts ADD COLUMN state fact_state NOT NULL;

ALTER TABLE facts DROP COLUMN status;
DROP TYPE fact_status;

-- @down

-- No guard here: by the time anyone reverses this, facts may hold rows this
-- runner did not put there, written against fact_state. Mapping them back to
-- draft/stable/deprecated would be a guess, which the vault's own rule
-- forbids, so status comes back nullable rather than fabricated.

CREATE TYPE fact_status AS ENUM ('draft', 'stable', 'deprecated');

ALTER TABLE facts ADD COLUMN status fact_status;

ALTER TABLE facts DROP COLUMN state;
DROP TYPE fact_state;
