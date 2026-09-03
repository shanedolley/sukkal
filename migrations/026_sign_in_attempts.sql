-- What a guessing attack costs, and where a sign-in is written down.
--
-- ADR-0023 makes the application the only gate, so the sign-in route faces
-- whoever can reach the box. One account means an attacker needs one password
-- and has as many tries as the box will answer.
--
-- ADR-0024 decided what this does. KPA-78 names the hazard running the other
-- way, and it is the larger one: a
-- lockout on the only account is a denial of service against the only person
-- who can use the system, and there is no administrator to lift it. So this
-- carries a delay rather than a lock. The counter grows, the wait in front of
-- each attempt grows with it to a ceiling of eight seconds, and a correct
-- password still works at every point. Nobody is ever shut out.
--
-- TWO COLUMNS ON `users` RATHER THAN A TABLE OF THEIR OWN. KPA-78's file list
-- guessed at a table, and a table keyed by `owner_id` as its primary key is a
-- second row that exists whenever the first does, reached through a join, and
-- inserted before it can be updated. The row is already here and it is already
-- the one row per installation. `sessions` and `password_resets` earn their
-- own tables because there are many of each; there is exactly one counter.
--
-- ONE COUNTER FOR EVERY FAILED ATTEMPT, whatever address was typed. An
-- installation has one account, so a failure against an address nobody holds
-- is a failure at this door. Counting only the known address would leave the
-- whole throttle behind a name an attacker can simply not type.

ALTER TABLE users
  -- How many sign-ins have failed in a row. Zero after any success and after
  -- the command line clears it.
  ADD COLUMN sign_in_failures integer NOT NULL DEFAULT 0,

  -- When the last one failed. `src/auth/attempts.ts` forgets a run of
  -- failures fifteen minutes after the last one, which is what makes the
  -- slowdown expire by itself with nobody to ask.
  ADD COLUMN sign_in_failed_at timestamptz;

ALTER TABLE users
  ADD CONSTRAINT users_sign_in_failures_is_a_count CHECK (sign_in_failures >= 0),

  -- A count with no moment cannot be forgotten, so it would slow every sign-in
  -- for good. The two move together or the run is not a run.
  ADD CONSTRAINT users_a_failure_run_carries_its_moment
    CHECK ((sign_in_failures = 0) = (sign_in_failed_at IS NULL));

COMMENT ON COLUMN users.sign_in_failures IS
  'Failed sign-ins in a row, counted for the installation rather than for an '
  'address, because an installation has one account. It sets the wait in '
  'front of the next attempt and never refuses one.';

-- ---------------------------------------------------------------------------
-- Where a sign-in is written down
-- ---------------------------------------------------------------------------
--
-- KPA-78 requires every attempt, allowed and refused, to reach the audit log,
-- because a sign-in is the highest-value event on the box. `audit` already
-- refuses a denial that names no rule, and that constraint is the point of it:
-- a refusal nobody can explain tells Shane nothing.
--
-- So authentication gets a row in `policies`, the way the engine's own default
-- did in migration 012. It is a sixth row and not a sixth rule. The four the
-- brief names describe what KPA may do; this one describes what the door does,
-- written where the audit screen can render it beside every other refusal.
--
-- `src/policy/engine.ts` never reads it. `decide` matches a proposal against
-- what a rule governs, and nothing proposes a sign-in: authentication is
-- inbound and the engine judges what KPA sends out.

INSERT INTO policies (key, governs, effect, absolute) VALUES
  ('auth.sign-in',
   'Somebody proving who they are at the door, and every attempt that fails',
   'Deny. A sign-in that cannot prove itself opens nothing, and the answer names neither which half was wrong nor whether the address exists.',
   true);

-- @down

ALTER TABLE users
  DROP CONSTRAINT users_a_failure_run_carries_its_moment,
  DROP CONSTRAINT users_sign_in_failures_is_a_count;

ALTER TABLE users
  DROP COLUMN sign_in_failed_at,
  DROP COLUMN sign_in_failures;

-- `audit.rule` is a foreign key into `policies` and the log is append only, so
-- once an entry cites this rule the row cannot leave while `audit` stands.
-- Migration 012 met the same problem and answered it the same way: delete the
-- row while nothing cites it, leave it otherwise, and never raise. Reversing
-- 005 drops both tables together, which is the one path that always removes
-- it.

DELETE FROM policies
 WHERE key = 'auth.sign-in'
   AND NOT EXISTS (SELECT 1 FROM audit WHERE rule = 'auth.sign-in');
