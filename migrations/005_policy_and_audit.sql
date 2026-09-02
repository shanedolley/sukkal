-- The policy table and the audit log: the two stores the brief calls load
-- bearing and the safety net.
--
-- Nothing approves an action before it runs, so these two tables carry the
-- whole weight. policies holds the rules a later engine (KPA-56) will
-- consult. audit holds one row per attempt that engine makes, allowed or
-- denied alike, and it is append only: a mistake has to stay on the record
-- for the log to catch it.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE audit_outcome AS ENUM ('allowed', 'denied');

-- ---------------------------------------------------------------------------
-- policies: the rules an autonomous agent acts inside
-- ---------------------------------------------------------------------------
--
-- The brief names four rules and marks two of them absolute. `absolute`
-- records that distinction so a later engine can refuse to let Shane turn one
-- off, rather than trusting every caller to know which two matter most.

CREATE TABLE policies (
  key      text PRIMARY KEY,
  governs  text NOT NULL,
  effect   text NOT NULL,
  absolute boolean NOT NULL DEFAULT false,
  enabled  boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE policies IS
  'The rules a later policy engine consults before every outbound action. '
  'ADR-0005: a table the worker checks, not a paragraph in a prompt.';

INSERT INTO policies (key, governs, effect, absolute) VALUES
  ('mail.send.never-unprompted', 'Sending mail',
   'Deny. A message leaves the box only after Shane clicks send.', true),
  ('never-delete-or-destructively-edit', 'Deleting mail, deleting facts, overwriting history',
   'Deny. Retire and supersede instead, so anything wrong stays recoverable.', true),
  ('fact.verify.never-by-agent', 'Marking a fact verified',
   'Deny. Only Shane confirms a fact; a machine never marks its own work verified.', false),
  ('space.collibra-koinon-separation', 'Answers drawing on both Collibra and Koinon material',
   'Allow, flagged. Retrieval filters by space by default; nothing here blocks a crossing.', false);

-- ---------------------------------------------------------------------------
-- audit: one row per attempt, allowed or denied alike
-- ---------------------------------------------------------------------------
--
-- The four fields the brief requires on every entry: intent, before, result
-- and reverse. `rule` names the policy that denied an attempt by its key,
-- rather than by a copy of its prose, so a rule's wording can change without
-- rewriting every entry that ever cited it.

CREATE TABLE audit (
  id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  action  text NOT NULL,
  intent  text NOT NULL,
  before  text NOT NULL,
  outcome audit_outcome NOT NULL,
  result  text NOT NULL,
  reverse text NOT NULL,
  space   space NOT NULL,
  rule    text REFERENCES policies (key),

  -- A denial with no named rule tells Shane nothing about what stopped it.
  -- An allowed entry needs no rule, so this checks one direction only.
  CONSTRAINT audit_denial_names_a_rule CHECK (outcome <> 'denied' OR rule IS NOT NULL)
);

COMMENT ON TABLE audit IS
  'The safety net. Without an approval step in front, this is what catches a '
  'mistake after the fact, so nothing here is ever updated or deleted.';

-- ---------------------------------------------------------------------------
-- Append only: nothing updates an entry and nothing deletes one
-- ---------------------------------------------------------------------------
--
-- A convention is a rule someone forgets under pressure. This is the
-- guarantee the table exists for, so it is enforced the same way
-- nodes_must_be_claimed is: a trigger that raises, not a comment that hopes.

CREATE FUNCTION audit_is_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit is append only: % is not allowed on row %', TG_OP, OLD.id
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER audit_append_only
  BEFORE UPDATE OR DELETE ON audit
  FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();

-- TRUNCATE deletes every row and fires no row-level trigger, so the guard
-- above never sees it. One statement would empty the whole log and leave
-- nothing behind to say it happened, which is the exact failure this table
-- exists to survive. It needs its own trigger and its own function, because a
-- statement-level trigger has no OLD row to name.
CREATE FUNCTION audit_is_never_truncated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit is append only: TRUNCATE would erase the whole log'
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER audit_never_truncated
  BEFORE TRUNCATE ON audit
  FOR EACH STATEMENT EXECUTE FUNCTION audit_is_never_truncated();

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The screen filters by outcome and always reads newest first. One composite
-- index serves both, so neither a filtered read nor the plain feed falls back
-- to a sequential scan as the table grows.
CREATE INDEX audit_outcome_at ON audit (outcome, at DESC);

-- @down

DROP TRIGGER audit_never_truncated ON audit;
DROP FUNCTION audit_is_never_truncated;

DROP TRIGGER audit_append_only ON audit;
DROP FUNCTION audit_is_append_only;

DROP TABLE audit;
DROP TABLE policies;

DROP TYPE audit_outcome;
