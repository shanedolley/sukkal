-- The sprints a tracker runs, and the reference the issue cache was waiting on.
--
-- Migration 022 cached an issue's `sprint_id` and said "no reference, because
-- no table holds a sprint yet". This is that table, and the reference lands
-- with it.
--
-- THE TABLE IS A CACHE, LIKE `issues`, AND NEVER A MASTER. ADR-0007 leaves the
-- tracker owning its own data, so `state` is the word Jira uses rather than
-- something derived here. A sprint closed early keeps a future end date, and a
-- sprint nobody has started keeps a past start date. Deriving the state from
-- the dates would overrule the tracker on its own sprint, which is the second
-- master ADR-0007 exists to prevent.
--
-- A SPRINT IS UNIQUE INSIDE ITS WORKSPACE AND NOWHERE ELSE, which is the rule
-- `issues` already keeps for a key. Two Jira sites both number a sprint 41,
-- and the fixture has all three workspaces naming `sprint-41` for that reason.
--
-- ONE ACTIVE SPRINT PER WORKSPACE, held by a partial unique index rather than
-- by whoever writes the rows. Jira runs one sprint at a time on a board, and
-- `CURRENT_SPRINT` in `apps/web/lib/fixtures.ts` found the active one in an
-- array. KPA-99 asks that the same read be a query, and a query returning two
-- rows has no answer to give the screen.

CREATE TYPE sprint_state AS ENUM ('active', 'future', 'closed');

CREATE TABLE sprints (
  -- The tracker the sprint belongs to, by `workspaces.id`. Removing a
  -- workspace takes its sprints, which loses nothing the tracker still holds.
  workspace  text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  -- The tracker's own id, such as 'sprint-41'. This is what `issues.sprint_id`
  -- carries, and it is the tracker's value rather than one invented here.
  tracker_id text NOT NULL,

  name       text NOT NULL,

  -- Calendar dates, read back as text. `src/db/connect.ts` says why: parsing
  -- one into a Date puts it at local midnight and reads back a day west.
  -- `end` is a reserved word, so both carry the suffix `connection_credentials`
  -- already uses.
  starts_on  date NOT NULL,
  ends_on    date NOT NULL,

  state      sprint_state NOT NULL,

  PRIMARY KEY (workspace, tracker_id),

  CONSTRAINT sprints_name_says_something CHECK (btrim(name) <> ''),

  -- A sprint that ends before it starts is a date somebody typed backwards.
  -- The same day is allowed: a one-day sprint is a real thing, and refusing it
  -- would refuse a tracker's own row.
  CONSTRAINT sprints_ends_after_it_starts CHECK (ends_on >= starts_on)
);

-- The rule, rather than a hope. A partial index is what makes "at most one" a
-- fact the database keeps: `state = 'active'` picks the rows it covers, and
-- every other state may repeat as often as the tracker likes.
CREATE UNIQUE INDEX sprints_one_active_per_workspace
  ON sprints (workspace) WHERE state = 'active';

COMMENT ON TABLE sprints IS
  'The sprints a tracker runs, cached. One active sprint per workspace, held '
  'by a partial unique index. The state is the tracker''s own word.';

COMMENT ON COLUMN sprints.state IS
  'What the tracker calls it. Not derived from the dates: a sprint closes '
  'early and starts late, and the tracker owns its own sprint.';

-- ---------------------------------------------------------------------------
-- The reference migration 022 left for this story
-- ---------------------------------------------------------------------------
--
-- NULL IS THE BACKLOG, and the default MATCH SIMPLE is what keeps it so. A
-- composite reference with any column null is satisfied without a lookup, and
-- `workspace` is NOT NULL while `sprint_id` is not, so an issue in no sprint
-- is checked against nothing. That is the behaviour this wants, stated by the
-- absence of MATCH FULL rather than by a second constraint.
--
-- DEFERRABLE, for the reason the parent reference in 022 already is. A poll
-- returns issues and sprints in the tracker's own order, so one transaction
-- writes both in any order and the check runs at COMMIT. Without it, whichever
-- came second would decide whether the batch was refused.
--
-- ON DELETE SET NULL NAMES ITS COLUMN, so a sprint that leaves the tracker
-- returns its issues to the backlog rather than taking them with it. A bare
-- SET NULL would try `workspace` as well, and that column is NOT NULL.

ALTER TABLE issues
  ADD CONSTRAINT issues_sprint_is_one_its_workspace_runs
  FOREIGN KEY (workspace, sprint_id) REFERENCES sprints (workspace, tracker_id)
  ON DELETE SET NULL (sprint_id)
  DEFERRABLE INITIALLY DEFERRED;

COMMENT ON COLUMN issues.sprint_id IS
  'The sprint the issue sits in, by the tracker''s own id. Null is the '
  'backlog. Migration 027 added the reference into `sprints`.';

-- @down

ALTER TABLE issues DROP CONSTRAINT issues_sprint_is_one_its_workspace_runs;

COMMENT ON COLUMN issues.sprint_id IS NULL;

DROP TABLE sprints;

DROP TYPE sprint_state;
