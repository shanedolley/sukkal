# Sukkal reads nabium's database read-only

**Status: superseded by ADR-0013.**

Nabium captures and transcribes meetings on Shane's Mac; Sukkal needs that material
on amaterasu. We chose to have nabium push a session id over the LAN and Sukkal read
the detail from nabium's Postgres through a read-only role, rather than design an
API between two personal projects that only ever talk to each other.

Push carries the trigger, not the payload. A missed push costs nothing, because
Sukkal can replay from nabium's database at any time.

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

- Sukkal breaks when nabium migrates its schema. Two mitigations: Sukkal reads through
  views it defines rather than nabium's base tables, and nabium's migration
  runbook gains a step naming Sukkal as a consumer.
- If nabium ever becomes a product, this decision is the first thing to unwind,
  and ADR-0003 in nabium's own repository should point back here.
- Sukkal owns entity resolution. Nabium's `people` and `engagements` merge into
  Sukkal's, because Sukkal also sees mail and mail is the wider source of people.
