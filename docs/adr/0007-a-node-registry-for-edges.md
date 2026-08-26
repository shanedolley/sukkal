# A node registry, so edges can carry real foreign keys

An edge points at a fact, a source, an entity, an external URL, or a wikilink
whose target does not exist. Postgres cannot enforce a foreign key against a
column whose target table varies by row, and `edges` is the one table every
later slice traverses. So `facts`, `sources` and `entities` take their `id` from
a `nodes` registry, and `edges` carries two ordinary foreign keys into it.

A broken link stops being a dangling number. It becomes a `nodes` row of kind
`unresolved` holding the raw text of the wikilink, which is a fact about the
vault rather than a defect in the database.

## Considered Options

1. **A polymorphic `target_id` with a discriminator column** - one table, no
   registry, trivial to write. Rejected because Postgres can enforce nothing on
   it. The table every later slice traverses would carry no integrity at all,
   and a dangling edge is a lost fact that nothing reports.
2. **A nullable foreign key column per target kind** - real constraints, no
   extra table. Rejected because five nullable columns and a check constraint
   make every recursive traversal harder to read, and traversal is what ADR-0001
   chose Postgres for.
3. **No constraint, and check the graph in application code** - cheapest to
   build. Rejected on the same grounds the four gates are being moved out of
   prompts: a rule that lives only in code that remembers to call it is a rule
   that eventually is not called.

## Consequences

- **Two constraints keep `kind` honest, and they cover opposite directions.**
  Each child table carries a `node_kind` column fixed to its own value by a
  check, and a composite foreign key into `nodes (id, kind)`. That stops a node
  of one kind being claimed by another's table, and stops one id being claimed
  by two tables. It cannot see a `nodes` row of kind `fact` with no `facts` row,
  so a deferred constraint trigger covers that at commit time.

- **Every insert is two statements.** The `nodes` row is written first, then the
  child row. Inside one transaction the order does not matter, because the
  trigger is deferred, but the down migration removes children before the
  registry and that order does matter.

- **Traversal is honest about its cost.** Walking `edges` through `nodes` to get
  a chain of ids and kinds is a plain join. Recovering what was traversed, a
  fact's title or a source's path, needs a further join dispatched on
  `nodes.kind`: three joins and a coalesce rather than one. That is still
  cheaper than the alternatives, and it is written here so the schema story does
  not rediscover it.

- **A wikilink that resolves to nothing costs a row.** `nodes.ref` holds the raw
  link text, so the broken-link count is a query rather than a scan, and the
  link starts working the moment the note it names arrives.

- **This is expensive to reverse.** Every table's primary key derives from
  `nodes`, so changing the approach later is a migration of the whole schema and
  of everything referencing it. That is why it is settled in slice one, before
  any volume reaches the database.
