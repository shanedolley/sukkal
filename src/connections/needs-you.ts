/**
 * The "needs you" item for a credential: expiring soon, lapsed, or failing
 * the recheck. KPA-108.
 *
 * Migration 033 gives `needs_you_kind` a fifth value, `credential`, rather
 * than reusing `deadline`. Criterion 2 names three triggers and only one
 * carries a date, so the other two would raise a `deadline` row with a null
 * `raised_for`, and nothing would then tell two open lapses on the same
 * connection apart from one. Ruled by Shane, 1 October 2026.
 *
 * ONE OPEN ITEM PER CONNECTION, KEPT IN SYNC WITH WHAT recheck.ts ALREADY
 * WROTE. `reconcileCredentialItems` reads `verified_ok` and `expires_on`,
 * both written by `recordVerification` and `setCredential`, rather than
 * re-deciding health itself. A connection is unhealthy when its last check
 * failed, or its credential expires within `EXPIRY_WINDOW_DAYS`. A null
 * `verified_ok` is unknown, not broken (docs/schema.md), so it is healthy: a
 * renewal resets it to null and the recheck never writes it for a metered or
 * unprobed provider, so reading null as failing left that item open for good. An
 * unhealthy connection with no open item gets one; a healthy connection
 * loses its open item, by setting `closed_at` rather than deleting the row.
 *
 * DEDUPLICATED ON THE CONNECTION AND ON BEING OPEN, NEVER ON A DATE. An
 * expiry's date is the same every hour until the credential is renewed, so
 * keying the guard on it, the way `raised_for` keys `deadline`, would reopen
 * the item on every run instead of leaving the one already open alone.
 */
import type { ClientBase } from 'pg';

/** How close an expiry has to be to raise an item. Matches LIFETIME_DAYS in
 *  src/auth/session.ts, which is why 14 and not 30. */
export const EXPIRY_WINDOW_DAYS = 14;

/**
 * Closes every open `credential` item whose connection is healthy again, then
 * opens one for every unhealthy connection that has none open. `today` is a
 * 'YYYY-MM-DD' string, the same shape `now.toISOString().slice(0, 10)` gives
 * below, so the comparison stays text and never parses a date into one.
 *
 * `recheck()` calls this once it has checked everything due, so a lapse found
 * this hour is on the briefing this hour, not tomorrow's sweep.
 */
export async function reconcileCredentialItems(client: ClientBase, today: string): Promise<void> {
  await client.query(
    `UPDATE needs_you n SET closed_at = now()
       FROM connections c
       JOIN connection_credentials k ON k.connection = c.id
      WHERE n.connection_id = c.id AND n.kind = 'credential' AND n.closed_at IS NULL
        AND k.verified_ok IS NOT FALSE
        AND (k.expires_on IS NULL OR k.expires_on > $1::date + make_interval(days => $2))`,
    [today, EXPIRY_WINDOW_DAYS],
  );

  await client.query(
    `INSERT INTO needs_you (kind, title, detail, space, connection_id)
       SELECT 'credential',
              c.name || ' needs attention',
              -- 'FMDD Mon YYYY': the FM prefix drops the leading zero from the
              -- day, and the three-letter month matches formatDay in
              -- apps/web/lib/format.ts on eleven months of twelve. The
              -- en-AU locale formatDay reads from writes September as
              -- "Sept", four letters, and nothing here reconciles that one
              -- month; both are a person's idea of a short month name, not a
              -- machine format, so Shane asked for this over ISO 8601, not
              -- over the one month the two disagree on.
              CASE WHEN k.verified_ok IS FALSE
                     THEN 'The hourly credential recheck failed: ' || k.verdict
                   ELSE 'Expires ' || to_char(k.expires_on, 'FMDD Mon YYYY')
                          || '. Renew it before then.'
              END,
              'shared', c.id
         FROM connections c
         JOIN connection_credentials k ON k.connection = c.id
        WHERE (k.verified_ok IS FALSE
               OR (k.expires_on IS NOT NULL
                   AND k.expires_on <= $1::date + make_interval(days => $2)))
          AND NOT EXISTS (
            SELECT 1 FROM needs_you n
             WHERE n.connection_id = c.id AND n.kind = 'credential' AND n.closed_at IS NULL
          )`,
    [today, EXPIRY_WINDOW_DAYS],
  );
}
