# The engine's default denial is a row, not a special case

`policies` gains `deny-by-default`, and every denial the engine cannot pin on
one of the brief's four rules names it. Decided 2 September 2026.

ADR-0005 requires the policy engine to deny on failure. Four failures do so: an
empty table, a database error, an action no rule describes, and a malformed
row. The brief's four rules name none of them.

`audit_denial_names_a_rule` refuses a denial that names no rule, and
`audit.rule` is a foreign key into `policies`. So a denial the engine cannot
attribute is a denial the safety net cannot record, which is the exact silence
the audit log exists to prevent.

## Considered Options

1. **Name one of the four** - no migration, no new row. Rejected because it is
   false. The audit screen renders the rule's own words, so a refusal to cancel
   a meeting would read "a message leaves the box only after Shane clicks
   send".
2. **Return a denial naming no rule** - no migration either. Rejected because
   the check constraint refuses the row, so the denial happens and nothing
   records it.
3. **Seed a fifth row for the default** - chosen.

## Consequences

- The brief still names four rules. This row describes what the engine does
  when it cannot read them, so the table in `docs/schema.md` gains a column
  naming the migration that seeded each row rather than a fifth rule.
- It is absolute. A default Shane can switch off is a policy layer that fails
  open, which ADR-0005 says is not a policy layer.
- An empty `policies` table still denies, and that denial still cannot be
  recorded, because the key it names is one of the rows that went missing. The
  engine is correct and the log is silent. Only restoring the table fixes it.
- Migration 012 reverses by deleting the row while nothing cites it, and leaves
  it for 005 otherwise. A guard that raised would fail on every database that
  ever recorded a default denial, and it would fail first, so `migrate down`
  would never reach the migration that can succeed. The agent that wrote the
  migration found this by running the reversal rather than by reading it.
- One broken row denies every action, not only the action its rule governs. A
  partial table cannot say whether the damaged row is the one that would have
  judged this action, so the engine treats the whole table as unreadable.
