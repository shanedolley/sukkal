-- Gives facts the entity column the briefing groups every queue by.
--
-- ADR-0014 decides the shape: plain text, not a foreign key into `entities`.
-- `entities` holds no rows yet, and nothing in this story resolves a fact to
-- one, so a foreign key would reject every writer or sit null regardless.
--
-- Nullable for the same reason 004_source_columns.sql's new columns were:
-- `src/memory/gates.ts` already inserts facts, and so does every test file
-- that builds one, and none of them names an entity today. A NOT NULL column
-- with no default would reject all of them, and fixing writers this story
-- does not own is out of scope.

-- Every needs_you row today, if any exist, came from src/memory/sweep.ts,
-- the only writer that table has ever had, and every one of its rows carried
-- a fact's title in the entity column, the bug this story fixes. Correcting
-- one would mean guessing the real entity, which the vault's never-guess
-- rule forbids, so this refuses rather than leave a wrong value standing.
--
-- Nothing calls sweep() outside its own test, and no cron, timer, or worker
-- in this repository calls it either, so this is expected to find nothing
-- and pass. It checks rather than assumes: a table this migration cannot see
-- is not evidence, and a guard that runs is.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM needs_you) THEN
    RAISE EXCEPTION 'needs_you already holds row(s). Every one was written by '
      'the stand-in this story removes, entity holding a fact title rather '
      'than a real entity, and correcting that means guessing, which this '
      'migration will not do. Deal with these rows by hand first: close or '
      'delete the ones sweep raised, then run this migration.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

ALTER TABLE facts ADD COLUMN entity text;

-- needs_you.entity has to follow, and this is the half that would otherwise
-- ship broken. The sweep reads f.entity straight into it, so one due fact
-- naming no entity fails the whole INSERT and the run raises nothing at all.
-- That is not a row lost, it is every row lost, on a job whose reason for
-- existing is that Shane sees what is waiting.
--
-- Nothing populates either column yet: the vault's frontmatter carries no
-- entity field, and entities is filled by a later slice. So requiring one here
-- requires something the data cannot supply, and a NOT NULL column that no
-- writer can satisfy is a constraint against the product rather than for it.
-- ADR-0014 records the same reasoning for facts.entity.
ALTER TABLE needs_you ALTER COLUMN entity DROP NOT NULL;

COMMENT ON COLUMN facts.entity IS
  'The customer, engagement, or person this fact concerns. Text, not a '
  'foreign key into entities: see ADR-0014. Null until something resolves '
  'it, which is not this column''s job.';

-- @down

-- needs_you.entity stays nullable on the way back. Restoring NOT NULL over
-- rows the sweep raised without an entity fails, and the only ways to make it
-- succeed are to invent a value or to delete a review item. The vault's
-- never-guess rule forbids the first and this system deletes nothing, so the
-- constraint is the thing that gives. 003_fact_state.sql returns its own old
-- column nullable for the same reason.

ALTER TABLE facts DROP COLUMN entity;
