# Re-confirming a fact keeps its own review interval

A re-confirmed fact's new `stale_after` is today plus the interval that fact
carries in `facts.review_interval`, which is the span it was first given: from
when it was generated to when it first fell due. A fact carrying no
`stale_after` gets none and never goes stale. Decided 2 September 2026,
closing the question ADR-0010 left open, and amended the same day by KPA-133,
which moved the interval out of the dates and into a column.

## The vault already answered this

The sixteen dated facts in the frozen vault carry sixteen different intervals:
41, 43, 81, 88, 102, 109, 116, 126, 186, 187, 192, 223, 252, 365, 396 and 426
days. Not one is repeated.

That is not noise. Somebody chose each one, because how long a fact stays true
depends on the fact. A contract term holds for a year. A person's role holds
until they move. The interval is a judgement about the world, and every fact
that has one already records it.

Re-confirming means the judgement still holds. Keeping the interval keeps the
judgement. Replacing it with a constant discards sixteen decisions to save
writing one subtraction.

## Why a fixed interval is worse than it looks

The obvious answer is today plus ninety days. The brief already rejects it
under *A fact's life*: a batch given the same horizon on one afternoon all
falls due on the same afternoon three months later, and a review queue that
arrives in one lump is a review queue nobody works.

The vault's intervals stagger themselves because they were chosen separately.
Preserving them preserves the staggering for free.

## Considered Options

1. **Today plus a fixed interval** - one number, no arithmetic, every fact
   treated alike. Rejected on the pile-up above, and because it discards the
   only record of how long each fact was thought to hold.
2. **Ask Shane for a new date on every re-confirmation** - the most accurate
   answer available. Rejected because the re-confirm control exists to make the
   queue cheap to work, and a date picker on every row makes it expensive
   enough to skip. A queue nobody works is the failure this whole loop guards
   against.
3. **Keep the fact's own interval** - chosen. The arithmetic is one addition,
   over the number the row records. This document first read that number back
   out of two dates rather than storing it, which is the amendment below.

## Consequences

- A fact with no `stale_after` stays without one. `check.py` already holds that
  rule, and its own selftest asserts a note with no `stale_after` is not stale.
- The interval is a column. `facts.review_interval` holds it, in days.
  Migration 013 added it and backfilled it as
  `stale_after - COALESCE(generated, valid_from)`, floored at one day, which is
  what this document says the interval is. A fact whose `generated` is null
  measures from `valid_from`, and a fact with no `stale_after` was left null
  rather than given a guess. `apps/web/lib/facts.ts` adds that number to today
  and changes nothing else.

  **This document first derived the interval instead, and the derivation
  compounded.** KPA-122 measured it on 2 September 2026, and KPA-133 reproduced
  it before removing it. The write moves `stale_after` and leaves `generated`
  where it was, so each confirmation measured the span the last one created. A
  fact carrying a 41 day interval, re-confirmed the day after each due date,
  was granted 41 days, then 285, then 571, then 1143. KPA-122 measured 281 for
  the second grant because it re-confirmed on a different day: the span
  swallowed every day since `generated`, so the error grew with the delay as
  well as with the count. Four clicks turn six weeks into three years. That is
  a memory quietly deciding to stop asking, which is the failure this whole
  document exists to prevent, and two confirmations sit years apart, which is
  why the cost arrives long after the mistake.

  The decision above never moved. A fact keeps its own interval, and the
  sixteen vault intervals stagger the queue for free. Only the derivation was
  wrong. The interval is a judgement about the world, which is this document's
  own argument, and a judgement deserves a column rather than a subtraction
  between two dates that move.
- Shane can still change a horizon by editing the fact, and the two columns
  divide that judgement between them. `stale_after` says when the next review
  falls. `review_interval` says how long one confirmation lasts. So a hand edit
  to `stale_after` moves the next review and nothing else, and changing how
  long every later confirmation lasts means editing `review_interval`.

  KPA-133 settled which one wins where they disagree: the column wins the
  arithmetic, always. Reading an interval back out of a date that the write
  itself moves is the defect above in a slower form, and a hand edit is the row
  where such a guess is most likely wrong.

  One row stays awkward, and that is what this rule costs. Migration 013 filled
  every row carrying a horizon, so a fact holding a `stale_after` and no
  `review_interval` can arrive only from a later writer or a hand edit. Nobody
  has said how long a confirmation of it lasts, so the store writes nothing and
  the screen reports a move that had already happened, which is the wrong words
  for the right refusal. Whoever writes the next `stale_after` gives it an
  interval in the same statement.
- The staleness sweep needs no change. It reads dates and raises items, and
  this decision only touches the write the re-confirm control makes.
- KPA-13's diff is unaffected. Re-confirmation is a human action the vault
  performed by editing frontmatter, and the interval preserved here is the one
  the vault recorded.
