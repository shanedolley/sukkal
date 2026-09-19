/**
 * The hourly recheck of every stored credential. KPA-107.
 *
 * `src/connections/recheck.ts` does the checking and this gives it a clock.
 * It runs at five past every hour, and once when the worker starts, so a
 * screen read after a restart does not wait up to an hour to learn a
 * connection died overnight. The window in `recheck.ts` keeps the start-up
 * run from costing a second call when the hourly one has only just run.
 */
import type { PgBoss } from 'pg-boss';
import type { ClientBase } from 'pg';

import { recheck } from '../connections/recheck.ts';

export const RECHECK = 'connections.recheck';

/** Five past the hour, clear of the drain's minute boundary. */
export const RECHECK_CRON = '5 * * * *';

export async function schedule(boss: PgBoss, client: ClientBase): Promise<void> {
  await boss.createQueue(RECHECK, { policy: 'exclusive' });

  await boss.work(RECHECK, async () => {
    const found = await recheck(client, new Date(), fetch);
    const failing = found.filter((one) => !one.ok);
    console.log(`${RECHECK}: checked ${found.length}, ${failing.length} failing`);
    for (const one of failing) {
      console.warn(`${RECHECK}: ${one.name}: ${one.verdict}`);
    }
  });

  await boss.schedule(RECHECK, RECHECK_CRON);
  await boss.send(RECHECK, {});
}
