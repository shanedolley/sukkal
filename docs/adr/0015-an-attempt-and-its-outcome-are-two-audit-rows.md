# An attempt and its outcome are two audit rows

The agent writes one audit row before it acts and a second when it knows what
happened, paired by the attempt's id. Neither row is ever updated, so the
append-only guarantee holds unchanged. Decided 2 September 2026.

The brief's own sequence asks for this: it writes the intent and the state
before first, then the outcome and the reversal after. The schema made that
impossible. `outcome`, `result` and `reverse` are all `NOT NULL`, and two
triggers refuse every `UPDATE`, `DELETE` and `TRUNCATE`, so a row cannot be
started and finished.

## The window this closes

An action can fail in three places, and only one of them was covered.

The agent decides, calls Gmail, and writes the outcome. If the process dies
after the call is issued, the label exists and nothing recorded that anything
was attempted. Shane later finds a label he did not expect, opens the safety
net, and it is silent.

That silence is the failure the audit log exists to prevent. Nothing approves
an action in advance, so an unrecorded action is an action nobody can find.

## An orphaned attempt is the most valuable row in the log

This is the argument that decided it. Under one row, a crash leaves nothing.
Under two, it leaves an attempt with no outcome, which says exactly the right
thing: something was tried and we do not know how it ended.

That row raises a needs-you item, so it reaches the briefing rather than
waiting for somebody to read a table. It is the only kind of audit entry that
asks Shane a question.

## Considered Options

1. **One row, written after the fact** - half the rows, one insert per action,
   and every read is a single select. Rejected because it cannot express an
   attempt whose outcome is unknown, and that is the state worth knowing about.
2. **One row, started and completed** - the shape the brief describes. Rejected
   because completing it needs an `UPDATE`, and the append-only trigger is a
   guarantee this project proved by breaking it on purpose. Relaxing it to
   record uncertainty trades a certainty for a convenience.
3. **Two rows, paired by an attempt id** - chosen.

## Consequences

- `audit` gains an attempt id and an `attempted` value on its outcome type.
  `result` and `reverse` stay `NOT NULL`: an attempt row says what it meant to
  do and how it would be reversed, both of which are known before acting.
- The table roughly doubles. At a few actions a day that is nothing, and the
  index the screen reads by already carries the outcome.
- Every read pairs the two rows. The screen shows one entry per attempt, and
  an attempt with no outcome renders as its own state rather than as a gap.
- A worker that dies mid-action leaves the pairing job to find. That sweep is
  part of the nightly review, alongside the staleness sweep.
- The append-only triggers are untouched. Two rows is what preserving them
  costs, and preserving them is the point.
