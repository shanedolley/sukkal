# Plan: slice one

The work lives in Jira project KPA on `koinon.atlassian.net`, under epic KPA-1.
This file records what was created, why the board is shaped this way, and the
one rule that has now been got wrong twice.

## Baseline

Checked before planning, on 24 August 2026.

| | |
|---|---|
| Working tree | Clean |
| Tests | None. The repository holds documents only |
| Build | None. There is no `package.json` and no build step |
| Branch | `docs/slice-one-plan`, cut from `main` |

A failing baseline stops the plan phase, because you cannot tell your own
breakage from breakage that was already there. An absent baseline is different
from a failing one, and this is the absent kind: slice one creates the first
code in the repository, so KPA-3 is the story that gives later runs something to
check.

## One epic

KPA-1, "Slice one: migrate the memory", holds all sixteen stories. Proposed as
one epic and approved.

The split test asks three questions, and one of them argues for two epics.

**A distinct system or service?** No. The platform stories and the migration
stories are one system.

**A phase that could ship alone and be useful?** No. A provisioned database with
nothing in it delivers nothing, and the epic's definition of done is the empty
diff, which needs every story.

**A different reviewer or a different risk profile?** Yes. The operational work
carries sudo on a shared box and network exposure; the application code carries
unit tests. This is the argument for splitting, and it loses: it produces two
epics that must both finish before either is useful, which is the thing an epic
boundary exists to rule out.

Story count is not a boundary. Sixteen stories against one coherent goal is one
epic.

## The stories

Sixteen active, one closed. The estimate uses the Fibonacci scale from the
`issue-triage-jira` skill.

| Key | Story | Estimate | Subtasks |
|---|---|---|---|
| KPA-14 | Freeze the vault: pause the three launchd jobs and record the commit | 1 | |
| KPA-2 | Provision PostgreSQL with pgvector on amaterasu | 8 | KPA-19 to KPA-22 |
| KPA-15 | Reach amaterasu's Postgres from the Mac over TLS | 3 | |
| KPA-3 | Scaffold the repository and migration tooling | 5 | split in the description |
| KPA-16 | Keep every secret out of the repository and out of the unit file | 3 | |
| KPA-17 | Run the checks on every push, and record the repository's conventions | 3 | |
| KPA-4 | Create the core schema | 8 | KPA-23 to KPA-26 |
| KPA-18 | Give the vault's `log.md` a destination | 3 | |
| KPA-5 | Read and validate the vault's markdown | 5 | |
| KPA-6 | Turn wikilinks into typed edges | 3 | |
| KPA-7 | Turn inline tasks into rows | 3 | |
| KPA-9 | Implement the four gates as tested code | 8 | KPA-27 to KPA-31 |
| KPA-10 | Implement retirement with `valid_from` and `valid_to` | 5 | |
| KPA-11 | Port `check.py` | 8 | KPA-32 to KPA-34 |
| KPA-12 | Chunk and embed the sources through Voyage AI | 5 | split in the description |
| KPA-13 | Verify the migration by diffing the two reports | 5 | split in the description |
| KPA-8 | Port the questions and Decisions tables | closed | |

KPA-14 through KPA-18 are new, one per gap that research found. KPA-11 rose from
a 5 to an 8 during the review, because porting six problem cases with their
message text unchanged is more work than the story described.

**Expansion.** The mechanical rule expands every 8 and any 5 naming more than one
component, which would have produced 22 subtasks. Shane chose to expand the four
8s only, so sixteen subtasks exist and the three 5s carry their split as a note
in the description. The split is recorded either way; only its location differs.

**KPA-8 is closed, not implemented.** Both tables on the vault's `index.md` carry
headers and no rows, so the story migrates nothing. The `questions` and
`rejections` tables it needed are created by KPA-4 regardless. A later brainstorm
rescopes the parser once there are rows for it to read.

## The dependency graph

Twenty `Blocks` links. The critical path is eight stories deep, and that depth
is the schedule.

```
depth 1   KPA-14 (freeze)        KPA-2 (provision)
depth 2                          KPA-15 (TLS, boundary)
depth 3                          KPA-3 (scaffold)
depth 4   KPA-16 (secrets)  KPA-17 (hygiene)  KPA-4 (schema)
depth 5   KPA-18 (log.md)   KPA-5 (read)  KPA-9 (gates)  KPA-10 (retire)
depth 6   KPA-6 (edges)     KPA-7 (tasks)     KPA-12 (embed)
depth 7   KPA-11 (checks)
depth 8   KPA-13 (verify)
```

