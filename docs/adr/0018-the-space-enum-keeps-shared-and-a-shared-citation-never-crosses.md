# The space enum keeps shared, and a shared citation never crosses

The database keeps all four spaces, the interface learns the fourth, and
`crosses()` stops counting `shared`. Decided 2 September 2026.

The interface has known three spaces since it was drawn, while `space` has held
four since migration 001. Every story that touched a space column deferred the
question. This settles it, and the answer is not a tidy-up: the interface is
missing a value that means something, and the crossing rule is wrong because of
it.

## What shared is for

The vault's own `CLAUDE.md` says it: `shared/` holds "how Shane works,
regardless of which hat: preferences, accounts, tooling", and it is the space
"which either side may cite."

Four facts live there today. How he drafts email by default, the three Google
Workspace accounts, his pronouns, and the Salesforce CLI. None of them belongs
to Collibra or to Koinon, and both need all four.

That is the whole point of the value. `shared` is not a fourth silo beside the
other three. It is the space the wall does not divide.

## The bug this fixes

`crosses()` counts distinct spaces, so it reads a Collibra answer citing a
shared fact as a crossing:

```
crosses(["collibra"])            false
crosses(["collibra", "koinon"])  true
crosses(["collibra", "shared"])  true   <- wrong
```

An answer that cites how Shane drafts email while answering a Collibra question
has crossed nothing. Flagging it teaches Shane that the flag means nothing,
which costs him the one signal that a real boundary was crossed. The brief
makes that flag the only guard the Collibra and Koinon wall has, since nothing
in the database enforces it.

## Considered Options

1. **Drop `shared` and give its four facts a space** - three values everywhere,
   one type, no branch. Rejected because there is no honest space to give them.
   Shane's pronouns are not Collibra's and not Koinon's, and picking one makes
   every answer from the other side either miss them or cross a wall to reach
   them.
2. **Keep four values and leave `crosses()` alone** - no code changes at all.
   Rejected because it is the state today, and it flags four facts that both
   sides are meant to cite.
3. **Keep four, teach the interface, and exclude `shared` from the rule** -
   chosen.

## Consequences

- `Space` in the interface gains `shared`, and so does its label map. Every
  screen that renders a space badge renders a fourth.
- `crosses()` counts distinct spaces among Collibra, Koinon and personal, and
  ignores `shared`. `apps/web/scripts/check-space.ts` gains the case, so the
  rule cannot regress into flagging a shared citation again.
- The space filter has a decision of its own: whether filtering to Collibra
  shows shared facts too. It should, for the same reason the crossing rule
  ignores them, and the story that changes the filter records it.
- The three-value assumption is load bearing in more places than the type.
  `SPACE_LABELS`, the space switcher's options and `inSpace` all need the
  fourth, and a fact in `shared` is invisible under every filter until they
  have it.
- `personal` stays a space the wall does divide. Nothing here changes it.
