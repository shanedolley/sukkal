-- A grant that has left for the provider and has not come back.
--
-- KPA-103 runs one OAuth grant for every provider that offers one, from a
-- record holding the urls and the scopes. Between the moment the browser
-- leaves and the moment the provider redirects it back, two values have to
-- survive on the server. This is where they wait.
--
-- WHY THEY MAY NOT WAIT IN THE BROWSER. The state is what proves the answer
-- belongs to the request that asked. A state the browser holds is a state an
-- attacker can plant, and the whole point of it is to refuse a grant somebody
-- else started. The verifier is worse: PKCE exists because the authorization
-- code alone can be stolen, and a verifier stored beside the code protects
-- nothing.
--
-- THE STATE IS NOT IN THIS TABLE. `id` holds a SHA-256 of it, which is the
-- rule `sessions` and `password_resets` already keep. A copy of this table
-- therefore completes no grant: the reader learns a hash, and the provider
-- redirects with the value.
--
-- THE VERIFIER IS STORED AS IT IS, because the token request has to send it.
-- Nothing recovers it from a hash. It is safe beside a hashed state for the
-- reason above: whoever reads this table cannot produce the state, so the
-- verifier reaches no token exchange. The row also dies in ten minutes.
--
-- SINGLE USE IS A DELETE, AND THE DELETE IS THE CLAIM. `finish` runs
-- `DELETE ... RETURNING`, so two callbacks carrying one state race for a row
-- that only one of them gets. `src/auth/reset.ts` spends a reset token the
-- same way and says why.
--
-- TEN MINUTES. A person presses one button, picks an account, and reads one
-- consent screen. An hour of grace buys nothing and leaves a usable row on the
-- table for the rest of it.

CREATE TABLE oauth_grants (
  -- The SHA-256 of the state, hex, so 64 characters. Never the state.
  id         text PRIMARY KEY,

  -- Which record in `src/connections/oauth.ts` this grant follows. No
  -- reference: the providers are code rather than rows, because a provider is
  -- urls and scopes and neither belongs in a table nobody edits.
  provider   text NOT NULL,

  -- The PKCE code verifier, as the token request must send it.
  verifier   text NOT NULL,

  -- Where to send the browser once the grant lands. It is checked against the
  -- rule in `apps/web/lib/next-path.ts` before it is obeyed, because a value
  -- that decides a redirect is a value an attacker writes.
  returns_to text,

  created_at timestamptz NOT NULL DEFAULT now(),

  -- When it stops working, whatever happens between now and then.
  expires_at timestamptz NOT NULL,

  CONSTRAINT oauth_grants_id_is_a_sha256 CHECK (id ~ '^[0-9a-f]{64}$'),

  CONSTRAINT oauth_grants_expiry_follows_issue CHECK (expires_at > created_at),

  CONSTRAINT oauth_grants_provider_says_something CHECK (btrim(provider) <> ''),

  -- A verifier short enough to guess defeats PKCE. RFC 7636 sets the range at
  -- 43 to 128 characters, and this refuses anything outside it rather than
  -- trusting every caller to measure.
  CONSTRAINT oauth_grants_verifier_is_long_enough
    CHECK (length(verifier) BETWEEN 43 AND 128)
);

-- The sweep reads this. Unlike `password_resets`, this table holds a row per
-- grant in flight rather than one per owner, so an abandoned grant does
-- accumulate and there is something to clear.
CREATE INDEX oauth_grants_expires_at ON oauth_grants (expires_at);

COMMENT ON TABLE oauth_grants IS
  'A grant that has left for the provider and has not come back. The id is a '
  'SHA-256 of the state and never the state. Completing one deletes the row.';

COMMENT ON COLUMN oauth_grants.verifier IS
  'The PKCE code verifier, stored as it is because the token request sends '
  'it. Safe beside a hashed state: whoever reads this cannot produce the '
  'state, so the verifier reaches no exchange.';

-- @down

DROP TABLE oauth_grants;