Two edges carry reasoning that is not obvious from the titles. KPA-6 blocks
KPA-11 because the orphan and cross-space advisories need edges to run against.
KPA-10 blocks KPA-11 because the test asserting the sweep never sets `valid_to`
needs retirement to exist first.

Transitive edges are left out on purpose. A complete mesh is unreadable and
hides the real critical path.

### Milestones to stories

Section 11 of the PRD names five milestones and does not say which stories carry
them. Here they are.

| Milestone | Stories |
|---|---|
| The vault is frozen | KPA-14 |
| The platform stands up | KPA-2, KPA-15, KPA-3, KPA-16, KPA-17 |
| The schema exists | KPA-4, KPA-18 |
| The vault reads | KPA-5, KPA-6, KPA-7 |
| The rules are code | KPA-9, KPA-10, KPA-11 |
| The migration is proved | KPA-12, KPA-13 |

## The link direction rule

**This rule has now been got wrong three times, and the version below replaces
the one this file carried until 27 August 2026.** That version had both halves
backwards. It read as working every time, because a wrong writing rule and a
matching wrong reading rule agree with each other.

`inwardIssue` is the blocker. Both halves follow from that one sentence.

**Writing a link.** To say A blocks B, post A as `inwardIssue` and B as
`outwardIssue`.

```
{"type": {"name": "Blocks"},
 "inwardIssue":  {"key": "A"},
 "outwardIssue": {"key": "B"}}
```

**Reading a link.** The API omits the end you asked about, and tags the other
end with the role it plays. So on issue X, an entry carrying `inwardIssue: Y`
means Y blocks X. An entry carrying `outwardIssue: Y` means X blocks Y.

**Verifying a link.** Both checks below are worthless on their own, and the
first one is the trap. Run the second.

Reading the same link from both ends proves only that the API is self-consistent
with itself. It is, always. On 26 August a session posted the KPA-5 and KPA-22
link backwards, read it from both ends with the backwards rule, got agreement,
and recorded it as verified. The board carried the error until someone corrected
it the next morning.

**Check the direction against meaning instead.** Pick a link whose direction you
know from what the stories say, not from the API. KPA-13 diffs two reports to
verify the migration, so every story it verifies must finish first. Read it:

```
KPA-13 carries inwardIssue for KPA-7, KPA-9, KPA-11 and KPA-12.
Therefore those four block KPA-13.
```

If the reading gives you the opposite, the reading rule is wrong, not the board.

**The whole-graph check is cheap and catches what one link cannot.** Every edge
should run from a lower depth to a higher one in the table above. Build the edge
set both ways and count the violations. On 27 August 2026, `inwardIssue` as the
blocker gave 0 violations across 31 edges, and `outwardIssue` gave 20. That is
not a judgement call; it is a count.

The second independent check is the selector `build` uses. Run against this
board, `next_issue.py` returns KPA-2, which has no blockers. Its `--self-check`
carries the KPA-7 and KPA-13 fixture, taken from link id 10156 read at both
ends. Do not rewrite that assertion to match a changed `normalise`. Rewrite
`normalise` to match the assertion.

## What this run changed on the board

| Change | Count |
|---|---|
| Stories created | 5 |
| Subtasks created | 16 |
| Blocking links removed, all backwards | 16 |
| Blocking links created in the correct direction | 20 |
| Stories given an estimate | 16 |
| Story descriptions revised against the PRD | 11 |
| Stories closed | 1 |

The board now holds 34 issues: one epic, seventeen stories and sixteen subtasks.

## One thing that could not be done

**Story Points could not be written to its field.** KPA is a team-managed
project with estimation switched off, so `customfield_10053` is on neither the
create screen nor the edit screen, and a write returns HTTP 400. That setting
lives behind a project-settings toggle with no stable API.

Each estimate is recorded twice instead: in an `h3. Estimate` section at the top
of the description, and in an `est-N` label that JQL can filter on. Turning
estimation on in Project settings, Features, makes the field available, and the
numbers can then be backfilled from the labels in one pass.

## Documents corrected

`docs/project-brief.md` listed "Port the two tables on `index.md`" as step 5 of
the migration. Both tables are empty, so the step is rewritten to create the
tables and migrate nothing. The brief is the source these stories derive from,
so it gets fixed rather than the story rewritten to match.

## Next

`build`. It reads its queue from KPA-1 through `next_issue.py`, and the first
issue is KPA-2. KPA-14 is equally ready and freezes the vault, so it is the
cheaper one to take first.

The run stops here by Shane's choice. `build` is a separate invocation.
