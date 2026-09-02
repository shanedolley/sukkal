/**
 * The nightly review: the staleness sweep, the six problems, the four
 * advisories, once a night, in that order.
 *
 * None of the three is new logic. `src/memory/sweep.ts`, `src/checks/
 * problems.ts` and `src/checks/advisories.ts` were written, tested, and then
 * called by nothing outside their own tests. This file is the scheduler that
 * gives them somewhere to run, and it adds one thing they do not have: a run
 * that breaks says so where Shane looks.
 *
 * **The sweep is the only one of the three that writes.** It opens a
 * `needs_you` row per stale fact and changes no fact state, which is ADR-0010.
 * The problems and the advisories return lines and change nothing at all.
 *
 * `today` is an argument all the way down, never a `now()` inside the logic.
 * `nightly()` takes it, `sweep()` takes it, and only the job wrapper in
 * `schedule()` reads a clock. That is what lets a test hold the day still,
 * and it is the rule `src/memory/state.ts` sets out.
 */
import { PgBoss } from 'pg-boss';
import type { ClientBase } from 'pg';
import { advisories } from '../checks/advisories.ts';
import { problems } from '../checks/problems.ts';
import type { Day } from '../memory/retire.ts';
import { sweep } from '../memory/sweep.ts';

/** The queue the whole review runs on, as one job. */
export const NIGHTLY = 'nightly.review';

/** 03:30, after the day's mail has stopped and before Shane reads the
 *  briefing. Late enough that a fact re-confirmed at midnight is already
 *  re-confirmed when the sweep reads it. */
export const NIGHTLY_CRON = '30 3 * * *';

/** Shane and his data are in Sydney, so the day this job means is Sydney's.
 *  `apps/web/lib/format.ts` pins the same zone for the same reason. */
export const ZONE = 'Australia/Sydney';

/** The title every failure row carries. One title, so the guard below finds
 *  yesterday's row and does not open a second. */
export const FAILED = 'The nightly review did not finish';

/** Today, as `YYYY-MM-DD`, in `zone`. `en-CA` is the locale that formats a
 *  date that way; the rest of the codebase compares dates as this text. */
export function dayIn(zone: string = ZONE, at: Date = new Date()): Day {
  return at.toLocaleDateString('en-CA', { timeZone: zone });
}

export interface NightlyReport {
  today: Day;
  /** Live verified facts past their review date. */
  stale: number;
  /** How many of those this run opened a `needs_you` item for. The rest
   *  already had one for the staleness they carry now, open or closed. */
  raised: number;
  /** `check.py`'s six. Empty on a machine with no vault, which is every
   *  machine but Shane's, so this is empty on amaterasu today. */
  problems: string[];
  /** `check.py`'s four. Never a failure, by their own definition. */
  advisories: string[];
}

/**
 * Runs all three against `today` and returns what they found.
 *
 * `vault` is here so a test can point the problems check at a directory it
 * built. Left out, it reads `VAULT_PATH`, and a vault that is not there
 * yields no problems rather than an error.
 */
export async function nightly(
  client: ClientBase,
  today: Day,
  vault?: string,
): Promise<NightlyReport> {
  const due = await sweep(client, today);
  return {
    today,
    stale: due.length,
    raised: due.filter((fact) => fact.raised).length,
    problems: await problems(vault),
    advisories: await advisories(client),
  };
}

/**
 * Opens one `needs_you` row saying the run broke, unless one is already open.
 *
 * `question` is the kind, because none of the four is "a job failed" and a
 * question is the one that means "this is waiting on you to look". The row
 * names no fact and no source: nothing here is about one fact.
 *
 * Guarded on an open row only. A run that fails every night has to keep saying
 * so, so closing the row lets the next failure re-raise it. That is the
 * opposite of the sweep's rule and it is deliberate: a stale fact Shane
 * dismissed is a decision, a job that will not run is not.
 *
 * Returns true when it opened one. A failure this cannot write, because the
 * database is what broke, reaches nobody: pg-boss still records the job
 * failure, and `docs/runbooks/worker.md` says where to read it.
 */
export async function raiseFailure(client: ClientBase, detail: string): Promise<boolean> {
  const opened = await client.query(
    `INSERT INTO needs_you (kind, title, detail, space)
       SELECT 'question', $1, $2, 'shared'
        WHERE NOT EXISTS (
          SELECT 1 FROM needs_you WHERE title = $1 AND closed_at IS NULL
        )
     RETURNING id`,
    [FAILED, detail],
  );
  return opened.rowCount === 1;
}

/** What the run logs. One line, so a night reads as a line in the journal. */
export function summarise(report: NightlyReport): string {
  return (
    `${NIGHTLY}: ${report.today}, ${report.stale} stale (${report.raised} raised), ` +
    `${report.problems.length} problems, ${report.advisories.length} advisories`
  );
}

/**
 * Creates the queue, registers the worker, and schedules it nightly.
 *
 * `exclusive`, so a run that overruns its hour never meets the next one. The
 * sweep's `NOT EXISTS` guard is not a unique constraint, and this policy is
 * what stands in for one.
 *
 * The problem and advisory lines go to the log and no further. An advisory is
 * "never a failure" by `src/checks/advisories.ts`'s own definition and would
 * print the same four lines into the queue every night, which is the crying
 * wolf that file's docstring warns about. The problems would earn a row, but
 * they read the vault, and the vault is on Shane's Mac and not on amaterasu,
 * so the check finds nothing there to raise. Give them a row in the story that
 * puts the vault, or the check, on the server.
 */
export async function schedule(
  boss: PgBoss,
  client: ClientBase,
  vault?: string,
): Promise<void> {
  await boss.createQueue(NIGHTLY, { policy: 'exclusive' });

  await boss.work(NIGHTLY, async () => {
    const today = dayIn();
    try {
      const report = await nightly(client, today, vault);
      console.log(summarise(report));
      for (const line of [...report.problems, ...report.advisories]) {
        console.warn(`${NIGHTLY}: ${line}`);
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      await raiseFailure(client, `${today}: ${reason}`);
      // Rethrown so pg-boss fails the job and retries it. The row above is
      // for Shane; the job's own state is for whoever reads the queue.
      throw cause;
    }
  });

  await boss.schedule(NIGHTLY, NIGHTLY_CRON, null, { tz: ZONE });
}
