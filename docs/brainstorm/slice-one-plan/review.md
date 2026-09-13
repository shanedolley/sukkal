# Review: the slice one PRD

Six lenses reviewed `design.md` in parallel: solution-architect,
technical-analyst, project-manager, qa-analyst, business-analyst and
security-analyst. The seventh lens, uiux-designer, does not apply, because slice
one ships no interface.

Shane chose to fix all of it. Every finding below carries what happened to it.

Two findings were raised by two lenses independently. Both are treated as
corroborated rather than duplicated.

---

## Critical

### C1. The `edges` table had no target resolution strategy

*Raised by solution-architect.*

`target_id` had to point at `facts`, `sources`, `entities`, or nothing at all
when a wikilink is broken. Postgres cannot enforce a foreign key against a
column whose target table varies by row, and every later slice traverses this
table.

**Fixed.** A `nodes` registry now holds every edge endpoint. `facts`, `sources`
and `entities` take their `id` from it, and `edges` carries two ordinary foreign
keys, `from_id` and `to_id`. A broken link becomes a node of kind `unresolved`
carrying the raw link text, and a URL in a `sources:` list becomes a node of
kind `url`. REQ-009 tests it. Section 5 records the two alternatives this beat.
The decision earns an ADR when the schema story lands.

### C2. The read-only role ran the wrong direction

*Raised by solution-architect and technical-analyst independently.*

REQ-002 created `kpa_ro` on Sukkal's own database "for nabium". ADR-0003 has Sukkal
reading nabium's database, not the reverse, and nabium integration is out of
scope for this slice. The requirement spent a P0 on access control for a
consumer that does not exist.

**Fixed.** Asked Shane against three options: drop it from slice one, keep it
for the future web tier, or keep it as written. He chose to drop it. REQ-002 now
creates one role, and section 12 records the removal.

### C3. Nothing required encryption in transit

*Raised by security-analyst.*

SCRAM protects the password exchange and leaves the content in the clear. Six of
the 17 facts are Collibra customer material, and the LAN carries other devices.

**Fixed.** REQ-005 requires a certificate on the server, `sslmode=require` or
stronger on the client, and verification through `pg_stat_ssl`. A client
offering no TLS is refused. Section 9 gains a threat model naming what the
control defends against.

### C4. Nothing addressed encryption at rest

*Raised by security-analyst.*

amaterasu is a consumer Mac mini with a single NVMe, and the backup copy
inherits the same exposure. The document was silent on both.

**Recorded, not fixed.** Offered to Shane alongside three other encryption
items. He selected encryption in transit only. Open questions 4 and 5 record the
disk, the backups and the absent purge path as open rather than closed, so the
silence is now a stated position instead of an oversight.

### C5. The central proof promised counts `check.py` cannot supply

*Raised by qa-analyst, and confirmed by reading the script.*

REQ-022 claimed facts, sources, tasks, questions and edges all reconcile against
`check.py`. The script prints a note count over the four space folders, a
problem count and list, the stale list, and the advisories. `notes()` never
globs `sources/`, so three of the five figures do not exist in its output.

**Fixed.** Section 7 now separates the two proofs. The diff covers exactly what
`check.py` emits. The remaining counts come from a second counter written
against the vault's files rather than against the migration's parser, so a
shared misreading cannot make both sides wrong together. REQ-030 states the
narrower claim.

### C6. The test oracle kept moving

*Raised by qa-analyst.*

Three launchd jobs write to the vault, and the slice has no delivery date. A
diff run early and one run weeks later would not compare the same content, so
drift would read as a defect.

**Fixed.** Asked Shane against three options: pin a git commit, pause the three
launchd jobs, or take a frozen copy. He chose to pause the jobs. REQ-023 unloads
`com.koinon.daily-memory-review`, `com.koinon.gmail-filter-review` and
`com.koinon.weekly-vault-review`, and records the command that restores each.
Section 10 carries the cost as a named risk: the vault stops being maintained
for as long as the slice takes.

---

## Improvements

### Schema completeness

| # | Finding | Lens | Disposition |
|---|---|---|---|
| I1 | The embedding dimension was never pinned, and a pgvector column needs a fixed width | solution-architect | Fixed. REQ-010 forces the model and the dimension into the schema story. Research also found the brief's `voyage-3` superseded by the 4-series, with the dimension configurable and 1024 the default |
| I2 | `facts.embedding` had no requirement that filled it | technical-analyst | Fixed. REQ-026 now covers sources and facts |
| I3 | REQ-018 required a byte range that no column carried | technical-analyst | Fixed. `source_chunks` gains `byte_start` and `byte_end`, and `position` is renamed `ordinal` |
| I4 | Nothing recorded that a `valid_to` date was inferred rather than stated | technical-analyst | Fixed. `facts.valid_to_inferred`, required by REQ-011 |
| I5 | `type`, `description`, `tags` and `project` had no stated destination, and `type: person` was ambiguous between `facts` and `entities` | technical-analyst | Fixed. Section 3 carries the full mapping table read from the vault's `CLAUDE.md`. Every note in a space becomes a `facts` row whatever its `type`, and `entities` stays unpopulated |
| I6 | `source_chunks` had no unembedded marker | solution-architect | Fixed. A null `embedding` is the marker, and `embed_attempts` counts retries |
| I7 | `edges.source_id` collided with the `sources` table | technical-analyst | Fixed. Renamed `from_id` and `to_id` |

