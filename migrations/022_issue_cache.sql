-- The issues a tracker owns, cached here, and the blocking links between them.
--
-- THE TABLE IS A CACHE AND NEVER A MASTER. ADR-0007 leaves the text with the
-- tracker: KPA reads an issue, stores what it read, and converts at the
-- boundary. Every row therefore carries `updated`, the tracker's own stamp. A
-- write reads that stamp first and refuses when it has moved, and the writer
-- re-reads and decides, because KPA cannot guess how two descriptions combine.
-- Drop the stamp and nothing can refuse a stale write, which is the second
-- master ADR-0007 exists to prevent.
--
-- THREE STAMPS, AND EACH ANSWERS ITS OWN QUESTION. `updated` is what the
-- tracker last changed, and it gates every write. `fetched_at` is when this
-- cache last read the issue. `seen_at` is when a listing last named the key.
-- No column carries two of these meanings, because the deletion sweep below
-- turns on the difference between the last two.
--
-- `updated` IS A MOMENT, NOT A CALENDAR DATE. `Issue.updated` in
-- `apps/web/lib/types.ts` reads as an ISO date, and the list screen shows the
-- day. A stamp at that resolution refuses no write made later the same day,
-- which is every conflict worth catching. ADR-0008 adds the other half: JQL
-- compares `updated` to the minute, so the poll already works in moments.
-- `start` and `due` are calendar dates and stay `date`.
--
-- A DELETED ISSUE NEEDS `seen_at`, BECAUSE NO POLL EVER NAMES IT. ADR-0008
-- polls on `updated >= the last run`, and a deleted issue appears in no such
-- answer. `fetched_at` finds it no better: nobody edits a quiet issue, so no
-- poll fetches it, and an old `fetched_at` says the issue is quiet rather than
-- gone. A second sweep therefore lists every key the tracker still holds,
-- which is one cheap query per workspace, and stamps each row it names:
--
--   UPDATE issues SET seen_at = now()
--    WHERE workspace = $1 AND key = ANY($2::text[]);      -- every key it holds
--   DELETE FROM issues WHERE workspace = $1 AND seen_at < $2;  -- the start
--
-- A row the listing skipped keeps the older stamp, and the DELETE removes it.
-- The sweep pages safely: a run that fails before the second statement deletes
-- nothing.
--
-- THE PARENT RULE IS A FOREIGN KEY, BECAUSE A CHECK READS ONE ROW. "An epic
-- has no parent" reads the row it sits on, so a check holds it. "A sub-task's
-- parent is a story" reads the parent, and a CHECK reaches no second row.
-- `parent_kind` is generated from `kind` and holds what the parent must be,
-- which is `PARENT_KIND` in `apps/web/lib/types.ts` written as a column. The
-- reference then names (workspace, parent, parent_kind) against
-- (workspace, key, kind), so the parent exists and is of the one kind the rule
-- allows. An epic generates NULL, which leaves the reference unchecked, and
-- `issues_an_epic_has_no_parent` refuses its parent instead.
--
-- A trigger was the other answer, and it takes two: one on the child, and a
-- second refusing a parent whose kind changes under it. The reference holds
-- both directions in one line.
--
-- WHAT THE REFERENCE COSTS. A parent must be cached before its child. A poll
-- returns issues in the tracker's own order, so the reference is deferrable
-- and one batch writes in any order inside one transaction. A child whose
-- parent the cache does not hold at all is refused outright, and the writer
-- fills the workspace before it polls for changes. The deletion sweep lists
-- every key already, so a whole workspace is what this cache holds.
--
-- THE DESCRIPTION IS STORED AS THE TRACKER SENT IT. ADR-0007 rejects markdown
-- as lossy: neither Jira API accepts it, and it drops the task lists, panels
-- and media ADF holds. Jira sends ADF, which is JSON. Linear sends markdown,
-- which `jsonb` holds as a JSON string. `Issue.description` is the plain
-- string the editor binds to, and the adapter converts between the two.
--
-- A CACHE MAY NOT REFUSE WHAT THE TRACKER ACCEPTS. Jira takes a due date
-- before its own start date, so no check compares the pair, where
-- `020_project_contract.sql` compares the contract's two dates. Each rule
-- below refuses a row KPA wrote wrong rather than a row Jira holds.
--
-- THREE ENUMS, WHERE `connections.provider` IS TEXT. That column is text
-- because the provider catalogue still grows, and `014_audit_attempt.sql`
-- records what an enum value costs once it is there. These three are the
-- interface's own vocabulary rather than the tracker's: `needs_you_kind` is
-- the precedent, and a status outside the six renders in no column on the
-- board. The enum makes the adapter's failure loud at the write.

-- The six columns the board shows.
CREATE TYPE issue_status AS ENUM
  ('backlog', 'todo', 'in-progress', 'in-review', 'done', 'cancelled');

-- Jira files more shapes than three. These are the three this assistant files,
-- and the parent rule is written in terms of them.
CREATE TYPE issue_kind AS ENUM ('epic', 'story', 'subtask');

CREATE TYPE issue_priority AS ENUM ('none', 'low', 'medium', 'high', 'urgent');

