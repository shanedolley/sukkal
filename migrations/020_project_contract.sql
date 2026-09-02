-- The contract a project runs under, and where each of its two dates came
-- from.
--
-- `apps/web/lib/project-settings.ts` keeps the dates in localStorage and reads
-- the description from a fixture. A poller reads neither, so a date Salesforce
-- holds has nowhere to land. These columns are that place.
--
-- WHERE A DATE CAME FROM IS A COLUMN, AND EACH DATE GETS ITS OWN. Salesforce
-- holds the contract through Certinia PSA, and a sync overwrites the dates it
-- wrote before and leaves the dates Shane typed. One column covering the pair
-- cannot say that. A start Shane typed beside an end the sync read is the
-- ordinary case, and one column answers for both dates or for neither. Two
-- columns answer separately, so the sync rule is a WHERE clause rather than a
-- convention:
--
--   UPDATE projects
--      SET contract_start = $2, contract_start_source = 'salesforce'
--    WHERE id = $1 AND contract_start_source IS DISTINCT FROM 'typed';
--
-- `IS DISTINCT FROM` carries the third answer. A date nobody has set names no
-- source, and the sync fills it.
--
-- A DATE AND ITS SOURCE ARRIVE TOGETHER. Migration 016 pairs a credential's
-- `verdict` with its `verified_on` the same way. A date naming no source is a
-- date the sync cannot judge, and a source naming no date is a claim about
-- nothing. The brief asks for uncertainty recorded rather than guessed away,
-- and null on both columns is how a date nobody knows says so.
--
-- THE COLUMNS SIT ON `projects` RATHER THAN IN A TABLE OF THEIR OWN. One
-- project runs one contract, so a second table holds one row per project and
-- costs every screen a join. KPA-94 weighed the same choice and made the same
-- one.
--
-- THE LABEL IS ALREADY HERE, AND NO DEFAULT CAN FILL IT. Migration 018 landed
-- `match_label`, so the label the board reads is stored today. KPA-96 asks for
-- the browser's fallback as well: a project starts with its own key as its
-- label. PostgreSQL refuses a default that names another column, so `id`
-- cannot be one, and a constant default breaks every project matched by a key
-- prefix, because `projects_match_one_way` allows exactly one rule per row.
-- Migration 018 answers the same question a second way: it requires the rule
-- at insert, and `test/workspaces.test.ts` refuses a project carrying neither.
-- The caller therefore still supplies the label, and KPA-127 is where the
-- browser reads it from this table rather than guessing it.

-- Two ways a contract date reaches a row. Salesforce covers Certinia PSA,
-- which is a package inside it and needs no connection of its own.
CREATE TYPE contract_date_source AS ENUM ('typed', 'salesforce');

ALTER TABLE projects
  -- What the project is for. The overview renders it, and null is the answer
  -- for a project nobody has written about.
  ADD COLUMN description text,

  ADD COLUMN contract_start        date,
  ADD COLUMN contract_start_source contract_date_source,

  ADD COLUMN contract_end        date,
  ADD COLUMN contract_end_source contract_date_source,

  -- Null already says nothing is written here, so an empty string is a second
  -- way to say it and the two would drift.
  ADD CONSTRAINT projects_description_says_something
    CHECK (description IS NULL OR btrim(description) <> ''),

  ADD CONSTRAINT projects_contract_start_names_its_source
    CHECK ((contract_start IS NULL) = (contract_start_source IS NULL)),

  ADD CONSTRAINT projects_contract_end_names_its_source
    CHECK ((contract_end IS NULL) = (contract_end_source IS NULL)),

  -- A contract that ends before it starts is a typed date nobody read.
  ADD CONSTRAINT projects_contract_end_follows_start
    CHECK (contract_start IS NULL OR contract_end IS NULL
           OR contract_end >= contract_start);

COMMENT ON COLUMN projects.contract_start_source IS
  'Whether Shane typed the start or Salesforce sent it. A sync writes over '
  'salesforce and over null, and leaves typed alone.';

COMMENT ON COLUMN projects.contract_end_source IS
  'Whether Shane typed the end or Salesforce sent it. The start column says '
  'how a sync reads this.';

-- @down

ALTER TABLE projects
  DROP COLUMN description,
  DROP COLUMN contract_start,
  DROP COLUMN contract_start_source,
  DROP COLUMN contract_end,
  DROP COLUMN contract_end_source;

DROP TYPE contract_date_source;
