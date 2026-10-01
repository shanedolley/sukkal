-- A fifth kind: a credential expiring, lapsed, or failing the recheck.
-- KPA-108.
--
-- THE FIFTH KIND, NOT A DEADLINE. Criterion 2 names three triggers -- an
-- expiry inside a configured window, a lapsed credential, and a job that
-- failed with an authentication error -- and only the first carries a date.
-- A `deadline` row for the other two would carry a null `raised_for`, and
-- `needs_you_raised_for_is_a_deadline` would still accept that, but nothing
-- would then tell two open lapses on the same connection apart from one, so
-- deduplication would break for exactly the triggers that need it most.
-- `deadline` also already means one thing, a fact going stale. Ruled by
-- Shane, 1 October 2026.
--
-- NO PER-CONNECTION DATE COLUMN EITHER. `raised_for` dedupes a `deadline` row
-- by the staleness it was raised for, because a fact can go stale again
-- after a row closes. A credential's three triggers dedupe a different way:
-- by the connection and by being open, never by a date.
-- `src/connections/needs-you.ts` is where that rule lives and why.

ALTER TYPE needs_you_kind ADD VALUE 'credential';

-- Which connection a credential row concerns. Null on every other kind.
--
-- ON DELETE CASCADE, unlike fact_id, source_id and audit_id above, which name
-- none. A fact or a source is never deleted, only retired, so a row pointing
-- at one is never left dangling. A connection IS deleted, by
-- removeConnection() in src/connections/store.ts, and once it is gone there
-- is nothing left to renew: an item nagging about a credential that no longer
-- exists is clutter, not history worth keeping. So removing a connection
-- removes its credential items with it, open or closed, rather than the
-- delete failing on this foreign key or the item outliving what it was about.
ALTER TABLE needs_you ADD COLUMN connection_id bigint REFERENCES connections (id) ON DELETE CASCADE;

-- READ THE CAST BEFORE YOU REMOVE IT. `kind::text`, not `kind`: a value added
-- by ALTER TYPE cannot be compared as the enum itself until this transaction
-- commits, and the runner applies this whole file in one transaction. Casting
-- to text asks nothing of the new value, so it passes. 014_audit_attempt.sql
-- made the same cast for the same reason.
ALTER TABLE needs_you ADD CONSTRAINT needs_you_credential_names_its_connection
  CHECK (kind::text <> 'credential' OR connection_id IS NOT NULL);

COMMENT ON COLUMN needs_you.connection_id IS
  'The connection a credential row concerns. Null on every other kind. '
  'ON DELETE CASCADE: once the connection is gone there is nothing left '
  'to renew.';

-- @down

-- The enum value stays, for the reason 014_audit_attempt.sql's down gives for
-- the same shape of problem: PostgreSQL removes no value from an enum, and
-- 006_needs_you.sql is what drops needs_you_kind entirely further back,
-- taking this value with it.
ALTER TABLE needs_you DROP CONSTRAINT needs_you_credential_names_its_connection;
ALTER TABLE needs_you DROP COLUMN connection_id;
