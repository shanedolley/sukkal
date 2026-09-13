# A root page is not a node, and the drift it leaves is two lines

The vault's four root pages, `index`, `log`, `CLAUDE` and `README`, take no row
in the node registry. A wikilink naming one resolves `unresolved`, and the two
advisory lines it costs KPA-13 are recorded rather than removed. Decided
2 September 2026.

`scripts/check.py` resolves a wikilink against every note in a space, every file
under `sources/`, and the four root pages. `src/migrate/edges.ts` resolves
against facts and sources only, because those are the two kinds a wikilink can
become. KPA-6 reported the gap and left the decision to this record.

## The drift is two lines, and nine is a different number

KPA-6 and KPA-66 both put the disagreement at nine. Nine counts the
`[[index]]` citations, and every one of them costs the diff nothing.

```
grep -rho --include='*.md' '\[\[index\]\]' shared collibra koinon personal | wc -l    9
grep -rh  --include='*.md' '^sources:.*\[\[index\]\]' shared collibra koinon personal | wc -l    7
```

Nine citations, seven inside a `sources:` entry and two in a body. All nine
become an `unresolved` node here. None becomes a report line, because
`src/checks/problems.ts` runs the same link rule `check.py` runs, root pages
included, and both report zero broken links.

The reports disagree on two lines, and both are orphan advisories:

```
orphan: collibra/bhp-unstructured-declined.md is linked from nowhere
orphan: collibra/collibra-meeting-defaults.md is linked from nowhere
```

The cause is the opposite direction to the one the story names. `check.py`
counts a link **from** a root page as an inbound link, so a fact named only on
`index.md` or `log.md` is not an orphan there. `grep -rl` over the vault finds
`bhp-unstructured-declined` in `index.md` and `log.md`, and
`collibra-meeting-defaults` in `log.md`. No note in a space names either.

A link **to** a root page changes no report either way.

## Why the vault's answer is the one to drop

KPA-13's rule is that the old checker wins unless the new answer is proved
right. Here the new answer is right, and the two lines are true findings.

`log.md` is a journal of what ingestion did. An entry reading
`Added: collibra/collibra-meeting-defaults` records provenance. It is not a
link a reader follows to find the fact, so counting it as one hides a fact
nothing points at, which is the whole purpose of the orphan advisory.

`index.md` links `bhp-unstructured-declined` from a row in its Questions table.
The vault's own `CLAUDE.md` says that row gets deleted once Shane answers it,
so that inbound link is designed to disappear. Counting a transient row as an
inbound link hides the same orphan a week later.

## A root page belongs to none of the three layers

The vault's `CLAUDE.md` names three layers: `sources/` holds raw material, the
spaces hold facts, and `CLAUDE.md` holds the conventions. The brief repeats the
rule and adds that nothing writes into two layers. A root page is in none of
them, so no node kind fits it.

Each root page already has a destination, and not one of them is `nodes`:

| Page | Where it goes | Recorded in |
|---|---|---|
| `index.md` | its Questions table becomes `needs_you` rows | ADR-0012 |
| `log.md` | copied whole to `docs/vault-log.md` | KPA-18 |
| `CLAUDE.md` | the conventions, which become the schema and the gate prompts | the header of migration 001 |
| `README.md` | the repository's own README | - |

## Considered Options

1. **Make a root page a node** - closes the diff to zero, because `log.md`
   would then carry outbound edges and both orphans would go. Rejected on
   three counts. It writes a fourth thing into a memory the brief says holds
   three. It needs a sixth `node_kind`, and PostgreSQL cannot remove an enum
   value, so the migration's `-- @down` would be a no-op that claims to
   reverse. And it hides two true findings to match a checker that is wrong
   about them.
2. **Teach the report the four names, so a root-page link is neither a target
   nor a break** - rejected because it fixes nothing. The nine links to
   `index` already produce no report line, and the two orphans come from links
   out of a root page, which knowing the names does not reach.
3. **Accept the drift and record it** - chosen. KPA-13's own criterion allows
   a difference that carries a written reason.

## Consequences

- KPA-13's diff carries two permitted lines rather than none, and its script
  must name them. Any third difference is a defect.
- The nine `[[index]]` citations stay `unresolved` nodes. `unresolved` means
  "resolved to no row", not "broken", so the label still reads true.
  Twenty-three prose citations sit there for the same reason.
- A `sources:` entry whose wikilink names a root page loses its prose. Seven
  entries name Shane and 23 August 2026, and each becomes a node holding
  `index`, so the author and the date go. `targetOf` prefers a
  wikilink over the surrounding text, and every unresolved wikilink in a
  citation loses the same way, so the fix belongs to a story about citations
  rather than to this one.

  KPA-131 fixed it on 13 September 2026 without changing this decision. The
  target still resolves to an `unresolved` node holding `index`, and the whole
  entry now sits beside it in `edges.citation`. It also found an eighth entry
  losing its words the same way, one whose wikilink names a real source.
- The decision expires with the vault. After the vault retires there is no
  `index.md` and no `log.md`, so nothing here needs reversing. That is also
  why option 1 would have built something with no second reader.
