/**
 * The staleness sweep.
 *
 * ADR-0010 makes `stale` a derived state: `verified IS NOT NULL AND
 * stale_after < today AND valid_to IS NULL`. Nothing stores it, so the sweep
 * has nothing to correct if it fails halfway. **It raises a review item and
 * changes no state at all.** `src/memory/retire.ts` already says the sweep
 * reads and never writes `valid_to`; this file is the reason it exists.
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
  /** True when this run opened a new needs_you item; false when one was
   *  already open, so the fact is reported but not raised twice. */
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
 * One statement lists what is due; a second opens what is not already open,
 * guarded by its own `NOT EXISTS`, so the same fact never gets a second open
 * item for the same staleness. Both read `stale_after < $1`, matching
 * `factState`'s derivation: a fact whose `stale_after` falls today is not yet
 * stale. `retire.ts` read `<=` until 2 September 2026, when it was reconciled
 * to ADR-0010 alongside this file. The three now agree, which is what lets
 * KPA-13 diff one report against the vault's.
 *
 * ponytail: two statements against a `NOT EXISTS` guard, not a unique
 * constraint, so two sweeps running at once could each open a row. A nightly
 * job never overlaps itself; add the constraint if that stops being true.
 *
 * ponytail: `facts.entity` is nullable (ADR-0014; nothing resolves a fact to
 * one yet), and `needs_you.entity` is not, so a due fact with no entity set
 * fails this whole statement rather than only that row. Nothing calls
 * `sweep()` outside a test today, so this has nothing live to break; give the
 * entity-resolution slice this comment once it schedules the sweep for real.
 */
export async function sweep(client: ClientBase, today: Day): Promise<StaleFact[]> {
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
             WHERE n.fact_id = f.id AND n.kind = 'deadline' AND n.closed_at IS NULL
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
