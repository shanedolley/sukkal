# KPA reads nabium's database read-only

Nabium captures and transcribes meetings on Shane's Mac; KPA needs that material
on amaterasu. We chose to have nabium push a session id over the LAN and KPA read
the detail from nabium's Postgres through a read-only role, rather than design an
API between two personal projects that only ever talk to each other.

Push carries the trigger, not the payload. A missed push costs nothing, because
KPA can replay from nabium's database at any time.

## Considered Options

1. **A documented HTTP API** - keeps both independently releasable, which matters
   if nabium ever ships as a product. Rejected for now: nabium is a personal
   tool, and an API is two sides to build and version for one consumer.
2. **A shared database with separate schemas** - no sync problem and no
   duplicated entities, at the cost of coupling both projects' release cycles and
   pinning nabium's database to amaterasu.
3. **Ingest via the Obsidian vault nabium already writes to** - reuses an
   existing path, but makes a markdown folder a load-bearing pipe between two
   databases.

## Consequences

- KPA breaks when nabium migrates its schema. Two mitigations: KPA reads through
  views it defines rather than nabium's base tables, and nabium's migration
  runbook gains a step naming KPA as a consumer.
- If nabium ever becomes a product, this decision is the first thing to unwind,
  and ADR-0003 in nabium's own repository should point back here.
- KPA owns entity resolution. Nabium's `people` and `engagements` merge into
  KPA's, because KPA also sees mail and mail is the wider source of people.
