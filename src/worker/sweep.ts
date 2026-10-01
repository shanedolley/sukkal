/**
 * The daily sweep of what has expired: session rows and abandoned OAuth
 * grants. KPA-157.
 *
 * `src/auth/session.ts` and `src/connections/oauth.ts` each export a
 * `sweepExpired(client, now)` that deletes the right rows and answers how
 * many. Both were written and tested, and neither was reachable from the
 * worker until this file. It is the scheduler `recheck.ts` is for
 * `src/connections/recheck.ts`, for both of them at once.
 *
 * Beware the name collision: `src/memory/sweep.ts` also exports a function
 * named `sweep`, which reviews facts for staleness and is unrelated.
 * `nightly.ts` imports that one. This module imports `sweepExpired` from
 * each table's own module under an alias, and exports no `sweep` of its own.
 */
import type { PgBoss } from 'pg-boss';
import type { ClientBase } from 'pg';
import { sweepExpired as sweepSessions } from '../auth/session.ts';
import { sweepExpired as sweepGrants } from '../connections/oauth.ts';

export const EXPIRY = 'expired.sweep';

/** Quarter past four, clear of the nightly review's 03:30 and the recheck's
 *  five-past-the-hour. A sweep frees space and clears a stale PKCE verifier:
 *  neither is urgent, so once a day is enough and hourly would only add
 *  noise. */
export const EXPIRY_CRON = '15 4 * * *';

export async function schedule(boss: PgBoss, client: ClientBase): Promise<void> {
  await boss.createQueue(EXPIRY, { policy: 'exclusive' });

  await boss.work(EXPIRY, async () => {
    const now = new Date();
    // Promise.allSettled, not two awaits in sequence: a throw from one sweep
    // must not skip the other, and the handler must never reject, because
    // pg-boss would retry a job that has nothing left to retry for.
    const [sessions, grants] = await Promise.allSettled([
      sweepSessions(client, now),
      sweepGrants(client, now),
    ]);

    const sessionCount = sessions.status === 'fulfilled' ? sessions.value : 'failed';
    const grantCount = grants.status === 'fulfilled' ? grants.value : 'failed';
    console.log(`${EXPIRY}: sessions ${sessionCount}, grants ${grantCount}`);

    if (sessions.status === 'rejected') {
      console.error(`${EXPIRY}: sessions sweep failed: ${String(sessions.reason)}`);
    }
    if (grants.status === 'rejected') {
      console.error(`${EXPIRY}: grants sweep failed: ${String(grants.reason)}`);
    }
  });

  await boss.schedule(EXPIRY, EXPIRY_CRON);
  await boss.send(EXPIRY, {});
}
