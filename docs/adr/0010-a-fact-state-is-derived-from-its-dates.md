# A fact's state is derived from its dates

The interface shows a fact in one of six states: candidate, proposed, verified,
stale, retired, and rejected. The database will store three of them. The other
three are read from the date columns `facts` already carries, because those
columns already hold the answer. Decided by Shane on 1 September 2026.

```
STORED   fact_state: candidate | proposed | rejected

DERIVED  verified = verified IS NOT NULL
         stale    = verified IS NOT NULL
                    AND stale_after < today
                    AND valid_to IS NULL
         retired  = valid_to IS NOT NULL
```

This replaces `fact_status`, whose three values are `draft`, `stable`, and
`deprecated`. That enum came from the Obsidian vault, where it described how
finished a note was. It answers a different question from the one the review
queue asks, and it has no word for a fact waiting on Shane, which is the state
the whole product turns on.

## Why not store all six

`facts` already carries `verified`, `verified_by`, `stale_after`, `valid_from`,
and `valid_to`. A status column repeating them is a second copy of a truth the
table already holds, and two copies of one truth eventually disagree.

The disagreements are not hypothetical. A row reading `state = 'stale'` with
`stale_after` a year away is legal, and so is `state = 'verified'` with a
`valid_to` in the past. Both are wrong, neither is refused, and a reader cannot
tell which column lied.

The staleness sweep is the sharpest case. It runs nightly and moves facts into
review. Storing what it decides lets a sweep that fails halfway leave the table
asserting a staleness the dates deny. Deriving it means the sweep raises the
review item and changes no state at all, so a crash costs a night rather than a
correction.

## Considered Options

1. **Six stored states** - replace `fact_status` with the interface's six
   values, and let the interface read one column with no translation. The
   cheapest to build and the simplest to read. Rejected because the status and
   the dates then hold the same truth twice, and constraints tying each state to
   its dates cost most of what deriving costs anyway, while still leaving the
   sweep able to write a state its dates contradict.
2. **Keep the three and add a second column** - `fact_status` stays as the
   vault's note maturity, and a new column carries the review queue. Nothing
   already migrated changes. Rejected because it puts two status columns on one
   table, and every later reader has to learn which one answers their question.
   Nothing reads `fact_status` once the vault retires, so the column it protects
   has no consumer.
3. **Derive the three the dates already answer** - chosen.

## Consequences

- Reading a fact's state costs a query rather than a column. A view or one
  helper builds it, and every screen reads it there. The interface keeps its six
  values, so no screen changes.
- Today is an input. A fact goes stale because a date passed, so the same row
  reads differently tomorrow. Whatever builds the state takes the day as an
  argument rather than calling `now()` inside itself, which is what makes it
  testable.
- Retirement stays a date and never a delete, which the brief already required.
  This decision extends the same rule to staleness and verification.
- `rejected` stays stored, because a rejection is a judgement rather than a
  date. Its reason lives in `rejections`, so a later run reads the reason and
  raises no duplicate.
- The check constraint `facts_machine_never_verifies` keeps working unchanged.
  It guards `verified_by`, which is a column this decision makes more load
  bearing rather than less.
- KPA-5 writes the vault parser against this vocabulary, so it maps the vault's
  `draft`, `stable` and `deprecated` on the way in and writes the enum once.
  Deciding before that story starts is why this ADR exists now.
- Re-confirming a stale fact has to move `stale_after` forward. Under a stored
  state, setting `verified` would have been enough. Under a derived one, a fact
  whose `stale_after` stays in the past is stale again the moment it is saved.
  The interval that sets the new date is undecided, and this ADR does not settle
  it.
