/**
 * A fact's state: three stored, three derived.
 *
 * ADR-0010 settled this. `candidate`, `proposed` and `rejected` are
 * judgements, so `facts.state` stores them. `verified`, `stale` and `retired`
 * are dates that already live on the row, so this function reads them rather
 * than repeating them in a column that could disagree.
 *
 * `today` is an argument, never a call to `now()` inside here. A fact goes
 * stale because a date passed, so the same row reads differently tomorrow,
 * and passing the day is what lets a test hold that day still.
 */
import type { Day } from './retire.ts';

/** The six states the interface shows. */
export type FactState = 'candidate' | 'proposed' | 'rejected' | 'verified' | 'stale' | 'retired';

/** The columns a state is built from, named as `facts` carries them. */
export interface FactRow {
  state: 'candidate' | 'proposed' | 'rejected';
  verified: Day | null;
  stale_after: Day | null;
  valid_to: Day | null;
}

/**
 * Builds one fact's state as of `today`.
 *
 * Retirement settles the question first: a retired fact reads `retired`
 * whatever `stale_after` says, because `valid_to` is the later, deliberate
 * word. Staleness only applies past that check, and only to a verified fact --
 * an unverified one has nothing to have gone stale from.
 */
export function factState(fact: FactRow, today: Day): FactState {
  if (fact.valid_to !== null) {
    return 'retired';
  }
  if (fact.verified !== null) {
    return fact.stale_after !== null && fact.stale_after < today ? 'stale' : 'verified';
  }
  return fact.state;
}
