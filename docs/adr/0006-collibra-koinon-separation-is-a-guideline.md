# The Collibra and Koinon separation is a guideline

The Memory vault's hardest rule is that Collibra and Koinon notes never cite each
other: an employer's customer material and Shane's own commercial figures stay
apart. Sukkal keeps that rule as a guideline rather than a database constraint.
Retrieval filters by space by default and the interface flags any answer drawing
on both, but nothing structurally prevents a crossing. Decided by Shane on 23
August 2026, after row-level security was offered.

## Considered Options

1. **Row-level security on the `space` column** - a query that forgets the filter
   returns nothing rather than leaking, which makes the failure impossible rather
   than merely discouraged. Costs some schema complexity and a session variable
   on every connection.
2. **A wall on output only** - reasoning across everything internally, with the
   constraint applied where content leaves: a drafted Koinon email can never
   carry Collibra customer content.

## Consequences

- One prompt failure can put employer customer material into a Koinon answer.
  This is the single largest unmitigated risk in the project.
- ADR-0001 chose Postgres over Neo4j partly because Postgres could enforce this
  boundary and Neo4j Community could not. That tiebreaker is now void. ADR-0001
  still holds on its other arguments and records the correction.
- Option 1 remains available later. Adding row-level security to an existing
  schema is a migration rather than a rewrite, so this is reversible in a way
  that ADR-0004 is not.
