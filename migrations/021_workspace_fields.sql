-- Which custom fields a workspace carries, and the Jira field each one writes.
--
-- TWO IDENTIFIERS, AND NEITHER DERIVES THE OTHER. `id` is the slug an issue
-- files its value under. `jira_id` is what a write puts in the REST call. They
-- are separate columns because no rule turns one into the other: the Collibra
-- site calls `customfield_14849` "Customer", and nothing about the word
-- "Customer" says 14849. `fieldId()` in `apps/web/lib/workspace-fields.ts`
-- lower-cased a name into an id and nothing called it, so this migration
-- deletes it rather than leaving a second answer lying about.
--
-- ONE NAME CAN MEAN TWO FIELDS. The Collibra site offers two custom fields
-- named "Customer", `customfield_14849` and `customfield_16534`, and PSAPAC
-- issues carry the first. A name picks between them by luck, and the losing
-- pick writes to a field nobody reads. That is the failure this table ends.
-- `workspace_fields_jira_id_is_a_custom_field` refuses a slug pasted into the
-- column that has to hold the tracker's own id, which is the one typo that
-- would otherwise be silent.
--
-- REQUIRED IS A COLUMN, SO THE RULE IS A QUERY. `missingFields` filters a list
-- the browser holds, and `issue-dialog.tsx` refuses to file an issue while it
-- returns anything. The same question now reads as SQL:
--
--   SELECT id FROM workspace_fields
--    WHERE workspace = $1 AND required
--      AND coalesce(btrim($2::jsonb ->> id), '') = '';
--
-- KPA-127 moves the browser's copy to the server. Until then the client rule
-- and this column answer the same question, and the column is the one a second
-- device can read.
--
-- A FIELD FILES UNDER `workspaces.id`, NEVER UNDER THE NAME. Migration 018
-- made the id a stable slug and the name an ordinary column for this story.
-- The reference is what closes it: rename "Koinon Engineering" and every field
-- stays where it is, because no field ever named it.
--
-- `ON DELETE CASCADE`, WHERE `projects` HAS NO CLAUSE AT ALL. A project is work
-- in its own right, so removing a workspace holding one is refused. A field
-- list is a property of the workspace and means nothing without it, so it goes
-- when the workspace goes.
--
-- THE SEED IS THE FIXTURE, AND THE TWO JIRA IDS ARE REAL. `WORKSPACE_FIELDS` in
-- `apps/web/lib/fixtures.ts` gives Collibra two fields and the other two
-- workspaces none, and `018_workspaces_and_projects.sql` seeded its tree for
-- the same reason: this is configuration, it is known now, and an empty table
-- gives the interface nothing to read when it stops reading the constant. The
-- fixture carries no Jira id, so these two were read from
-- `/rest/api/3/field` on the Collibra site and confirmed against PSAPAC-2607,
-- which holds a value in both. A workspace carrying no row carries no fields,
-- which is what the other two mean.

CREATE TABLE workspace_fields (
  -- The workspace that carries the field. The id, so a rename moves nothing.
  workspace text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,

  -- The slug an issue's value is filed under, and what the settings screen
  -- picks from the site's catalogue. Stable across a rename of the field.
  id        text NOT NULL,

  -- The tracker's own id, and the only thing a write to Jira may name.
  jira_id   text NOT NULL,

  -- What the field is called. Mutable, as `workspaces.name` is.
  name      text NOT NULL,

  -- A new issue cannot be filed until this one holds something. False,
  -- because a field added on the settings screen starts optional.
  required  boolean NOT NULL DEFAULT false,

  PRIMARY KEY (workspace, id),

  -- Two slugs pointing at one Jira field would write it twice, with the
  -- second value winning and no screen showing which lost.
  UNIQUE (workspace, jira_id),

  CONSTRAINT workspace_fields_id_is_a_slug
    CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),

  -- The shape Jira gives every custom field. A slug here is the derivation
  -- this table exists to refuse.
  CONSTRAINT workspace_fields_jira_id_is_a_custom_field
    CHECK (jira_id ~ '^customfield_[0-9]+$'),

  CONSTRAINT workspace_fields_name_says_something CHECK (btrim(name) <> '')
);

COMMENT ON TABLE workspace_fields IS
  'One custom field a workspace carries. The slug an issue keys on and the '
  'tracker id a write names are two columns, and neither derives the other.';

COMMENT ON CONSTRAINT workspace_fields_jira_id_is_a_custom_field ON workspace_fields IS
  'KPA-97: the Collibra site has two fields named Customer, so a name cannot '
  'choose between them and a slug is never a tracker id.';

INSERT INTO workspace_fields (workspace, id, jira_id, name, required) VALUES
  ('collibra', 'customer',   'customfield_14849', 'Customer',   true),
  ('collibra', 'engagement', 'customfield_14850', 'Engagement', false);

-- @down

DROP TABLE workspace_fields;
