/**
 * Checks every stored credential against its provider and writes down what
 * the provider said. KPA-107.
 *
 * Without this, an expiry is a date nobody has checked since the day it was
 * typed. On 19 September 2026 two of the three Google connections answered
 * `invalid_grant` while the Connections screen showed all three connected,
 * and nothing had asked Google since the day each was made.
 *
 * **It uses the check each connection already has, and no second one.** A
 * connection holding an OAuth grant is checked the way the grant is used:
 * the stored refresh token is traded at the provider with `renew`, and
 * `whoami` asks whose token came back. A connection holding a key is checked
 * with `probeFor` and `verify` from `verify.ts`, which the connect-time checks
 * were written around.
 *
 * **It records and it does nothing else.** A failure never removes, disables
 * or hides a connection. The row says it failed and why, and the screen shows
 * it. Deciding what to do about a dead credential is a person's job.
 *
 * **It never spends money.** A probe `verify.ts` marks `metered` is skipped,
 * so a Voyage key stays unchecked here rather than billed once an hour. A
 * Claude subscription token is checked every run: the call costs plan allowance
 * and not money, and the token is the first path every model call tries
 * (ADR-0027).
 *
 * **A second run inside the window does nothing.** A credential checked less
 * than `WINDOW_MINUTES` ago is left alone, so two runs close together, or a
 * worker restart, cost the provider one call and not two.
 *
 * A Google refresh token carries no expiry of its own that Google will
 * report, so there is no expiry to re-read. `renew` answers with the access
 * token's lifetime, which is an hour and says nothing about the grant.
 */
import type { ClientBase } from 'pg';

import type { Runner } from '../memory/inference-live.ts';
import { reconcileCredentialItems } from './needs-you.ts';
import { GRANTS, renew, whoami } from './oauth.ts';
import { recordVerification, secretFor, setCredential } from './store.ts';
import { probeFor, verify, verifySubscription } from './verify.ts';

/** How recently a check counts as current. Under the hourly schedule, so the
 *  next run always checks again. */
export const WINDOW_MINUTES = 50;

export interface Checked {
  id: string;
  name: string;
  ok: boolean;
  verdict: string;
}

interface Due {
  id: string;
  provider: string;
  name: string;
  method: string;
}

/** The reason a thrown error gave, which names a fault and never a token. */
function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * What one connection's provider says about its credential, or null when
 * nothing here can ask without paying or without a secret to ask with.
 */
export async function checkOne(
  client: ClientBase,
  connection: Due,
  now: Date,
  fetcher: typeof fetch,
  run?: Runner,
): Promise<{ ok: boolean; verdict: string } | null> {
  let secret: string | null;
  try {
    secret = await secretFor(client, connection.id);
  } catch (cause) {
    // The bytes will not open: altered, or sealed under a key since rotated.
    return { ok: false, verdict: `the stored credential will not open: ${reason(cause)}` };
  }
  if (secret === null) {
    return null;
  }

  const grant = GRANTS[connection.provider];
  if (grant !== undefined && connection.method === 'oauth') {
    try {
      const tokens = await renew(grant, secret, now, fetcher);
      // A provider that rotates hands back a new refresh token. Keeping the
      // old one would leave Sukkal holding a token the provider has retired.
      if (tokens.refreshToken !== null && tokens.refreshToken !== secret) {
        await setCredential(client, connection.id, tokens.refreshToken, {
          issuedOn: now.toISOString().slice(0, 10),
        });
      }
      const who = await whoami(grant, tokens.accessToken, fetcher);
      const host = new URL(grant.token).host;
      return who === connection.name
        ? { ok: true, verdict: `${host} renewed the grant for ${who}` }
        : { ok: false, verdict: `${host} renewed a grant that belongs to ${who}, not ${connection.name}` };
    } catch (cause) {
      return { ok: false, verdict: reason(cause) };
    }
  }

  // The subscription token is proved by the CLI and by nothing else. `probeFor`
  // would post it to api.anthropic.com as an API key.
  if (connection.provider === 'claude' && connection.method === 'subscription') {
    return verifySubscription(secret, run);
  }

  const probe = probeFor(connection.provider, secret);
  if (probe === null || probe.cost === 'metered') {
    return null;
  }
  return verify(probe, fetcher);
}

/**
 * Checks every credential not checked inside the window, records each answer
 * on its row, and reconciles the "needs you" item each credential may hold
 * (KPA-108: expiring, lapsed, or failing). Returns what it found, for the
 * worker's log.
 *
 * The reconcile runs last and over every connection, not just the ones due
 * this run: a credential inside its verification window can still cross into
 * its expiry window between runs, and reconciling only the due rows would
 * miss that.
 */
export async function recheck(
  client: ClientBase,
  now: Date,
  fetcher: typeof fetch,
  run?: Runner,
): Promise<Checked[]> {
  const due = await client.query<Due>(
    `SELECT c.id, c.provider, c.name, c.method
       FROM connections c
       JOIN connection_credentials k ON k.connection = c.id
      WHERE k.verified_at IS NULL
         OR k.verified_at < $1::timestamptz - make_interval(mins => $2)
      ORDER BY c.provider, c.name`,
    [now.toISOString(), WINDOW_MINUTES],
  );

  const found: Checked[] = [];
  for (const connection of due.rows) {
    const answer = await checkOne(client, connection, now, fetcher, run);
    if (answer === null) {
      continue;
    }
    await recordVerification(client, connection.id, answer.verdict, answer.ok);
    found.push({ id: connection.id, name: connection.name, ...answer });
  }

  await reconcileCredentialItems(client, now.toISOString().slice(0, 10));

  return found;
}
