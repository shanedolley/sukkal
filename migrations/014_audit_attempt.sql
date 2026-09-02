-- An attempt and its outcome are two audit rows.
--
-- ADR-0015 decided this on 2 September 2026. The brief's own sequence writes
-- the intent and the state before acting, then the outcome and the reversal
-- after. One row cannot carry both halves: `outcome`, `result` and `reverse`
-- are all NOT NULL and two triggers refuse every UPDATE, so a row that starts
-- cannot finish.
--
-- WHAT IT BUYS. The agent decides, calls Gmail, then writes the outcome. A
-- process that dies after the call is issued leaves the label applied and the
-- log silent, which is the exact silence the log exists to prevent. Two rows
-- leave an attempt with no outcome, and that row says the right thing:
-- something was tried and nobody knows how it ended.
--
-- WHAT IT LEAVES ALONE. `result` and `reverse` stay NOT NULL. An attempt row
-- says what it meant to do and how it would be reversed, and both are known
-- before acting. The three append-only triggers stand unchanged. Two rows is
-- what preserving them costs, and preserving them is the point.

-- A third value on the verdict column. `allowed` and `denied` are judgements;
-- `attempted` is a promise to act, made before the answer exists.
ALTER TYPE audit_outcome ADD VALUE 'attempted';

-- The outcome row names the attempt row it closes, by that row's id. A
-- foreign key into this same table proves the pairing reaches a real entry,
-- which a generated pairing id could not.
--
-- It is null on the attempt row itself, and null on a denial. A denial is
-- whole on its own: the effect never ran, so nothing follows it.
ALTER TABLE audit ADD COLUMN attempt bigint REFERENCES audit (id);

-- READ THE CAST BEFORE YOU REMOVE IT. `outcome <> 'attempted'` is the same
-- test and PostgreSQL refuses it here: a value added by ALTER TYPE cannot be
-- used until the transaction that added it commits, and the runner applies
-- this whole file in one transaction. Comparing the text output asks nothing
-- of the new value, so it passes.
ALTER TABLE audit ADD CONSTRAINT audit_only_an_outcome_names_an_attempt
  CHECK (attempt IS NULL OR outcome::text <> 'attempted');

-- Both reads that pair the rows ask the same question: which row closes this
-- attempt. The partial index answers it and indexes neither the denials nor
-- the attempt rows, which carry no value here.
CREATE INDEX audit_attempt ON audit (attempt) WHERE attempt IS NOT NULL;

-- The four fields the brief requires say nothing when they are empty, and
-- NOT NULL lets an empty string through. An attempt row is the reason this
-- arrives now: its `result` is boilerplate written before the answer exists,
-- which is exactly the field somebody leaves blank under pressure. The table
-- refuses it rather than trusting `src/policy/act.ts` to be the only writer.
ALTER TABLE audit ADD CONSTRAINT audit_every_field_says_something
  CHECK (btrim(intent) <> '' AND btrim(before) <> ''
     AND btrim(result) <> '' AND btrim(reverse) <> '');

COMMENT ON COLUMN audit.attempt IS
  'The attempt row this row closes. Null on an attempt row and on a denial. '
  'ADR-0015: an attempt and its outcome are two rows, never one updated row.';

-- @down

-- Dropping the column takes `audit_only_an_outcome_names_an_attempt`, the
-- foreign key and the index with it, because each one names the column.
-- Naming them again would only add three statements that can fail on their
-- own. `audit_every_field_says_something` names none of them, so it goes
-- first and by hand.
ALTER TABLE audit DROP CONSTRAINT audit_every_field_says_something;
ALTER TABLE audit DROP COLUMN attempt;

-- THE ENUM VALUE STAYS, because PostgreSQL removes no value from an enum. It
-- leaves a database whose `audit_outcome` accepts a word no column pairs any
-- more, and rows that already carry it keep it.
--
-- Nothing has to clean that up. This runner reverses every migration or none,
-- and `005_policy_and_audit.sql` drops `audit` and then the type itself, so
-- the value goes with the type a few statements later. Running up again
-- creates the type from 005 with two values and adds the third here.
--
-- Rebuilding the type here instead would mean a new type, a rewrite of the
-- column and a rename, and it would fail on the one database that matters:
-- the one holding an attempt row, whose value has nowhere to go. That is the
-- shape `012_deny_by_default_rule.sql` warns about, where a down block that
-- raises stops `migrate down` before it reaches the migration that succeeds.