CREATE TABLE issues (
  -- The tracker the issue lives in, by `workspaces.id`. The slug, never the
  -- name: migration 018 made the name an ordinary column for this reason.
  -- Removing a workspace takes its cache, which loses nothing the tracker
  -- still holds.
  workspace   text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  -- The tracker's own key, such as 'PSAPAC-2607'. Unique inside the workspace
  -- and nowhere else, because two sites may both hold an 'MP-1'.
  key         text NOT NULL,

  title       text NOT NULL,

  -- What the tracker sent, in the tracker's own format. Null is what Jira
  -- sends for an issue nobody has described.
  description jsonb,

  status      issue_status NOT NULL,
  kind        issue_kind NOT NULL,

  -- Jira returns no priority on an issue nobody has ranked, and the interface
  -- calls that 'none'.
  priority    issue_priority NOT NULL DEFAULT 'none',

  -- Every label the issue carries. `projects.match_label` reads this to decide
  -- which project inside the workspace an issue belongs to.
  -- `connections.services` is the precedent for the array.
  labels      text[] NOT NULL DEFAULT '{}',

  -- Empty on an issue nobody has taken. `Issue.assignee` admits no null.
  assignee    text NOT NULL DEFAULT '',

  -- Calendar dates, read back as text. `src/db/connect.ts` says why.
  start       date,
  due         date,

  -- The sprint the issue sits in, by the tracker's own id. Null in the
  -- backlog. No reference, because no table holds a sprint yet.
  sprint_id   text,

  -- What the workspace's custom fields hold, keyed by `workspace_fields.id`.
  -- Migration 021 quotes the query that reads it. No constraint ties a key to
  -- a field row: a check reaches no second table, and a field the workspace
  -- drops would strand every value already filed under it.
  fields      jsonb NOT NULL DEFAULT '{}',

  -- The key of the issue this one hangs under.
  parent      text,

  -- What that parent has to be. `PARENT_KIND` in `apps/web/lib/types.ts`.
  parent_kind issue_kind GENERATED ALWAYS AS (
                CASE kind
                  WHEN 'story'   THEN 'epic'::issue_kind
                  WHEN 'subtask' THEN 'story'::issue_kind
                END) STORED,

  -- The tracker's own stamp. A write compares it and refuses when it has
  -- moved.
  updated     timestamptz NOT NULL,

  -- When this cache last read the issue.
  fetched_at  timestamptz NOT NULL DEFAULT now(),

  -- When a listing last named the key. The deletion sweep reads this.
  seen_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace, key),

  -- The parent reference points here. The pair is unique already, and the
  -- kind rides along so the reference can name it.
  UNIQUE (workspace, key, kind),

  FOREIGN KEY (workspace, parent, parent_kind)
    REFERENCES issues (workspace, key, kind)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,

  CONSTRAINT issues_an_epic_has_no_parent
    CHECK (kind <> 'epic' OR parent IS NULL),

  -- A Jira key is upper case, and `projects.match_key_prefix` compares its
  -- first characters. A key in any other shape matches no project and reports
  -- nothing, which is the one typo migration 018 calls silent.
  CONSTRAINT issues_key_is_a_jira_key CHECK (key ~ '^[A-Z][A-Z0-9]*-[0-9]+$'),

  CONSTRAINT issues_title_says_something CHECK (btrim(title) <> ''),

  -- An array or a scalar here answers null to `fields ->> 'customer'`, which
  -- reads as a field nobody filled in.
  CONSTRAINT issues_fields_is_an_object CHECK (jsonb_typeof(fields) = 'object')
);

COMMENT ON TABLE issues IS
  'A cache of the issues a tracker owns, never a master. ADR-0007: the '
  'tracker holds the truth, and `updated` is the stamp a write reads before '
  'it refuses a stale one.';

COMMENT ON COLUMN issues.updated IS
  'The tracker''s own stamp, to the moment. A write compares it and refuses '
  'when it has moved. ADR-0007.';

COMMENT ON COLUMN issues.seen_at IS
  'When a listing last named this key. ADR-0008: a deleted issue appears in '
  'no updated query, so the sweep stamps what the tracker still holds and '
  'deletes what it skipped.';

COMMENT ON CONSTRAINT issues_an_epic_has_no_parent ON issues IS
  'Half the parent rule. The other half is the reference on parent_kind, '
  'because a check reads one row and a sub-task''s parent is another.';

-- One link, stored once, from the end that blocks.
--
-- `Issue.blocks` holds the keys an issue blocks, and "blocked by" is a read of
-- the other column. Storing both directions invites the pair to disagree, and
-- no reader could then say which half was right. Jira puts the truth at the
-- inward end of its own link, which is the blocker, so that end names the row.
--
-- Both ends reference `issues`, so a link reaches two cached issues and the
-- deletion sweep takes the links with the issue it removes.
CREATE TABLE issue_blocks (
  workspace text NOT NULL,

  -- The issue that blocks.
  blocker   text NOT NULL,

  -- The issue it blocks.
  blocked   text NOT NULL,

  PRIMARY KEY (workspace, blocker, blocked),

  FOREIGN KEY (workspace, blocker) REFERENCES issues (workspace, key)
    ON DELETE CASCADE,
  FOREIGN KEY (workspace, blocked) REFERENCES issues (workspace, key)
    ON DELETE CASCADE,

  CONSTRAINT issue_blocks_nothing_blocks_itself CHECK (blocker <> blocked)
);

COMMENT ON TABLE issue_blocks IS
  'One blocking link, stored once from the blocker. Read the other column for '
  '"blocked by": two rows per link would invite the pair to disagree.';

-- @down

DROP TABLE issue_blocks;
DROP TABLE issues;
DROP TYPE issue_priority;
DROP TYPE issue_kind;
DROP TYPE issue_status;
