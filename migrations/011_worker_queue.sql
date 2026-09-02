-- The schema pg-boss keeps its queue in.
--
-- The queue lives in the same database as the facts, which is the whole
-- reason pg-boss was chosen: no Redis, no second store, and no second process
-- competing for the 5 GB amaterasu has left. It lives in its own schema so
-- the two never mix. Nothing in `public` is the queue's, and nothing in
-- `pgboss` is this repository's to read.
--
-- pg-boss can create this schema itself. The worker tells it not to, with
-- `createSchema: false`, so the schema has one owner and one lifecycle. Two
-- reasons.
--
-- It makes `npm run migrate down` honest. Without this file the queue's
-- tables outlive a full reversal, and the next `up` runs against a database
-- that still holds them.
--
-- It fails closed. A worker started against a database nobody migrated stops
-- with a missing schema rather than quietly installing one, which is the same
-- answer the migration runner gives when it finds a database it did not
-- create.
--
-- pg-boss still owns every table inside. It creates them on `start()` and
-- migrates them between its own versions, which is work this runner has no
-- business repeating.

CREATE SCHEMA pgboss;

COMMENT ON SCHEMA pgboss IS
  'pg-boss keeps its queue here. It owns every table inside; this migration '
  'owns only the schema. ADR-0016 and the brief''s job queue decision.';

-- @down

-- CASCADE, because pg-boss put its own tables in here and this is the only
-- statement that knows they exist. Reversing a migration empties the
-- database, so a queued job is lost the same way a fact is: deliberately, and
-- only on the way to an empty database.
DROP SCHEMA pgboss CASCADE;
