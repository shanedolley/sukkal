# The checks

The vault's `scripts/check.py` caught a malformed note before a grep came back
empty. KPA ports it in two pieces, split because they disagree on one thing:
whether a finding stops the run.

`src/checks/problems.ts` (KPA-32) ports the six that do: a malformed fact
fails the check and sets a non-zero exit.

This runbook covers `src/checks/advisories.ts` (KPA-34), the four that never
do. An advisory reports and changes nothing. Each function returns the lines
it found as `string[]`; there is no pass or fail to return, because there is
nothing here that could fail.

```ts
import { advisories } from '../src/checks/advisories.ts';

for (const line of await advisories(client)) {
  console.log(line);
}
```

`client` is a connected `pg` client, the same one every other function under
`src/memory/` and `src/checks/` takes. Nothing here opens a connection; see
`src/db/connect.ts`.

## The four

**Orphans.** A fact nothing links to. `shared/` is exempt: the session hook
loads it wholesale every session, so a shared note needs no inbound link to be
found.

**Cross-space links.** A link between two facts in different spaces, neither
of them `shared`. `docs/adr/0006-collibra-koinon-separation-is-a-guideline.md`
accepts the risk this exists to cover: nothing in the database stops a
Collibra fact from citing a Koinon one, so this is the only signal that it
happened. Flagged, never failed, because a register naming the boundary and a
register carrying a fact across it read the same way to a machine, and only a
person can tell which one a given line is.

**Uncompiled sources.** The ratio of sources under `sources/` that no fact
cites, as one line rather than one per source. Each is a bulk import, and most
of them should never become a fact; a lone recent one sitting outside that
ratio is worth a look, the rest are not.

**Review pile-up.** Too many facts sharing one `stale_after` date. The nightly
sweep (`src/memory/sweep.ts`) clears three per run, so a fourth sharing a day
with three others sits waiting regardless of how far past due it is.

## Reading links from `edges`, not from the file again

`check.py` re-read a note's raw text with a regex every time it needed to know
what it linked to. That regex ran three times in the Python original: once for
the shape check, once for orphans, and once for cross-space. Nothing here
re-parses anything. `src/migrate/edges.ts` resolves a link once, at
ingestion, into the `edges` table, and every advisory queries that table.

Two consequences follow from reading a resolved edge rather than a raw
wikilink.

**A source cited only in prose, not a wikilink, still counts as cited.**
`edges.ts` resolves a `sources:` entry with no `[[wikilink]]` in it to
`unresolved`, holding the raw text as a citation kept rather than dropped.
Uncompiled sources reads on `edges.to_id`, which an `unresolved` node has no
child row for regardless of kind, so this makes no difference in practice: a
source is either the target of some edge or it is not.

**A link to a root page cannot resolve to a fact.** The vault treats `index`,
`log`, `CLAUDE` and `README` as valid link targets, and scans each of them for
its own outbound links. The node registry has no `node_kind` for a root page,
so none of the four is ingested as anything, and none of them can be the
`from_id` of an edge. KPA-66 tracks this disagreement; it is not solved here.

It costs orphans two rows against the frozen vault:
`collibra/bhp-unstructured-declined.md` and
`collibra/collibra-meeting-defaults.md` are linked only from `log.md` and
`index.md`. `check.py` scans those two files and finds the links; this reads
`edges`, which holds none from a page that was never ingested, so both read as
orphans here though `check.py` reports neither. Cross-space links and
uncompiled sources are unaffected: a link to a root page resolves to no fact
and no source either way, so it was never going to feed either of those two.
Review pile-up reads `facts.stale_after` directly and never touches a link at
all.

## Review pile-up reads a derived set, not `check.py`'s raw one

`check.py` grouped every note carrying a `stale_after` field, whatever its
date and whether the note had ever been confirmed. `docs/adr/0010` made a
fact's state derived from its dates rather than stored, so this groups the
same set `src/memory/retire.ts` and `src/memory/state.ts` treat as able to go
stale at all: live (`valid_to IS NULL`) and verified at least once, since an
unverified fact is still waiting on its first confirmation and a retired one
will never be reviewed again. It carries no `stale_after < today` the way
`retire.ts`'s own `stale()` does, because pile-up is a scheduling warning
worth raising before the day arrives, not only once it has.

This is a deliberate narrowing from the original, not an oversight: a
`stale_after` on a candidate fact nobody has verified yet, or on a fact
already retired, was never going to reach the nightly sweep, so grouping it
into a pile-up warning would name a collision the sweep will never actually
hit.

## Checked against the frozen vault

The strongest test for this port runs `advisories()` against the frozen vault
(`docs/runbooks/vault-freeze.md`), loaded into `kpa_dev` the same way
`test/edges.test.ts`'s backlinks test does, and compares the result to
`scripts/check.py --review`.

A fresh run of `check.py --review` against the vault at its frozen commit
(`docs/vault-freeze.txt`) reports four `crosses spaces` lines and one
`uncompiled sources` line, repeatable and matching the vault's recorded `HEAD`.
This port reproduces both counts: four cross-space links, and 31 of 32 sources
uncompiled. Orphans diverge by two, for the KPA-66 reason above. Review
pile-up reports nothing on either side; the frozen vault's closest collision is
two facts sharing 2026-11-30, short of the four this check flags at.

`test/advisories.test.ts` skips that comparison, with a `vaultReason` naming
why, on a machine with no vault at `VAULT_PATH` (or the default,
`~/Development/obsidian_vaults/Memory`). The vault lives on Shane's Mac only;
continuous integration has none.
