-- The address a sending connection's mail comes from. KPA-158.
--
-- KPA-143 made `name` do two jobs: tell one account from the next, and be the
-- address `deliver` puts in the message's `from`. It broke on first contact
-- with a real person on 1 October 2026. The Name box asks what tells this
-- account from the next one, so the card was named 'Sukkal Resend', and Resend
-- would have refused that as a `from`. Nothing would have crashed, because
-- `deliver` never throws, and no reset mail would ever have arrived.
--
-- So the address gets a column. The name keeps its one job and gains the
-- second half of the header rather than the whole of it:
-- `Sukkal Resend <no-reply@sukkal.app>`.
--
-- IT IS NULLABLE, AND ON PURPOSE TWICE OVER. Nine of the ten providers send no
-- mail, so a required address would be a column of nulls under a NOT NULL that
-- lies. And the rows that exist were written before the column did:
-- `sukkal_local` holds a Resend card with no address, so a migration that
-- constrained the existing data would fail on the one installation that
-- matters. A DEFAULT of 'no-reply@sukkal.app' would have bought that at the
-- price of baking one installation's verified domain into every schema.
--
-- THE CHECK IS A FLOOR, NOT THE VALIDATION. It proves one @, something either
-- side of it, a dot in the domain and no whitespace anywhere. That is all it
-- proves: not that the mailbox exists, not that the domain is verified at the
-- vendor, and not that a Resend card carries an address at all.
-- `apps/web/app/(app)/api/connections/route.ts` is the trust boundary and
-- refuses a Resend card with none, because a route is what a request reaches
-- and the browser's own check is a convenience.
--
-- The no-whitespace half is load-bearing past tidiness. A carriage return or a
-- line feed in a value that reaches a mail header ends the header and starts
-- one the sender chose, which is header injection. `fromHeader` in
-- `src/auth/reset.ts` refuses one on the way out; this refuses one on the way
-- in, and neither is the other's excuse.

ALTER TABLE connections
  ADD COLUMN send_from text,
  ADD CONSTRAINT connections_send_from_is_shaped_like_an_address
    CHECK (send_from IS NULL
           OR send_from ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');

COMMENT ON COLUMN connections.send_from IS
  'The address a sending connection puts in the mail''s from. Null on a '
  'connection that sends nothing. The name beside it is the display name '
  'recipients read, quoted and escaped by fromHeader in src/auth/reset.ts.';

-- @down

-- The constraint goes with the column.
ALTER TABLE connections
  DROP COLUMN send_from;
