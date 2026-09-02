# A question is a kind of needs-you item

The briefing's Needs you region carries four kinds: a draft waiting to send, a
question waiting for an answer, an action the policy refused, and a deadline
coming. One of the four already had a table, `questions`, created by
migration 001 for the vault's `index.md`. `migrations/006_needs_you.sql` folds
it into `needs_you` and drops it. Decided on 2 September 2026, while building
KPA-62.

The screen reads all four kinds as one list, ordered by when each arrived. Two
tables cannot serve one ordered list without a union on every read, and one of
the two could not answer the question the screen asks.

## Why `questions` could not stay

Every row on that screen shows a space and an entity. `questions` holds
neither. It carries `fact_id`, `question`, `answer`, and `asked`, so both
values would have to come from a join to `facts`.

That join fails twice. `facts` carries no `entity` column, and adding one
belongs to a story nobody has written. And `questions.fact_id` is nullable, so
a question attached to no fact would have nowhere to read either value from
even after that column exists.

A second table that answers the screen's question only partly is the outcome
this work set out to avoid rather than to build.

## Considered Options

1. **Keep `questions` and join to `facts`** - the smallest change, and it
   leaves migration 001's schema alone. Rejected on the two failures above.
   The join cannot supply `entity` today and cannot supply either value for a
   question with no fact.
2. **Keep `questions` and add `space` and `entity` to it** - makes the join
   unnecessary. Rejected because it duplicates four columns of `needs_you` on a
   table holding one of its four kinds, and every later change to the queue's
   shape then lands twice.
3. **Fold it in and drop the table** - chosen.

## Consequences

- A question closes the way every other needs-you row closes, by setting
  `closed_at`. The old comment on `questions` said a question closes by writing
  its answer into the fact. Both remain true: the answer still reaches the
  fact, and the queue row still closes.
- The table is empty today, so nothing is lost. KPA-8 created it when the
  vault's `index.md` held headers and no rows, and KPA-5 has not run.
- The migration refuses to drop a `questions` table holding rows, and names
  what to do instead. Once rows exist there is no honest way to give them an
  `entity`, and inventing one is the guess the vault's own rule forbids.
- **KPA-5 inherits this.** The vault's `index.md` now holds two answered
  questions, and the story that reads the vault writes them into `needs_you`
  rather than into a table that no longer exists.
- `docs/schema.md` loses a table and gains one. The three-layer table in the
  brief still reads correctly, because `questions` was never one of the three
  layers it names.
- Reversing this recreates `questions` empty. Mapping `needs_you` rows back
  would fabricate questions from rows that were never questions, which is the
  same reason `003_fact_state.sql` returns its old column nullable rather than
  filling it.
