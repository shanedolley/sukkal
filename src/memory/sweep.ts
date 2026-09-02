/**
 * The staleness sweep.
 *
 * ADR-0010 makes `stale` a derived state: `verified IS NOT NULL AND
 * stale_after < today AND valid_to IS NULL`. Nothing stores it, so the sweep
 * has nothing to correct if it fails halfway. **It writes `needs_you` and
 * changes no fact state at all.** `src/memory/retire.ts` already says the
 * sweep reads and never writes `valid_to`; this file is the reason it exists.
 * `needs_you` is the one table it touches, and it both opens and closes a
 * `deadline` row there: it is the only writer that table has.
 *
 * A stale fact never fails the check, the same rule check.py used: it is a
 * fact doing its job, not a defect, and failing on one would stop the review
 * that could re-confirm it. There is no failure path here to trigger.
 *
 * `today` is an argument, never a call to `now()` or `CURRENT_DATE`. A fact
 * goes stale because a date passed, so the same row reads differently
 * tomorrow, and a test has to hold the day still. `src/memory/state.ts`
 * takes the day the same way.
 */
import type { ClientBase } from 'pg';
import type { Day } from './retire.ts';

/**
 * How long a closed review item keeps its fact quiet.
 *
 * Shane can close a `deadline` item without re-confirming the fact behind it.
 * The fact is still stale, so without this the next night opens the same item
 * again, and the night after that, forever. ADR-0017 fixed the other half of
 * this: a re-confirmed fact gets a new `stale_after` and stops being stale, so
 * that path already goes quiet on its own. This covers the path where nothing
 * about the fact changed.
 *
 * Thirty days rather than never, because never is the failure ADR-0017 names:
 * a memory that quietly decides to stop asking. A fact Shane dismissed without
 * dealing with is a fact still owed a review, so it comes back in a month.
 * One number, changed here, and `docs/runbooks/worker.md` prints it.
 */
export const SNOOZE_DAYS = 30;

export interface StaleFact {
  id: string;
  path: string;
  title: string;
  space: string;
  staleAfter: Day;
  /** True when this run opened a new needs_you item. False when one already
   *  stands for the fact -- open, or closed inside the last `SNOOZE_DAYS` --
   *  so the fact is reported and not raised twice. */
  raised: boolean;
}

/**
 * Every live, verified fact past `stale_after` as of `today`, oldest first.
 *
 * Each one gets a `needs_you` row of kind `deadline`, unless an open one
 * already names it. `docs/schema.md`'s four kinds are a draft, a question, a
 * denied action, and a deadline coming; a fact whose review date has passed
 * is that fourth kind; the codebase's own words for this state, "past their
 * review date" and "falls due", are a deadline's words.
 *
 * Three statements. The first closes an item whose fact has stopped being
 * stale. The second lists what is due. The third opens what no item already
 * covers, guarded by its own `NOT EXISTS`. All three read `stale_after < $1`,
 * matching `factState`'s derivation: a fact whose `stale_after` falls today
 * is not yet stale. `retire.ts` read `<=` until 2 September 2026, when it was
 * reconciled to ADR-0010 alongside this file. The three now agree, which is
 * what lets KPA-13 diff one report against the vault's.
 *
 * **The guard reads closed items as well as open ones**, inside
 * `SNOOZE_DAYS`. An open item alone would stop two sweeps in one night from
 * opening two rows and nothing more: closing an item without re-confirming
 * the fact left it stale, and the next night raised it again. The snooze is
 * measured from `today`, the argument, so a test holds that day still the way
 * it holds every other date here.
 *
 * ponytail: two statements against a `NOT EXISTS` guard, not a unique
 * constraint, so two sweeps running at once could each open a row.
 * `src/worker/nightly.ts` runs this on an `exclusive` queue, which is what
 * stops it overlapping itself; add the constraint if a second caller appears.
 *
 * `facts.entity` is nullable (ADR-0014) and so is `needs_you.entity`:
 * migration 010 dropped the `NOT NULL` for exactly this insert, so a due fact
 * naming no entity opens a row with none rather than failing the statement
 * and losing every other row with it.
 */
export async function sweep(client: ClientBase, today: Day): Promise<StaleFact[]> {
  // An open deadline item whose fact is no longer stale has nothing left to
  // ask, so it closes. Re-confirming moves `stale_after` (ADR-0017) and
  // retiring sets `valid_to`, and neither closes the item: nothing in the
  // codebase closes a needs_you row, and `apps/web/lib/needs-you.ts` only
  // reads the open ones. Without this the item stayed open forever, and the
  // guard below then read it as covering the fact's NEXT staleness too, so a
  // re-confirmed fact was never raised again. That is worse than the bug the
  // snooze fixes, and only scheduling the sweep made it reachable.
  //
  // ponytail: closing here plus the snooze means a fact whose review interval
  // is under SNOOZE_DAYS waits out the difference before it raises again. The
  // vault's shortest interval is 41 days, so nothing waits today. Give
  // needs_you a column naming the staleness it was raised for when one does.
  await client.query(
    `UPDATE needs_you n SET closed_at = now()
       FROM facts f
      WHERE n.fact_id = f.id AND n.kind = 'deadline' AND n.closed_at IS NULL
        AND NOT (f.verified IS NOT NULL AND f.stale_after IS NOT NULL
                 AND f.stale_after < $1 AND f.valid_to IS NULL)`,
    [today],
  );

  const due = await client.query<{
    id: string;
    path: string;
    title: string;
    space: string;
    stale_after: Day;
  }>(
    `SELECT id, path, title, space, stale_after
       FROM facts
      WHERE verified IS NOT NULL AND stale_after IS NOT NULL
        AND stale_after < $1 AND valid_to IS NULL
      ORDER BY stale_after, path`,
    [today],
  );

  if (due.rows.length === 0) {
    return [];
  }

  const opened = await client.query<{ fact_id: string }>(
    `INSERT INTO needs_you (kind, title, detail, space, entity, fact_id)
       SELECT 'deadline',
              f.title || ' is due for review',
              'Stale since ' || f.stale_after
                || '. Re-confirm against current evidence, or retire it.',
              f.space, f.entity, f.id
         FROM facts f
        WHERE f.verified IS NOT NULL AND f.stale_after IS NOT NULL
          AND f.stale_after < $1 AND f.valid_to IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM needs_you n
             WHERE n.fact_id = f.id AND n.kind = 'deadline'
               AND (n.closed_at IS NULL OR n.closed_at >= $1::date - $2::int)
          )
      RETURNING fact_id`,
    [today, SNOOZE_DAYS],
  );
  const raised = new Set(opened.rows.map((row) => row.fact_id));

  return due.rows.map((row) => ({
    id: row.id,
    path: row.path,
    title: row.title,
    space: row.space,
    staleAfter: row.stale_after,
    raised: raised.has(row.id),
  }));
}
