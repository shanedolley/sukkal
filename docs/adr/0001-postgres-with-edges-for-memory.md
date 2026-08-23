# Postgres with typed edges for the memory graph

The assistant's memory is a graph: people, customers, engagements, systems and
the facts connecting them. We chose PostgreSQL with an `edges` table, pgvector
for embeddings, and recursive CTEs for traversal, rather than Neo4j, because the
queries KPA actually runs are bounded neighbourhood queries ("everything about
Meridian and its immediate people and decisions") rather than open-ended path
finding, and Postgres answers those in milliseconds at this scale while also
serving as the application store and the pg-boss job queue.

## Considered Options

1. **Neo4j Community** - Cypher is genuinely better for unbounded traversal, but
   Community edition has no role-based access control, adds a JVM to a box with
   7.6 GB of RAM, and would be a second store to keep in step with the
   application database.
2. **Neo4j Enterprise** - has the access controls, at a price that a personal
   project cannot justify.
3. **Apache AGE** - Cypher inside Postgres, so one engine and one security
   model. Less mature than either parent, and rated a fallback rather than a
   plan.

## Consequences

- Row-level security on the `space` column was the original tiebreaker, chosen
  to make a Collibra-into-Koinon leak structurally impossible. ADR-0006 later
  reduced that separation to a guideline, so this tiebreaker no longer applies.
  The decision stands on the arguments above, and this note records the change
  rather than hiding it.
- Multi-hop traversal is written by hand as recursive CTEs. If KPA ever needs
  genuine path finding or community detection, this decision is the one to
  revisit.
- Nabium already runs Postgres with pgvector, so the operational knowledge and
  the backup runbook already exist.
