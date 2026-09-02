-- Gives a fact its review interval as a column, so re-confirming stops
-- compounding it.
--
-- ADR-0017 keeps a fact's own interval when it is re-confirmed, and derived
-- that interval as `stale_after - COALESCE(generated, valid_from)`. The
-- decision is right. The derivation is wrong: the write moves `stale_after`
-- and leaves `generated` where it is, so the span the next write measures is
-- the span the last write created.
--
-- Measured against this code on 2 September 2026, on a fact carrying a 41 day
-- interval, re-confirmed the day after each due date: 41 days granted the
-- first time, then 285, then 571, then 1143. Four confirmations turn six
-- weeks into three years, and each one is years after the last, which is why
-- nobody would catch it in use.
--
-- The interval is a judgement about the world. That is ADR-0017's own
-- argument for keeping it, and a judgement belongs in a column rather than in
-- a subtraction between two dates that move.
--
-- Nullable, and a null means here what it means on `stale_after`: the fact has
-- no review point and never goes stale. So the backfill fills the rows that
-- carry a horizon and leaves the rest null. Inventing a number for a fact
-- nobody gave one to is worse than the null.
--
-- The floor lives here rather than in every caller. A row whose `stale_after`
-- predates its `generated` carries a negative span, and today plus a negative
-- span is a date already past: the fact would leave the review queue and be
-- back in it on the next read, which is the one thing the re-confirm move must
-- never do. The `GREATEST` below floors what the backfill writes, and the
-- constraint floors what every later writer writes.

ALTER TABLE facts
  ADD COLUMN review_interval integer,
  ADD CONSTRAINT facts_review_interval_positive
    CHECK (review_interval IS NULL OR review_interval >= 1);

UPDATE facts
   SET review_interval = GREATEST(stale_after - COALESCE(generated, valid_from), 1)
 WHERE stale_after IS NOT NULL;

COMMENT ON COLUMN facts.review_interval IS
  'How many days one confirmation of this fact is good for. Null means the '
  'fact has no review point and never goes stale, which is what a null '
  'stale_after means. Re-confirming sets stale_after to today plus this '
  'number and leaves this number alone: ADR-0017. Editing stale_after by hand '
  'moves the next review and nothing else. Changing how long every later '
  'confirmation lasts means editing this column.';

-- @down

-- Nothing here needs preserving. Every value the backfill wrote is computed
-- from `stale_after`, `generated` and `valid_from`, and all three stay. The
-- one value this loses is an interval somebody edited by hand, and `down`
-- reverses every migration behind this one and empties the database anyway.
ALTER TABLE facts DROP COLUMN review_interval;
