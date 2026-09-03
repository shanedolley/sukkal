-- The way back in for somebody who has forgotten the password.
--
-- ADR-0023 makes the application the only gate on every installation, so there
-- is no second door and no administrator to open one. ADR-0009 named the same
-- thing from the other side: a fresh installation has no mail relay, so a link
-- has nowhere to go and the escape hatch has to be a command on the server.
-- KPA-79 builds both, and this table is what they share.
--
-- THE TOKEN IS NOT IN THIS TABLE. `id` holds a SHA-256 of the token the person
-- carries, exactly as `sessions` does, so a copy of this table opens no
-- account. A token readable in the database is a password readable in the
-- database, and the reset flow exists because the password was lost.
--
-- SINGLE USE IS A DELETE, AND THE DELETE IS THE CLAIM. `spend` runs
-- `DELETE ... RETURNING`, so two requests carrying one token race for a row
-- that only one of them gets. A `used_at` column would need reading to be
-- known spent, and a read somebody forgets is a token that works twice.
--
-- ONE LIVE TOKEN PER OWNER. Requesting a reset removes whatever was
-- outstanding before it writes the new row, so asking twice does not leave two
-- keys under the mat. It also bounds this table at one row per account,
-- which is what stops a stranger filling it by asking repeatedly.
--
-- AN HOUR, WHICH IS WHAT THE SCREEN ALREADY PROMISED.
-- `forgot-password-form.tsx` has said "the link lasts an hour" since KPA-37,
-- and `src/auth/reset.ts` holds the number.

CREATE TABLE password_resets (
  -- The SHA-256 of the token, hex, so 64 characters. Never the token.
  id         text PRIMARY KEY,

  -- Whose reset it is. One owner per installation today, and removing the
  -- account takes its outstanding token with it.
  owner_id   bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- When it stops working, whatever happens between now and then.
  expires_at timestamptz NOT NULL,

  -- Where the request came from, when the caller sent one. It authenticates
  -- nothing. It is what a person reads when deciding whether the reset they
  -- did not ask for came from them.
  requested_from inet,

  CONSTRAINT password_resets_id_is_a_sha256 CHECK (id ~ '^[0-9a-f]{64}$'),

  -- A token that expires before it was issued is a clock nobody read.
  CONSTRAINT password_resets_expiry_follows_issue CHECK (expires_at > created_at),

  -- One live token per owner, enforced here rather than by remembering to
  -- delete first. `request` deletes anyway; this is what makes it true.
  CONSTRAINT password_resets_one_per_owner UNIQUE (owner_id)
);

-- There is no index and no sweep, which is where this differs from `sessions`.
-- The unique constraint above holds this table at one row per account, so
-- there is nothing to scan and nothing to clear: the next request replaces
-- what expired.

COMMENT ON TABLE password_resets IS
  'One outstanding password reset. The id is a SHA-256 of the token and never '
  'the token. Using one deletes the row, which is what makes it single use.';

COMMENT ON COLUMN password_resets.expires_at IS
  'An hour after it was issued. The screen has promised that since KPA-37.';

-- @down

DROP TABLE password_resets;
