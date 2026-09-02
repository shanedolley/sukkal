-- The workspace and project tree, and the rows the sidebar's plus button adds.
--
-- `apps/web/lib/workspaces.ts` is a hand-written constant, and the plus button
-- writes to React state that the next page load throws away. Its own comment
-- says so. These two tables are where the tree outlives the page.
--
-- THE IDENTIFIER IS THE SLUG, AND THE NAME IS A COLUMN BESIDE IT. This settles
-- the second question KPA-53 left open: whether the workspace key stays a name.
-- It does not. The interface files a custom field under the workspace name
-- today, so renaming 'Koinon Engineering' orphans every field filed under it.
-- The name is therefore an ordinary column, and `id` holds the slug the sidebar
-- already reaches the row at. Nothing may key off the name again, and KPA-97
-- files a custom field under `workspaces.id`.
--
-- WHY A TEXT KEY AND NOT A NUMBER. `policies.key` is the precedent, and
-- `audit.rule` cites a policy by it. The slug is already in the route, in
-- `isWorkspace`, and in `projectNamed`, so making it the primary key leaves one
-- identifier where a surrogate `bigint` would leave two to keep in step. What
-- it costs is a rule this file cannot enforce: the slug is derived from the
-- name once, when the row is created, and never again. `slug()` in
-- `nav-projects.tsx` derives it. Deriving it a second time on a rename is the
-- orphaning this decision exists to refuse.
--
-- A PROJECT MATCHES ONE WAY, NEVER NEITHER AND NEVER BOTH. Collibra runs every
-- engagement through one Jira project, so a label says which engagement an
-- issue belongs to. Koinon Engineering gives each project a Jira project of its
-- own, so the key prefix says it instead. `ProjectMatch` in
-- `apps/web/lib/workspaces.ts` is a union of the two, so a row carrying neither
-- is a project that matches every issue or none, and a row carrying both is a
-- row no screen can read. `num_nonnulls` refuses each.
--
-- NO WORKSPACE SITS IN `shared`. The `space` enum has held four values since
-- migration 001, and the interface now knows all four: ADR-0018 gave `shared`
-- to `Space` and to `SPACE_LABELS` on 2 September 2026. It still names no world
-- a Jira tracker belongs to. `shared` is the space the wall does not divide, so
-- a workspace filed there would show its issues on both sides of the one wall
-- the brief asks for. The check refuses it, and the other three stay as they
-- are.
--
-- THE SEED IS THE TREE THE CONSTANT HOLDS. `005_policy_and_audit.sql` seeds the
-- four policy rules for the same reason: this is configuration, it is known
-- now, and an empty table gives the interface nothing to read when it stops
-- reading the constant. `test/workspaces.test.ts` compares the rows against
-- `WORKSPACES` field by field, so the two cannot drift apart in silence.

CREATE TABLE workspaces (
  -- The slug the sidebar reaches the row at, and the value every project
  -- names. `/projects/koinon-engineering` is this column.
  id    text PRIMARY KEY,

  -- What the workspace is called, and what an issue carries in its `workspace`
  -- field. Unique because that field is a lookup: two workspaces under one
  -- name leave `spaceOf` no answer. Mutable, which is the whole point.
  name  text NOT NULL UNIQUE,

  -- Whose world this belongs to. A row the plus button adds names no space,
  -- and personal grants the least, so the default matches the answer `spaceOf`
  -- already gives for a workspace nobody has heard of.
  space space NOT NULL DEFAULT 'personal',

  -- What `slug()` writes: lower case, digits, and single hyphens between them.
  -- The id is the route, so a space or a slash in it breaks the address. This
  -- refuses an empty id as well.
  CONSTRAINT workspaces_id_is_a_slug CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- NOT NULL admits an empty string, and an unnamed workspace names nothing.
  CONSTRAINT workspaces_name_says_something CHECK (btrim(name) <> ''),

  CONSTRAINT workspaces_none_is_shared CHECK (space <> 'shared')
);

COMMENT ON TABLE workspaces IS
  'One Jira tracker and the space it belongs to. The id is stable, the name '
  'is not, and nothing files anything under the name.';

COMMENT ON CONSTRAINT workspaces_none_is_shared ON workspaces IS
  'ADR-0018: shared is the space the wall does not divide, and no tracker '
  'belongs to it.';

CREATE TABLE projects (
  -- The slug, as `workspaces.id` is. Unique across every workspace rather than
  -- within one: `/projects/mp` carries no workspace in the path, and
  -- `projectNamed` searches all of them.
  id               text PRIMARY KEY,

  -- The workspace that holds it. No `ON DELETE` clause, so removing a
  -- workspace that still holds projects is refused rather than taking them
  -- with it.
  workspace        text NOT NULL REFERENCES workspaces (id),

  name             text NOT NULL,

  -- One tracker, many engagements. An issue carrying this label belongs to the
  -- project. Null when the key prefix decides instead.
  match_label      text,

  -- A tracker each. Every issue key in the project starts with this and a
  -- hyphen, which is what `inProject` compares. Null when the label decides.
  match_key_prefix text,

  CONSTRAINT projects_id_is_a_slug CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  CONSTRAINT projects_name_says_something CHECK (btrim(name) <> ''),

  -- The union in `apps/web/lib/workspaces.ts`, written as a constraint.
  CONSTRAINT projects_match_one_way
    CHECK (num_nonnulls(match_label, match_key_prefix) = 1),

  -- An empty label matches every issue, and an empty prefix matches none.
  CONSTRAINT projects_match_says_something
    CHECK ((match_label IS NULL OR btrim(match_label) <> '')
       AND (match_key_prefix IS NULL OR btrim(match_key_prefix) <> '')),

  -- A Jira key is upper case, so a lower case prefix matches no issue and
  -- reports nothing. This is the one match rule a typo makes silent.
  CONSTRAINT projects_key_prefix_is_upper
    CHECK (match_key_prefix IS NULL OR match_key_prefix = upper(match_key_prefix))
);

COMMENT ON TABLE projects IS
  'One piece of work inside a workspace, and the one rule that matches its '
  'issues.';

INSERT INTO workspaces (id, name, space) VALUES
  ('collibra',           'Collibra',           'collibra'),
  ('koinon-engineering', 'Koinon Engineering', 'koinon'),
  ('personal',           'Personal',           'personal');

INSERT INTO projects (id, workspace, name, match_label, match_key_prefix) VALUES
  ('bhp-meridian',      'collibra',           'BHP Meridian',               'bhp-meridian',      NULL),
  ('sydney-water',      'collibra',           'Sydney Water',               'sydney-water',      NULL),
  ('transport-for-nsw', 'collibra',           'Transport for NSW',          'transport-for-nsw', NULL),
  ('mp',                'koinon-engineering', 'MP · Marinucci Engineering', NULL,                'MP'),
  ('ms',                'koinon-engineering', 'MS · Marinucci Support',     NULL,                'MS'),
  ('kpa',               'koinon-engineering', 'KPA · Personal Assistant',   NULL,                'KPA');

-- @down

DROP TABLE projects;
DROP TABLE workspaces;
