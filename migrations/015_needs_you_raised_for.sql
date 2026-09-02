-- Records which staleness a deadline review item was raised for.
--
-- KPA-85 left two approximations standing in place of this column. The sweep
-- closes an open item whose fact has stopped being stale, and SNOOZE_DAYS kept
-- a closed item quiet for thirty days. Between them they answered the question
-- this column answers exactly: has this staleness already been raised?
--
-- The pair leave one sharp edge. A fact whose review interval is shorter than
-- the snooze goes stale again while its last item is still quiet, so it waits
-- out the difference. The vault's shortest interval is 41 days, so nothing
-- waits today, and KPA-133 gave every fact its own interval. The first fact
-- somebody judges worth reviewing monthly is the one that would wait.
--
-- Nullable, because a null says this row was raised for no staleness. Every
-- kind but `deadline` reads null and the constraint holds it there. A
-- `deadline` row naming no fact reads null too, which the backfill below
-- leaves alone rather than inventing a date for.

ALTER TABLE needs_you
  ADD COLUMN raised_for date,
  ADD CONSTRAINT needs_you_raised_for_is_a_deadline
    CHECK (kind = 'deadline' OR raised_for IS NULL);

-- The backfill fills the open rows and stops there. An open row's fact is
-- still stale, so the `stale_after` it carries now is the one the row was
-- raised for. A closed row's is not: the sweep closes a row because its fact
-- stopped being stale, so today's `stale_after` is the next staleness rather
-- than the raised one, and writing it here would claim that staleness was
-- already raised and stop the next sweep raising it. Leaving it null costs one
-- extra row on the first night after this migration. Writing the wrong date
-- costs the review itself.

UPDATE needs_you n
   SET raised_for = f.stale_after
  FROM facts f
 WHERE n.fact_id = f.id AND n.kind = 'deadline' AND n.closed_at IS NULL;

COMMENT ON COLUMN needs_you.raised_for IS
  'The stale_after this deadline row was raised for. Null on every other '
  'kind. It is what stops one staleness raising twice and lets the next one '
  'raise at all.';

-- @down

-- The constraint goes with the column, so naming it here would drop it twice.
ALTER TABLE needs_you DROP COLUMN raised_for;
