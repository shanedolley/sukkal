-- The Jira site a connection reaches. KPA-105.
--
-- A Jira connection is one site: koinon.atlassian.net or
-- engineering-collibra.atlassian.net. `name` cannot say so, because a rename
-- changes it, and the sealed secret cannot say so, because nothing can query
-- ciphertext. So the site gets a column, and a unique index makes a second
-- connection to the same site a constraint violation rather than a convention.
--
-- IT IS NULLABLE. Only Jira has a site, and the rows that
-- exist were written before the column did.
--
-- THE CHECK IS THE TOKEN'S DESTINATION. The hourly recheck builds its request
-- URL from this column and sends the stored token to it, so a value naming any
-- host but an atlassian.net site is a token sent to a stranger. The pattern
-- allows one lowercase https origin and nothing else: no path, no port, no
-- userinfo. `src/connections/jira.ts` normalises a typed address to that shape
-- before it gets here, and this is the floor under it.

ALTER TABLE connections
  ADD COLUMN site text,
  ADD CONSTRAINT connections_site_is_an_atlassian_origin
    CHECK (site IS NULL OR site ~ '^https://[a-z0-9][a-z0-9-]*\.atlassian\.net$');

CREATE UNIQUE INDEX connections_one_per_site
  ON connections (provider, site)
  WHERE site IS NOT NULL;

COMMENT ON COLUMN connections.site IS
  'The https origin of the site a connection reaches, such as '
  'https://koinon.atlassian.net. Null on a provider that has no site. One '
  'connection per site, per provider.';

-- @down

-- The index and the constraint go with the column.
ALTER TABLE connections
  DROP COLUMN site;
