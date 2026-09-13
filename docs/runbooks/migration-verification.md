# Verifying the migration

The migration is proved when three things hold together: Sukkal's report agrees
with the vault's own `check.py`, a second counter written without the migration's
code agrees with Postgres on five counts, and the vault has not moved since the
freeze. KPA-13 built the command that checks all three.

```
scripts/verify-migration.sh
```

It exits 0 when the migration agrees with the vault and 1 when it does not. It
needs the frozen vault on this Mac and a local PostgreSQL with pgvector, and it
reaches nothing else.

## What it does

1. **Checks the freeze.** `scripts/vault-freeze.sh check` fails when the vault's
   git `HEAD` differs from `docs/vault-freeze.txt` or the vault holds uncommitted
   changes. A moved vault is drift, not a migration defect (REQ-032).
2. **Runs the vault's side.** The vault's `scripts/check.py`, and
   `scripts/count-vault.py`, which counts facts, sources, tasks, questions and
   edges straight from the files (REQ-033).
3. **Runs Sukkal's side.** It drops and recreates `sukkal_verify`, applies every
   migration, loads the vault with `src/migrate/load.ts`, and renders
   `src/checks/report.ts` in `check.py`'s layout.
4. **Compares.** `src/migrate/verify.ts` lines the two reports up, and the script
   asks Postgres for the five counts.

**It empties its database every run**, which is what makes it repeatable. So it
refuses any database whose name does not start with `sukkal_verify`. Set
`VERIFY_DATABASE=sukkal_verify_b` to run two at once. It never names
`sukkal_dev`, which the suite drops, or `sukkal_local`, which the running app
holds.

## Reading the output

```
reports in /var/folders/.../tmp.O2A7XBDBtI
loaded {"facts":19,"sources":32,"tasks":3,"questions":2,"edges":84}

the reports
  explained    only Sukkal    advisory: orphan: collibra/bhp-unstructured-declined.md is linked from nowhere
               ADR-0019: a root page is not a node, so this fact is linked from nowhere in the memory

the counts
  agree     edges     vault 84, Postgres 84
```

The folder it names holds `check.txt`, `sukkal.txt` and `counts.json`. Open the
two reports side by side when a line reads `UNEXPLAINED`.

**A report line on one side only is `explained` or `UNEXPLAINED`.** Two recorded
decisions explain a line, and nothing else does:

| Decision | The line it explains | Proved how |
|---|---|---|
| ADR-0019 | Only Sukkal prints an orphan for `collibra/bhp-unstructured-declined.md` or `collibra/collibra-meeting-defaults.md` | The line matches one of the two names exactly. A third orphan is a defect |
| ADR-0010 | Only `check.py` lists a fact past its review date | The migrated row really is due today, or really is unverified. A verified fact past its date that Sukkal leaves out is a defect |

**A count reads `agree` or `DISAGREE`**, and there is no third outcome. The
counts come from `SELECT count(*)` after the load, never from the load's own
report of what it wrote, so a load that miscounts itself cannot pass.

## As measured on 13 September 2026

Against the vault frozen at `da7afce`, the reports differ by exactly ADR-0019's
two orphans and every count agrees:

| Count | Vault | Postgres |
|---|---|---|
| Facts | 19 | 19 |
| Sources | 32 | 32 |
| Tasks | 3 | 3 |
| Questions | 2 | 2 |
| Edges | 84 | 84 |

## When it fails

**`the vault moved since the freeze`.** Something wrote to the vault. Read the
commits it names, decide whether they belong, and freeze again with
`scripts/vault-freeze.sh freeze` once they do. Do not trust a diff taken over
drift.

**`UNEXPLAINED`.** The migration is wrong until proven otherwise, not the old
checker. Find the rule that disagrees and fix whichever side misreads the vault.
When the new answer is the correct one, record that decision in an ADR and teach
`explain` in `src/migrate/verify.ts` to name it, proved against the row the way
the two above are.

**`DISAGREE`.** `scripts/count-vault.py` and `src/migrate/load.ts` read the vault
differently. Its docstring states each definition. Decide which reading the
design meant before changing either, because two counters edited until they
agree prove nothing.

**`this database already holds memory`.** The load found rows. The script
recreates its database, so this means `VERIFY_DATABASE` names one somebody else
is using.

**`the date changed during the run`.** `check.py` reads today's date and takes
no argument, so a run across midnight compares two different days. Run it again.

## What it does not do

**It never touches production.** `scripts/verify-migration.ts` calls
`refuseProduction`, so neither `kpa` nor `sukkal` can be its target. Loading the
vault into production and verifying it there is a step for a person, on a day
amaterasu answers.

**It does not unfreeze the vault.** `vault-freeze.md` says to unfreeze after
KPA-13, and that restarts three jobs, so it is Shane's step. Hold the freeze
until KPA-131 ships as well: that story's last criterion compares the advisory
report against the frozen vault.
