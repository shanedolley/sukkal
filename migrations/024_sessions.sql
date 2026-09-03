-- What carries a proved sign-in to the next request.
--
-- A password answers "who is asking" once. A session is what carries that
-- answer, and it is the thing an attacker steals rather than the password,
-- because it needs no cracking. ADR-0023 makes this the only gate on every
-- installation, so the row below is the whole of what stands between somebody
-- and three mailboxes holding employer customer material.
--
-- THE TOKEN IS NOT IN THIS TABLE. `id` holds a SHA-256 of the token the
-- browser carries, so a copy of this table signs nobody in. That is the rule
-- KPA-79 states for a reset token and it holds here for the same reason: a
-- token readable in the database is a password readable in the database.
--
-- WHY SHA-256 AND NOT SCRYPT. ADR-0020 chose scrypt at 128 MiB for the
-- password, because a person picks a password and a person picks badly. A
-- session token is 32 bytes from `randomBytes`, so there is no dictionary to
-- try and no cost worth adding: guessing it is guessing 256 bits. Hashing it
-- protects the stolen-database case and nothing else has to.
--
-- THE LIFETIME IS ABSOLUTE, AND IT DOES NOT SLIDE. `expires_at` is set when
-- the session is issued and never moved. A sliding window renews on use, and
-- use is exactly what a thief does, so a stolen cookie would live for as long
-- as it was worth stealing. Fourteen days is the number `src/auth/session.ts`
-- holds, and it is a judgement rather than a default: a fortnight without
-- typing a password, against a stolen cookie that dies inside a fortnight
-- whatever anybody does with it.
--
-- REVOCATION IS A DELETE. Signing out removes the row, so the next request
-- carrying that cookie finds nothing. There is no `revoked_at` to read,
-- because a row that must be read to be known dead is a row somebody forgets
-- to read. `ON DELETE CASCADE` on the owner means removing the account ends
-- every session it opened.

CREATE TABLE sessions (
  -- The SHA-256 of the token, hex, so 64 characters. Never the token.
  id         text PRIMARY KEY,

  -- Whose session it is. One owner per installation today, and the column
  -- costs nothing and says which row signed in.
  owner_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- When it stops working, whatever happens between now and then.
  expires_at timestamptz NOT NULL,

  -- What asked, as the browser described itself, and where from. Neither
  -- authenticates anything: both are what a person reads when deciding
  -- whether a session on the list is theirs. Null when the caller sent none.
  user_agent text,
  signed_in_from inet,

  CONSTRAINT sessions_id_is_a_sha256 CHECK (id ~ '^[0-9a-f]{64}$'),

  -- A session that expires before it was issued is a clock nobody read.
  CONSTRAINT sessions_expiry_follows_issue CHECK (expires_at > created_at)
);

-- The sweep that clears what has run out reads this, and so does a person
-- listing what is open. Neither is a hot path, and the index costs one page.
CREATE INDEX sessions_expires_at ON sessions (expires_at);

COMMENT ON TABLE sessions IS
  'One proved sign-in, carried to the next request. The id is a SHA-256 of '
  'the token and never the token, so a copy of this table signs nobody in. '
  'Signing out deletes the row.';

COMMENT ON COLUMN sessions.expires_at IS
  'Absolute, and it never moves. A sliding window renews on use, and use is '
  'what a thief does.';

-- @down

DROP TABLE sessions;
