-- The account the installation signs in with.
--
-- ADR-0009 makes every installation authenticate rather than assume the
-- network already did. Shane's box sits behind Cloudflare Access. A box
-- somebody else runs sits behind nothing, and the one account on it reaches
-- three mailboxes. The account lives in a browser today, under `kpa.account`
-- in localStorage, so clearing a browser makes the box forget who owns it.
-- This migration is where it stops living there.
--
-- AN ALTER, NOT A SECOND TABLE. `users` already holds the row every `owner_id`
-- points at. An `accounts` table beside it would give one person two masters,
-- so the four columns join the row that exists.
--
-- THE WIZARD ASKS AGAIN, AND ADR-0022 SAYS WHY. `kpa.account` holds a name, an
-- email, an assistant name and a created date. It holds no password and never
-- did, and `apps/web/lib/account.ts:11` states that as a rule rather than as an
-- omission. An account carried across from the browser would therefore arrive
-- without the one field that signs anybody in, so the first boot asks for all
-- four again. That follows from ADR-0009 rather than from a preference.
--
-- THE SEEDED ROW IS THE ACCOUNT, UNCLAIMED. `001_core_schema.sql` seeds
-- `(1, 'shane')`, and four tables default `owner_id` to it. Deleting that row
-- or replacing it would refuse every insert made before somebody runs the
-- wizard, so it keeps its id and gains four null columns instead. `email IS
-- NULL` is therefore the question "has this installation been set up", and the
-- whole-account constraint below is what stops the answer ever being "half".
--
-- WHAT IT REFUSES. This migration cannot give an email to a row it did not
-- create, and inventing one is the guess the vault's own rule forbids. So the
-- guard stops rather than leave an owner nobody can sign in as. It reads
-- `id <> 1` because `id` is the primary key: a second row and a row that is
-- not the seed are one condition.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id <> 1) THEN
    RAISE EXCEPTION 'users holds a row 001_core_schema.sql did not seed. This '
      'migration adds an email, cannot invent one, and a null email leaves an '
      'owner nobody can sign in as. Give that row an account by hand first, or '
      'remove it, then run this migration again.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

ALTER TABLE users
  -- The address somebody signs in with. Null until the wizard runs, because
  -- the row it belongs to already exists and carries no address to give it.
  ADD COLUMN email          text,

  -- What the assistant is called. ADR-0009 has the wizard ask for it beside the
  -- other three, so it arrives with them and it lives with them.
  ADD COLUMN assistant_name text,

  -- What `src/auth/password.ts` wrote, in the PHC string format. `text` and
  -- never `varchar(n)`: the length moves with the cost, the salt and the key
  -- size, and ADR-0020 expects the cost to rise. A width taken from today's 88
  -- characters would refuse a hash the same module wrote a year later.
  ADD COLUMN password_hash  text,

  -- When the account was made, which is not when this row appeared.
  -- `timestamptz` matches `connections.created_at` and `sources.recorded_at`,
  -- and it is right here for the same reason: this is a moment, and nothing
  -- compares it to a calendar date somebody typed. The columns that are
  -- calendar dates come back as 'YYYY-MM-DD' text, which `src/db/connect.ts`
  -- tells the driver, and this one is never read that way.
  --
  -- No `DEFAULT now()`. A default would backfill the seeded row with the moment
  -- this migration ran and date an account that does not exist yet. The wizard
  -- sets it in the statement that writes the other three.
  ADD COLUMN created_at     timestamptz;

ALTER TABLE users
  -- ADR-0009's hedge, made real. "Single user" now means one owner per
  -- installation rather than one person named Shane. `users.id` exists so that
  -- a second owner costs no migration of the four tables defaulting `owner_id`
  -- to it, and this constraint is what a second owner does cost: one line
  -- dropped, deliberately, by whoever decides that day has come.
  ADD CONSTRAINT users_one_owner_per_installation CHECK (id = 1),

  -- An account is made whole or not at all. A hash with no email signs nobody
  -- in, and an email with no hash is an account anybody may claim. The wizard
  -- writes all four in one statement, and this says so to every later writer.
  ADD CONSTRAINT users_the_account_is_whole
    CHECK (num_nonnulls(email, assistant_name, password_hash, created_at) IN (0, 4)),

  -- Null admits an empty string, and an empty address signs nobody in.
  ADD CONSTRAINT users_every_field_says_something
    CHECK ((email IS NULL OR btrim(email) <> '')
       AND (assistant_name IS NULL OR btrim(assistant_name) <> '')),

  -- Nothing stores a password, only its hash. The PHC string format puts the
  -- algorithm, its parameters, the salt and the key between dollar signs, so
  -- four of them is the shape of every hash `src/auth/password.ts` writes. It
  -- is also the shape of an argon2 hash, which ADR-0020 leaves room for beside
  -- the first rather than in place of it. A typed password has no such shape.
  ADD CONSTRAINT users_password_is_hashed CHECK (password_hash LIKE '$%$%$%$%');

-- The email is unique without regard to case, in the shape that costs no
-- extension.
--
-- `citext` is the other real answer and it was weighed. It needs
-- `CREATE EXTENSION`, which needs a superuser: `provision-amaterasu-root.sh`
-- installs pgvector through `su - postgres` for exactly that reason, so a
-- second extension is a second root step on every installation somebody else
-- runs. ADR-0020 refused a dependency where node's own crypto would do, and
-- this is that trade one layer down. Postgres's own documentation now steers
-- away from citext as well.
--
-- WHAT IT COSTS: every read has to spell `lower(email)`. A query written as
-- `WHERE email = $1` misses this index, and misses a row somebody typed in
-- another case. `Shane@koinon.com.au` and `shane@koinon.com.au` are one
-- account.
--
-- The index cannot bind while the constraint above holds the table at one row.
-- It is here for the lookup sign-in makes, and for the day that constraint
-- goes.
CREATE UNIQUE INDEX users_email_is_one_account ON users (lower(email));

COMMENT ON TABLE users IS
  'One owner per installation. Four null columns mean the setup wizard has '
  'not run yet.';

COMMENT ON CONSTRAINT users_one_owner_per_installation ON users IS
  'ADR-0009: single user now means one owner per installation.';

COMMENT ON COLUMN users.password_hash IS
  'The PHC string src/auth/password.ts writes. No password is ever stored.';

-- @down

-- Dropping a column drops the constraints and the index naming it, so only the
-- constraint over `id` and the comment over the table need naming here.
-- `test/account.test.ts` runs down and up through the real runner and compares
-- the columns, the constraints, the indexes and the comment either side,
-- because that is the claim rather than the reasoning behind it.

ALTER TABLE users DROP CONSTRAINT users_one_owner_per_installation;

COMMENT ON TABLE users IS NULL;

ALTER TABLE users
  DROP COLUMN email,
  DROP COLUMN assistant_name,
  DROP COLUMN password_hash,
  DROP COLUMN created_at;
