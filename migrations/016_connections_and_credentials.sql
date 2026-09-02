-- The account the assistant reaches a provider with, and the secret it
-- reaches it with.
--
-- The connections dialog holds a secret in component state and drops it when
-- the dialog closes. That is honest about storing nothing and useless for
-- connecting: nothing the product does with an outside system works until a
-- secret outlives the page. These two tables are where it outlives it.
--
-- TWO TABLES, NOT ONE. A connection carries a provider, a name, a method and
-- a list of services, and every screen reads all four. A credential carries
-- ciphertext, and no screen may read it. Holding the bytes in their own table
-- means `SELECT * FROM connections` returns no secret, whoever writes the
-- query. One table would rest that guarantee on every later author
-- remembering to name their columns instead.
--
-- THE KEY IS NEVER IN A COLUMN. pgcrypto would encrypt these bytes inside the
-- database, and the key would then travel in the statement, land in
-- `pg_stat_statements` and sit in the log of any query somebody logs. So the
-- ciphertext arrives already sealed. `src/connections/crypto.ts` seals it with
-- AES-256-GCM from node's own `crypto`, under a key read from the
-- environment. ADR-0020 set that precedent for the password hash: this
-- repository has two dependencies, neither compiles, and a credential store
-- is a poor reason to add a third.
--
-- GCM AUTHENTICATES, AND THE CONNECTION ID IS PART OF WHAT IT AUTHENTICATES.
-- A cipher with no tag lets anybody holding UPDATE rights change the bytes and
-- learn what breaks. A tag over the ciphertext alone still lets them move one
-- row's bytes onto another row, which points the Sydney Water key at the BHP
-- account. Sealing the row against its own connection id refuses that: the
-- bytes decrypt under one id and under no other.
--
-- NOTHING IS UNIQUE ON PROVIDER ALONE. Shane holds a Microsoft account at BHP
-- and another at Sydney Water. They share the provider and nothing else, so
-- the name separates them and the pair is what is unique. Adding the same
-- provider twice is the normal case here.

CREATE TABLE connections (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Which service this reaches. One of the ids in
  -- `apps/web/lib/providers.ts`, held as text rather than an enum: the
  -- catalogue still gains providers, and `014_audit_attempt.sql` records what
  -- an enum value costs once it is there.
  provider   text NOT NULL,

  -- What this account is called, such as 'BHP Microsoft'. The reader picks a
  -- connection by this, so it says which account rather than which provider.
  name       text NOT NULL,

  -- The id of the chosen method, such as 'oauth' or 'token'. The method names
  -- the fields the dialog asked for.
  method     text NOT NULL,

  -- What the account may be reached for, by service id. Empty when the
  -- provider carries one thing, which is true of five of the nine.
  services   text[] NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Two accounts on one provider are ordinary. Two accounts under one name
  -- leave a reader who cannot tell them apart.
  CONSTRAINT connections_name_is_unique_per_provider UNIQUE (provider, name),

  -- NOT NULL admits an empty string, and an empty provider reaches nothing.
  CONSTRAINT connections_every_field_says_something
    CHECK (btrim(provider) <> '' AND btrim(name) <> '' AND btrim(method) <> ''),

  -- A blank service id grants nothing and reads like it grants something.
  CONSTRAINT connections_every_service_is_named
    CHECK (NOT ('' = ANY (services)))
);

COMMENT ON TABLE connections IS
  'One account on one provider. The secret lives in connection_credentials.';

CREATE TABLE connection_credentials (
  -- One credential per connection, so the connection id is the whole key.
  -- Retyping a key replaces this row rather than adding a second one nobody
  -- can choose between. ON DELETE CASCADE is the rule that removing a
  -- connection removes its credential.
  connection  bigint PRIMARY KEY REFERENCES connections (id) ON DELETE CASCADE,

  -- The sealed secret, as `src/connections/crypto.ts` wrote it: a version
  -- byte, the nonce, the tag, then the ciphertext. Opaque here on purpose.
  -- The database holds no key and decrypts nothing.
  ciphertext  bytea NOT NULL,

  -- When the provider issued the secret, and when it stops working. Both come
  -- from the provider and both are calendar dates, so neither carries a time
  -- zone. Read them as 'YYYY-MM-DD' text. `src/db/connect.ts` tells the driver
  -- to hand a date back as the string Postgres sent, because parsing one into
  -- a Date puts it at local midnight and moves it a day west of Greenwich.
  --
  -- Null on both is normal. An OAuth grant names no dates, and Atlassian is
  -- the provider that made the expiry worth asking for.
  issued_on   date,
  expires_on  date,

  -- The last time somebody asked the provider whether this still works, and
  -- what the provider said. Null until the first attempt, and null together:
  -- a verdict with no date says nothing about now.
  verified_on date,
  verdict     text,

  -- Twenty-nine bytes is the version byte, the nonce and the tag, which is
  -- exactly what sealing an empty string costs. So a row of twenty-nine bytes
  -- or fewer carries no secret: either it was sealed empty, or it was never
  -- sealed here at all.
  CONSTRAINT connection_credentials_ciphertext_is_sealed
    CHECK (length(ciphertext) > 29),

  CONSTRAINT connection_credentials_a_verdict_has_a_date
    CHECK ((verified_on IS NULL) = (verdict IS NULL)),

  CONSTRAINT connection_credentials_verdict_says_something
    CHECK (verdict IS NULL OR btrim(verdict) <> ''),

  -- A secret that expires before it was issued is a typed date nobody read.
  CONSTRAINT connection_credentials_expiry_follows_issue
    CHECK (issued_on IS NULL OR expires_on IS NULL OR expires_on >= issued_on)
);

COMMENT ON TABLE connection_credentials IS
  'Sealed secrets. The key is read from the environment, never from a column.';

COMMENT ON COLUMN connection_credentials.ciphertext IS
  'AES-256-GCM, sealed against the connection id. No route may return it.';

-- @down

DROP TABLE connection_credentials;
DROP TABLE connections;