### Model calls

| # | Finding | Lens | Disposition |
|---|---|---|---|
| I8 | Gates 1 and 2 had no interface, and their tests would call the live model on every push | solution-architect and project-manager | Fixed. REQ-018 puts every model call behind one inference interface and backs the tests with recorded responses. The suite passes with the network unavailable, and CI needs no model credential. Section 10 carries the risk |
| I9 | Nothing handled a model response that is neither a clean pass nor a clean fail | technical-analyst | Fixed. REQ-016 parses gate output into a closed set. Anything else is an error, and an error rejects |

### Testing

| # | Finding | Lens | Disposition |
|---|---|---|---|
| I10 | No test-data strategy, and fixtures might copy Collibra material into the repository | qa-analyst | Fixed. REQ-022 requires synthetic fixtures and a review that finds no customer content |
| I11 | No isolation strategy for the shared `sukkal_dev` database | qa-analyst | Fixed. REQ-021 requires the suite to pass twice in a row with no manual reset |
| I12 | The four advisory checks were never named | qa-analyst | Fixed. REQ-020 names all four |
| I13 | The 120-note and 200-character ceilings were absent, and an empty diff at 17 facts proves nothing about them | qa-analyst | Fixed. REQ-020 ports both, and section 6 records that a fixture proves the rule because real data never fires it |
| I14 | No inventory separating manual verification from automated | qa-analyst | Fixed. Section 7 lists the four criteria that cannot run in the suite |
| I15 | No fault-injection mechanism for the atomicity tests | qa-analyst | Fixed. REQ-017 requires a test that injects a failure between the two writes |
| I16 | REQ-011's round trip did not say whether `text` was verbatim or parsed | technical-analyst | Fixed. `tasks.raw_line` holds the original verbatim, which is what makes the round trip exact |

### Build and tooling

| # | Finding | Lens | Disposition |
|---|---|---|---|
| I17 | Migration idempotency was left as an open fork | solution-architect | Fixed. REQ-007 chooses refusal over idempotency, and the runner names what it found |
| I18 | No version constraints, so a clean clone could resolve differently on different days | solution-architect | Fixed. REQ-006 requires a committed lockfile and an `engines` entry |
| I19 | "TypeScript, `node:` built-ins" was inaccurate, because Node has no Postgres client | technical-analyst | Fixed. The component table names the `pg` driver |

### Document completeness

| # | Finding | Lens | Disposition |
|---|---|---|---|
| I20 | The four gates were referenced throughout and never enumerated | business-analyst | Fixed. Section 3 states all four, and which two call the model |
| I21 | Two success-metric baselines read "Unknown", which is not a baseline | business-analyst | Fixed. Both now say the measure does not exist before the code does, and that the target is absolute |
| I22 | `project-brief.md` is now stale on the `index.md` step | business-analyst | Fixed. Section 14 names the line, and a task in `plan.md` carries the correction |
| I23 | The board-hygiene decisions from discovery were not carried into the PRD | project-manager | Fixed. Section 0 names all four as preconditions on the board |
| I24 | Milestones were not mapped to stories, so the seven-deep claim was unverifiable | project-manager | Partly fixed. Section 11 states that `plan.md` carries the graph and the crosswalk, which is where the story keys live |
| I25 | REQ-021's acceptance criterion was subjective | business-analyst | Fixed. REQ-029 now names what the file must contain and who checks it |
| I26 | The operator journey covered only the happy path | business-analyst | Fixed. Section 2 carries both paths |
| I27 | No purge path exists for employer material | security-analyst | Recorded, not fixed. Offered to Shane and not selected. Open question 5 |
| I28 | Parameterised queries were never stated | security-analyst | Fixed. Section 3 and section 9 both require them, and both name imported material as the least constrained input |
| I29 | No threat model was articulated | security-analyst | Fixed. Section 9 opens with one |
| I30 | Skill concentration on one person was unnamed | project-manager | Fixed. Section 10 names it, and records that the story order surfaces a gap early rather than mitigating it |
| I31 | The two P1 requirements had no place in the milestone sequence | project-manager | Fixed. Section 11 closes with where each sits |

