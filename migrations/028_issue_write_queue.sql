-- A write the tracker has not accepted yet.
--
-- ADR-0007 asks for this in as many words: Postgres gains no issues table
-- anything treats as true, but a cache carrying the tracker's own stamp and a
-- queue for writes the tracker has not yet accepted. Migration 022 built the
-- cache. This is the queue.
--
-- WHY A QUEUE AT ALL. Every field on the issue detail page lands as it is made,
-- with no save button, and the bulk bar writes many rows at once. A dropped
-- connection with no queue loses the edit in silence, and the screen then shows
-- a value Jira never received. The row is what survives that.
--
-- A CONFLICT KEEPS BOTH STAMPS. ADR-0007 leaves the merge to a person, because
-- KPA cannot guess how two descriptions combine, and a person deciding needs
-- to see what the write expected and what the tracker actually had. One number
-- says a write was refused; two say why.
--
-- A SUCCESSFUL WRITE MOVES TO `sent` RATHER THAN BEING DELETED. The row is the
-- record that KPA changed somebody else's issue, and a queue that empties
-- itself on success can only ever show failures. Old rows are prunable, which
-- is where this differs from `audit`.
--
-- COMMENTS DO NOT COME THROUGH HERE. ADR-0007 writes them straight through
-- because they are append-only in practice: nothing about a comment can
-- conflict, so nothing about it needs a stamp. The check below refuses a patch
-- naming one rather than leaving that to whoever writes the next caller.
--
-- ONE ISSUE MAY HOLD SEVERAL QUEUED WRITES, in the order they were made, which
-- is what the identity key gives. A unique row per issue would drop the second
-- edit of the same field.
--
--   A TRAP THE WRITER OWNS, AND IT IS NOT SOLVED HERE. Three edits made from
--   one screen all carry the stamp that screen read. The first succeeds and
--   the tracker's stamp moves, so the other two now expect a stamp that has
--   passed and both conflict, against a change KPA itself made. Whatever sends
--   these has to carry the new stamp forward to the rest of the issue's queued
--   rows. The schema cannot: it would have to know which writes were the same
--   person's, and a `conflict` row is exactly the case where guessing is the
--   thing ADR-0007 refuses.

CREATE TYPE issue_write_state AS ENUM ('queued', 'sent', 'conflict', 'failed');

CREATE TABLE issue_writes (
  -- The order writes were made in, which is the order they must be applied in.
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- The issue this changes. Removing it from the cache takes its queued
  -- writes, which is right: an issue the tracker no longer holds cannot be
  -- written to.
  workspace         text NOT NULL,
  key               text NOT NULL,

  -- The fields to change, keyed as `issues` names them. An object rather than
  -- a whole issue, so two edits to different fields do not overwrite each
  -- other on the way out.
  patch             jsonb NOT NULL,

  -- The tracker's stamp when the write was made. The sender compares this
  -- before it writes and refuses when it has moved.
  expected_updated  timestamptz NOT NULL,

  -- What the tracker actually had, on a conflict, and null every other time.
  observed_updated  timestamptz,

  state             issue_write_state NOT NULL DEFAULT 'queued',

  -- How many times sending has been tried. A retry raises it, so a row that
  -- keeps failing is visible as a number rather than as a guess.
  attempts          integer NOT NULL DEFAULT 0,

  -- What went wrong last. It stays on a row that goes back to `queued`, so a
  -- retry that eventually works still says what it survived.
  last_error        text,

  queued_at         timestamptz NOT NULL DEFAULT now(),

  -- When it stopped being queued, whichever way it went.
  settled_at        timestamptz,

  FOREIGN KEY (workspace, key) REFERENCES issues (workspace, key)
    ON DELETE CASCADE,

  -- A person deciding a conflict needs both numbers. This is the criterion
  -- KPA-100 states, held as a rule rather than as a habit.
  CONSTRAINT issue_writes_a_conflict_names_both_stamps
    CHECK (state <> 'conflict' OR observed_updated IS NOT NULL),

  -- Every other state observed nothing, so a stamp there is a leftover from a
  -- conflict somebody re-queued without clearing it.
  CONSTRAINT issue_writes_only_a_conflict_observed_a_stamp
    CHECK (state = 'conflict' OR observed_updated IS NULL),

  -- A queued row has not settled, and a settled one names when. The pair moves
  -- together or the state is a claim nothing backs.
  CONSTRAINT issue_writes_a_settled_row_names_when
    CHECK ((state = 'queued') = (settled_at IS NULL)),

  CONSTRAINT issue_writes_attempts_is_a_count CHECK (attempts >= 0),

  -- An array or a scalar answers null to `patch ->> 'title'`, which reads as a
  -- field nobody set. `issues_fields_is_an_object` refuses the same shape.
  CONSTRAINT issue_writes_patch_is_an_object
    CHECK (jsonb_typeof(patch) = 'object'),

  -- A write that changes nothing is a round trip to the tracker for no reason,
  -- and a row nobody can read the intent of.
  CONSTRAINT issue_writes_patch_changes_something
    CHECK (patch <> '{}'::jsonb),

  -- ADR-0007: a comment goes straight through, because nothing about one can
  -- conflict. A patch carrying one would queue a write that needs no stamp
  -- behind writes that do.
  CONSTRAINT issue_writes_carry_no_comment
    CHECK (NOT (patch ? 'comment'))
);

-- What the sender reads: the oldest thing still waiting. Partial, because the
-- rows it skips are the ones that accumulate.
CREATE INDEX issue_writes_waiting
  ON issue_writes (queued_at) WHERE state = 'queued';

-- What the screen reads: everything outstanding on one issue, newest first.
CREATE INDEX issue_writes_by_issue ON issue_writes (workspace, key, id DESC);

COMMENT ON TABLE issue_writes IS
  'A write the tracker has not accepted yet. ADR-0007 asks for it: the cache '
  'carries the tracker''s stamp, and this carries what KPA wants to change.';

COMMENT ON COLUMN issue_writes.expected_updated IS
  'The tracker''s stamp when the write was made. The sender compares it and '
  'refuses when it has moved, because KPA cannot guess how two edits combine.';

COMMENT ON COLUMN issue_writes.observed_updated IS
  'What the tracker had instead, on a conflict. A person deciding needs both '
  'numbers, so one without the other is refused.';

-- @down

DROP TABLE issue_writes;

DROP TYPE issue_write_state;
