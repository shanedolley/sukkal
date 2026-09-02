# Re-confirming a fact keeps its own review interval

A re-confirmed fact's new `stale_after` is today plus the span that fact
already carried, measured from when it was generated to when it first fell due.
A fact carrying no `stale_after` gets none and never goes stale. Decided
2 September 2026, closing the question ADR-0010 left open.

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
3. **Keep the fact's own interval** - chosen. The arithmetic is one subtraction
   and one addition, over a number already on the row.

## Consequences

- A fact with no `stale_after` stays without one. `check.py` already holds that
  rule, and its own selftest asserts a note with no `stale_after` is not stale.
- The interval derives from `stale_after` minus `generated`, so it lives in the
  data rather than needing a column. A fact whose `generated` is null measures
  from `valid_from` instead.

  **This consequence is wrong, and KPA-122 measured it on 2 September 2026.**
  The data holds the interval once. The write moves `stale_after` and leaves
  `generated` where it was, so the span grows on every re-confirmation after
  the first. A fact carrying a 41 day interval is granted 41 days the first
  time, correctly, and 281 days the second time, because the row now spans 281
  days. Two more confirmations and a fact judged to hold for six weeks holds
  for years. That is a memory quietly deciding to stop asking, which is the
  failure this whole document exists to prevent.

  The decision above stands. A fact keeps its own interval, and the sixteen
  vault intervals stagger the queue for free. Only this derivation is wrong.
  The interval is a judgement about the world, which is this document's own
  argument, and a judgement deserves a column rather than a subtraction between
  two dates that move. KPA-133 adds `facts.review_interval`, backfilled as
  `stale_after - COALESCE(generated, valid_from)`, which is what this document
  already says the interval is.

  Until it lands, `apps/web/lib/facts.ts` carries the stated formula and a
  `ponytail:` comment naming the ceiling. The first re-confirmation of any fact
  is correct, and at these intervals the second is years away.
- Shane can still change a horizon by editing the fact, which is where a
  judgement about the world belongs.
- The staleness sweep needs no change. It reads dates and raises items, and
  this decision only touches the write the re-confirm control makes.
- KPA-13's diff is unaffected. Re-confirmation is a human action the vault
  performed by editing frontmatter, and the interval preserved here is the one
  the vault recorded.
