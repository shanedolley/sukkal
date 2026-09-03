-- A connection may hold no credential, and the schema now says so.
--
-- Claude offers two ways in. The API key is a secret this store seals. The
-- subscription is not: the button opens Claude, the plan covers the usage, and
-- the assistant reaches it through the headless CLI rather than through a key.
-- ADR-0016 divides the two, and KPA-104 is where the second one gets a row.
--
-- WHAT THAT ROW LOOKS LIKE. It is a `connections` row with no matching
-- `connection_credentials` row at all. Not a row holding a null secret, which
-- the `NOT NULL` on `ciphertext` refuses anyway, and not an empty ciphertext,
-- which the length check refuses. The absence is the statement.
--
-- WHY A COMMENT RATHER THAN A CONSTRAINT. Nothing should require a credential,
-- so there is no rule to write: every OAuth grant is the same shape, and so is
-- a connection somebody added before pasting the key. What was missing is the
-- sentence saying the absence is deliberate, because a reader meeting
-- `LEFT JOIN connection_credentials` has no way to tell a design from an
-- oversight.

COMMENT ON TABLE connections IS
  'One account on one provider. The secret, where there is one, lives in '
  'connection_credentials. A connection with no row there holds no secret on '
  'purpose: Claude by subscription and every OAuth grant reach their provider '
  'without one. Read hasSecret from src/connections/store.ts rather than '
  'reading the absence as a fault.';

COMMENT ON TABLE connection_credentials IS
  'Sealed secrets, one row per connection that has one. A connection may have '
  'none. The key is read from the environment, never from a column.';

COMMENT ON COLUMN connection_credentials.expires_on IS
  'When the provider stops accepting the secret. Null where the vendor '
  'publishes no expiry and nobody has typed a term, which the connections '
  'form now refuses to leave blank on a key.';

COMMENT ON COLUMN connection_credentials.verdict IS
  'What the vendor said when src/connections/verify.ts last asked. Null with '
  'verified_on until the first attempt, and the two are null together.';

-- @down

COMMENT ON COLUMN connection_credentials.verdict IS NULL;
COMMENT ON COLUMN connection_credentials.expires_on IS NULL;

COMMENT ON TABLE connection_credentials IS
  'Sealed secrets. The key is read from the environment, never from a column.';

COMMENT ON TABLE connections IS
  'One account on one provider. The secret lives in connection_credentials.';
