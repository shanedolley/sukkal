# The vault's status becomes fact_state

ADR-0010 replaced `fact_status` (`draft`, `stable`, `deprecated`) with
`fact_state` (`candidate`, `proposed`, `rejected`) and reserved the
translation between them to KPA-5. Every one of the 19 notes in the frozen
vault carries `status: stable`. We translate `draft` to `candidate`, `stable`
to `proposed`, and `deprecated` to `rejected`, in `src/vault-mapping.ts`,
on the way into the reader KPA-5 writes.

The two vocabularies answer different questions, but they still sit on one
spectrum. A `draft` note is unfinished, so it is closest to a candidate still
waiting on the four gates. A `stable` note is finished, Shane-maintained
content, which is closer to what `proposed` already means: something that has
cleared a bar and is waiting on Shane's yes or no. A `deprecated` note is
content Shane no longer trusts, which is what `rejected` already means.

## Considered Options

1. **`stable` becomes `candidate`.** Treats every migrated note as raw,
   ungated material. Rejected because it discards the months of curation the
   vault already did and sends 17 already-trusted notes back through gates
   built for material nobody has looked at yet.
2. **`stable` becomes `verified`, by setting `verified`/`verified_by` during
   the migration.** Rejected on two counts. `fact_state` has no `verified`
   value to store -- ADR-0010 reads it off the `verified` column instead. And
   naming a `verified_by` for 17 notes nobody individually reviewed in this
   run would claim a review that did not happen.
3. **`stable` becomes `proposed`.** Chosen. It puts every migrated note into
   the same review queue Shane already checks, so migrated content surfaces
   exactly like new pipeline output.

## Consequences

- The first run over the frozen vault adds 17 facts to the "Proposed facts"
  queue, all waiting on Shane's confirm or decline.
- `draft` and `deprecated` get a translation even though the frozen vault
  carries neither. A later vault that does carry them lands correctly without
  anyone revisiting this file.
