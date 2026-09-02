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

export interface StaleFact {
  id: string;
  path: string;
  title: string;
  space: string;
  staleAfter: Day;
  /** True when this run opened a new needs_you item. False when one already
   *  names this staleness -- open or closed -- so the fact is reported and
   *  not raised twice. */
  raised: boolean;
}

/**
 * Every live, verified fact past `stale_after` as of `today`, oldest first.
 *
 * Each one gets a `needs_you` row of kind `deadline`, unless a row already
 * names that staleness. `docs/schema.md`'s four kinds are a draft, a
 * question, a denied action, and a deadline coming; a fact whose review date
 * has passed is that fourth kind; the codebase's own words for this state,
 * "past their review date" and "falls due", are a deadline's words.
 *
 * Three statements. The first closes an item whose fact has stopped being
 * stale. The second lists what is due. The third opens what no item already
 * covers, guarded by its own `NOT EXISTS`. All three read `stale_after < $1`,
 * matching `factState`'s derivation: a fact whose `stale_after` falls today
 * is not yet stale. `retire.ts` read `<=` until 2 September 2026, when it was
 * reconciled to ADR-0010 alongside this file. The three now agree, which is
 * what lets KPA-13 diff one report against the vault's.
 *
 * **The guard is an exact match on `raised_for`, and it reads closed items as
 * well as open ones.** One staleness raises one item, whatever becomes of it,
 * and the next staleness raises a fresh one the night it arrives. So closing
 * an item without re-confirming the fact settles that review: the fact
 * returns when its `stale_after` moves, which is what a re-confirmation or a
 * hand edit does, and KPA-134 chose that over the thirty day snooze it
 * replaces. The snooze made a fact reviewed more often than monthly wait out
 * the difference before it could raise again.
 *
 * `raised_for` and `stale_after` are both `date`, and the guard compares them
 * in SQL. Nothing here parses a calendar date into a `Date`, which is the
 * conversion that reads a Sydney date a day west.
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
  // retiring sets `valid_to`, and neither closes the item: nothing else in the
  // codebase closes a needs_you row, and `apps/web/lib/needs-you.ts` only
  // reads the open ones. Without this the briefing keeps asking Shane to
  // review a fact he re-confirmed last night, or one he retired.
  //
  // The guard below no longer needs this statement. It did while an open item
  // stood for the fact rather than for one staleness, because an item left
  // open forever then read as covering the fact's next staleness too.
  // `raised_for` names one date, the next staleness is a different date, and
  // an item nothing closed stops nothing from raising. So this survives for
  // the screen alone, and `test/sweep.test.ts` is what holds it there: two
  // tests read the open items after a fact stops being stale, and both fail
  // if this statement goes.
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
    `INSERT INTO needs_you (kind, title, detail, space, entity, fact_id, raised_for)
       SELECT 'deadline',
              f.title || ' is due for review',
              'Stale since ' || f.stale_after
                || '. Re-confirm against current evidence, or retire it.',
              f.space, f.entity, f.id, f.stale_after
         FROM facts f
        WHERE f.verified IS NOT NULL AND f.stale_after IS NOT NULL
          AND f.stale_after < $1 AND f.valid_to IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM needs_you n
             WHERE n.fact_id = f.id AND n.kind = 'deadline'
               AND n.raised_for = f.stale_after
          )
      RETURNING fact_id`,
    [today],
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