---

## Suggestions

| # | Finding | Lens | Disposition |
|---|---|---|---|
| S1 | No rationale recorded for hand-rolling the migration runner | solution-architect | Fixed. Section 5 carries it |
| S2 | `entities` has no uniqueness constraint | technical-analyst | Not fixed. Nothing populates the table this slice, and the constraint belongs with the code that fills it |
| S3 | The task start-date case described a screen the slice does not ship | technical-analyst | Fixed. Section 6 describes the query predicate instead |
| S4 | REQ-019 did not define what counts as a `log.md` entry | qa-analyst | Fixed. REQ-027 defines it as one `## [date]` heading and the prose under it |
| S5 | The inferred-date row carried no requirement id | qa-analyst | Fixed. Section 6 now has a requirement column throughout |
| S6 | The cost of the status quo is asserted, not sized | business-analyst | Declined. No measurement exists, and a figure invented here would read as evidence. Section 1 says so |

---

## Round two: re-review of the fixes

The two lenses whose criticals changed the document most re-read it. Both found
the fixes incomplete, and both were right.

### From solution-architect

| # | Finding | Disposition |
|---|---|---|
| R1 | `nodes` was defined as `id` and `kind` alone, so the two kinds with no child table had nowhere to hold their value. A `url` node stored no URL and an `unresolved` node did not say which link broke, which defeats the citation the registry was built for | Fixed. `nodes.ref` holds the URL or the raw link text, and is null for the three kinds that have a child table |
| R2 | Nothing kept `nodes.kind` honest against the child tables. A node marked `fact` with no `facts` row, or one claimed by two child tables, would pass | Fixed. REQ-009 requires a constraint rejecting both, and the ADR carries the pattern |
| R3 | "Traversal stays a plain join" undersold the cost. Recovering a title or a path needs a further join dispatched on `kind` | Fixed. Section 3 states the real cost, and the ADR says it rather than letting the schema story find out |
| R4 | `rejections.node_id` was unannotated and ambiguous, since a rejected candidate never becomes a node | Fixed. Renamed `subject_id`, referencing the node the rejection concerned, with `candidate` holding the rejected text |
| R5 | The two-statement insert order of the shared primary key was implicit | Fixed. Section 3 states it, and the down migration removes children before the registry |
| - | Was `kpa_ro` cleanly removed? | Confirmed closed. The reviewer checked for dangling references and found none |

### From qa-analyst

| # | Finding | Disposition |
|---|---|---|
| R6 | REQ-020 classed the 120-note and 200-character ceilings as advisories. In `check.py` both append to `problems`, which sets the exit code. Building to the requirement as written would let the new side pass silently where the old side fails, breaking the very parity the revision exists to prove | Fixed, and the reading verified against the script. REQ-031 now ports all six problem cases. Reading `check()` directly also found three the review had not named: an unknown `type`, an unknown `status`, and `verified` without `verified_by` |
| R7 | The independent counter had no requirement, no test, and nothing enforcing the independence the prose relied on. It could have imported the migration's own parser, which is the failure it was built to prevent | Fixed. REQ-033 governs it, and independence is now structural: it is a Python script beside `check.py`, so it cannot import the TypeScript parser even by accident |
| R8 | REQ-023 asserted the vault stops changing and verified nothing. `launchctl unload` does not survive a reboot, and Obsidian, a hand edit, a git operation and the `.smart-env` directory all still write | Fixed. REQ-023 disables as well as unloads, and REQ-032 records the vault's git `HEAD` at the freeze and fails the verification when it has moved. Shane chose pausing over pinning the commit as the oracle, and this uses the commit only to detect drift |
| R9 | REQ-022's fixture review is a manual check and was absent from the manual list | Fixed. Section 7 lists it third |
| R10 | The `description` check constraint would reject a row where `check.py` reports and continues, so the two reports would disagree | Fixed. The column carries no length constraint. The checks raise a problem instead, matching the old behaviour |
| R11 | The diff is literal, so a functionally equivalent but differently worded message would fail it for no real reason | Fixed. REQ-031 requires each message string to equal `check.py`'s character for character |

## What the reviewers agreed on

Both the technical-analyst and the business-analyst checked the PRD's claims
against the source documents and found them accurate. The qa-analyst read
`check.py` rather than trusting the PRD's description of it, in both rounds, and
that produced the two findings with the largest consequence in this review.

The pattern worth keeping: every finding that mattered came from reading the
source rather than the document describing it. R6 is the clearest case. The
first round corrected a claim about `check.py` by reading it; the correction
then introduced a new error about the same script, which only a second reading
caught.

Of the six original criticals, five are closed in the document and one,
encryption at rest, is open by Shane's choice and recorded as open. All eleven
round-two findings are closed.
