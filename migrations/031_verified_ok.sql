-- Records whether a credential worked when it was last checked. KPA-107.
--
-- `verified_on` and `verdict` already said when a credential was checked and
-- what the provider answered, and nothing ever filled them. KPA-107 runs the
-- check on a schedule, and the screen has to tell a working connection from a
-- dead one. Reading that out of the verdict sentence would make a rewording a
-- change of state, so the answer gets a column of its own.
--
-- On 19 September 2026 two of the three Google connections in `sukkal_local`
-- answered `invalid_grant` while the Connections screen showed all three as
-- connected. This is the column that would have said so.
--
-- `verified_ok` is null until a check has run, which is a third answer and not
-- a failure: a connection nobody has checked is unknown, not broken.
-- `verified_at` is the moment of the check, because the schedule runs hourly
-- and skips a credential checked inside its window, which a date cannot
-- measure. The two are set together or not at all.

ALTER TABLE connection_credentials
  ADD COLUMN verified_ok boolean,
  ADD COLUMN verified_at timestamptz,
  ADD CONSTRAINT connection_credentials_verified_together
    CHECK ((verified_ok IS NULL) = (verified_at IS NULL));

COMMENT ON COLUMN connection_credentials.verified_ok IS
  'Whether the credential worked at verified_at. Null until a check has run.';
COMMENT ON COLUMN connection_credentials.verified_at IS
  'When the credential was last checked. The hourly recheck skips one checked '
  'inside its window.';

-- @down

-- The constraint goes with the columns.
ALTER TABLE connection_credentials
  DROP COLUMN verified_at,
  DROP COLUMN verified_ok;
