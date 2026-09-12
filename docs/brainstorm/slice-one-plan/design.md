# PRD: slice one, migrate the memory

**Status:** Reviewed. Revised against six lenses.
**Author:** Shane Dolley
**Created:** 2026-08-24
**Brainstorm folder:** `docs/brainstorm/slice-one-plan/`
**Tracker:** Jira project KPA on `koinon.atlassian.net`, epic KPA-1
**Source documents:** `docs/project-brief.md`, `docs/adr/0001` to `docs/adr/0006`
**Review:** `review.md` records every finding and what happened to it

---

## Executive summary

Sukkal replaces a working markdown system. That system
holds 17 compiled facts and 32 raw sources in an Obsidian vault, governed by
rules written as prose and enforced by a person reading them. It earned its
design through use, and it has reached the limit of what a vault and a grep can
do.

Slice one moves the vault into PostgreSQL and turns its prose rules into code.
It ships no user interface and ingests no mail. The value is proof: every later
slice writes into this schema, so a mistake here becomes a migration for
everything built afterwards. Seventeen facts is the cheapest volume at which to
find the mistake.

The work divides into three parts. First, stand up the platform: PostgreSQL 18
with pgvector on amaterasu, and a TypeScript workspace with a migration runner.
Second, move the vault: the schema, a reader that fails loudly, typed edges,
task rows, the four gates as tested functions, and retirement through
`valid_from` and `valid_to`. Third, prove it: run the vault's `check.py` against
the vault, run the new checks against Postgres, and diff the two reports.

That final comparison is available only while both systems exist. It disappears
the moment the vault retires, and nothing else in the project will ever get this
kind of check against a known-good original.

---

## 0. Preconditions on the Jira board

This PRD is decomposed against KPA, which already holds epic KPA-1 and twelve
stories. Four corrections apply to that board before decomposition, and each is
a deliverable of the `plan` phase rather than of the slice.

1. **Correct all sixteen `Blocks` links.** Every one runs backwards today, so
   the next-issue selector offers stories that are not ready and hides the ones
   that are. The rule: on issue X, a link listing the other end as
   `outwardIssue` means that issue blocks X. The outward end is the blocker.
2. **Score every story** on the Fibonacci scale in the `issue-triage-jira`
   skill, writing to `customfield_10053`. No story carries a score today.
3. **Expand what the score requires.** Every 8 gets subtasks. A 5 gets them when
   it names more than one component.
4. **Close KPA-8.** Both tables on the vault's `index.md` carry headers and no
   rows, so the story migrates nothing. A later brainstorm rescopes the work.

`plan.md` carries the corrected graph, the scores, and the crosswalk from the
milestones in section 11 to the stories that satisfy them.

---

## 1. Problem statement

**Problem.** The markdown system cannot grow into the assistant the project
needs, and its rules are unenforceable.

**Impact.** Shane, the sole user. Three failures follow from the current design.
The rules that decide whether a candidate becomes a fact are prose in a
`CLAUDE.md` file, so a model follows them approximately and nothing detects a
miss. Search is grep, so a question phrased differently from the fact returns
nothing. Retirement is a delete, so the system cannot answer what was true in
March, and fact decay leaves no trace.

The cost of the status quo is not sized in hours. No measurement of it exists,
and a number invented here would read as evidence.

**Root cause.** The vault stores knowledge as files. Files carry no constraints,
no types and no transactions, so every rule that matters has to live outside the
data and be applied by whoever remembers it.

**Current state.** Seventeen facts across four spaces, 32 sources, one
`check.py` catching malformed notes, and three launchd jobs. Obsidian supplies
backlinks, a graph and rename handling. Postgres has to earn all three.

---

## 2. Target users

Sukkal is single user. The one user is Shane Dolley, and the memory model assumes
one person throughout: one set of facts, one inbox, one voice, one review queue,
and a `verified_by` that means him.

| Persona | Description | Key needs | Pain points |
|---|---|---|---|
| Shane | Works across Collibra, Koinon Engineering and personal streams | Recall a decision months later, trust that a fact is current, keep employer material separate | Context evaporates, recall costs attention, facts rot silently |

Building a permission model now would build a different product. The single
concession is an `owner_id` column on `sources`, `facts` and `tasks`, defaulted
to one row in `users`. It costs one column today. Adding it later means
migrating every table holding anything personal, which is all of them.

### Operator journey

Slice one has no interactive journey, because it ships no interface. Its journey
is an operator journey with two paths.

**The diff is empty.** Shane runs the migration once, reads the verification
report, and confirms the counts reconcile. The slice is done.

**The diff is not empty.** Every difference is a defect in the migration until
proven otherwise, never a defect in `check.py`. Shane either fixes the migration
and re-runs, or writes the reason the new answer is the correct one against that
difference. The script exits non-zero until every difference carries a fix or a
reason, so an unexplained difference cannot be passed over.

---

## 3. Proposed solution

### Selected approach

**Name.** Migrate the vault into PostgreSQL, with the rules as tested code.

**Summary.** Design the schema the memory lives in, parse every note in the
vault against it, turn links into typed edges and checkboxes into rows, write
the four gates as functions with tests, implement retirement as a date rather
than a delete, port the staleness sweep, embed the sources and the facts, and
prove the result by diffing the old checker against the new one.

**Why this approach.** The brief settled it. Slice one migrates the memory
because it proves the model before any volume reaches it, and because the
comparison against the old system is available only now.

### The four gates

The gates decide whether a candidate becomes a fact. They are prose in the
vault's `CLAUDE.md` today and code by the end of this slice, and that change is
the point of the whole slice. All four must pass or the candidate stays out.

1. **It will still be true in a month.** Calls the model.
2. **It appeared on two separate days, or Shane stated it once as a preference,
   a correction or a decision.** Calls the model.
3. **Nothing already records it.** Mechanical, checked against existing facts.
4. **It contradicts nothing, or it retires what it contradicts.** Mechanical,
   and the retirement commits in the same transaction as the replacement.

### Architecture overview

```
Shane's Mac                          amaterasu (Ubuntu 24.04)
┌────────────────────────────┐       ┌──────────────────────────────┐
│ Obsidian vault             │       │ PostgreSQL 18 + pgvector     │
│  17 facts, 32 sources      │       │  kpa       (the migration)   │
│  scripts/check.py          │       │  kpa_dev   (tests)           │
│  3 launchd jobs, paused    │  TLS  │                              │
│                            │──────▶│  role kpa, owns the schema,  │
│ Sukkal repository (this repo) │  LAN  │  not a superuser             │
│  TypeScript, Node 22       │       └──────────────────────────────┘
│  migration runner          │                    ▲
│  vault reader              │                    │
│  gates, retirement, checks │                    │
└────────────────────────────┘                    │
              │                                   │
              └──────────────▶ Voyage AI ─────────┘
                               embeddings
```

The migration runs on the Mac and writes to Postgres on amaterasu over the LAN.
This follows from where the two inputs sit: the vault and `check.py` live on the
Mac and cannot move, and Postgres lives on amaterasu because that is where Sukkal
will run. Only one of the two can cross the network, and it is the one that
already has a wire protocol.

The connection requires TLS. SCRAM protects the password exchange and leaves the
content in the clear, and the content includes Collibra customer material on a
LAN that carries other devices.

### Key components

| Component | Purpose | Technology |
|---|---|---|
| PostgreSQL 18 + pgvector | The memory store | PGDG packages on Ubuntu noble |
| Migration runner | Applies and reverses schema files in order | TypeScript over the `pg` driver. It refuses to run over a populated database rather than attempting to be idempotent |
| Vault reader | Parses and validates every note, fails loudly | TypeScript |
| Edge builder | Turns `[[wikilinks]]` and `sources:` entries into typed edges | TypeScript |
| Gates | Four functions deciding whether a candidate becomes a fact | TypeScript. Gates 1 and 2 call the model through an inference interface |
| Inference interface | One seam in front of every model call | TypeScript. A recorded-response implementation backs the tests |
| Retirement | Sets `valid_to` from a source, a superseding fact, or Shane | TypeScript |
| Checks | The staleness sweep and four advisory checks | TypeScript |
| Embedder | Chunks on structure and embeds through Voyage | TypeScript, behind an interface |
| Verifier | Diffs `check.py` against the new checks and reconciles counts | Shell |
| Independent counter | Counts sources, tasks, questions and edges from the vault's files | Python, beside `check.py`, so it cannot import the migration's parser |

Every database access uses parameterised statements. No component builds SQL by
concatenating note content, and imported material under `sources/` carries
whatever frontmatter it arrived with, so it is the least constrained input in
the system.

### Data model

Nine tables plus one registry. The registry is what makes the graph enforceable.

**`nodes` resolves the edge target problem.** An edge points at a fact, a source,
an entity, an external URL, or a wikilink whose target does not exist. Postgres
cannot enforce a foreign key against a column whose target table varies by row,
and dropping the constraint would leave the one table every later slice traverses
with no integrity at all. So `facts`, `sources` and `entities` each take their
`id` from `nodes`, and `edges` carries two ordinary foreign keys into it.
Traversal by recursive CTE stays a plain join, and a broken link becomes a
`nodes` row of kind `unresolved` carrying the raw link text.

Traversal is honest about its cost. Walking `edges` through `nodes` to get a
chain of ids and kinds is a plain join. Recovering what was traversed, a fact's
title or a source's path, needs a further join dispatched on `nodes.kind`, which
is three joins and a coalesce rather than one. That is still cheaper than the
alternatives, and the ADR says so rather than letting the schema story discover
it.

Two constraints keep the registry honest, and both belong in the ADR. `kind`
must agree with which child table claims the id, so a node marked `fact` with no
`facts` row, or one claimed by two child tables, is a defect a constraint
catches rather than a reader. And every insert is two statements in a fixed
order, the `nodes` row first, so the down migration removes children before the
registry.

This is a decision hard to reverse, surprising to a reader, and taken against a
real alternative. It gets an ADR at `docs/adr/0007-a-node-registry-for-edges.md`
when the schema story lands.

| Table | Key fields | Notes |
|---|---|---|
| `nodes` | `id`, `kind`, `ref` | `kind` is `fact`, `source`, `entity`, `url` or `unresolved`. `ref` holds the value for the two kinds that have no child table: the URL, or the raw text of the wikilink that resolved to nothing. It is null for the other three |
| `users` | `id` | One row. Every `owner_id` defaults to it |
| `sources` | `id` references `nodes`, `owner_id`, `path`, `body`, `recorded_at` | Stored verbatim, never edited |
| `source_chunks` | `id`, `source_id`, `ordinal`, `byte_start`, `byte_end`, `embedding`, `embed_attempts` | `byte_start` and `byte_end` let a citation open at the right place. A null `embedding` means unembedded |
| `facts` | `id` references `nodes`, `owner_id`, `type`, `title`, `description`, `space`, `tags`, `project`, `status`, `generated`, `generated_by`, `verified`, `verified_by`, `stale_after`, `valid_from`, `valid_to`, `valid_to_inferred`, `embedding`, `embed_attempts` | One row per note in a space, whatever its `type`. `description` carries no length constraint, because `check.py` reports an over-length description and still migrates the note. A constraint would reject where the old system continues, and the two reports would then disagree |
| `edges` | `id`, `from_id` references `nodes`, `to_id` references `nodes`, `kind` | Typed and directional. Named `from_id` and `to_id` so neither is confused with the `sources` table |
| `entities` | `id` references `nodes`, `kind`, `name` | Created by the schema. Nothing populates it this slice |
| `tasks` | `id`, `owner_id`, `fact_id`, `raw_line`, `text`, `due`, `start`, `done` | `raw_line` holds the original markdown verbatim, which is what makes the round-trip test exact |
| `questions` | `id`, `fact_id`, `question`, `answer`, `asked` | Closed by writing the answer into the fact |
| `rejections` | `id`, `subject_id` references `nodes`, `candidate`, `reason`, `raised` | A rejected candidate never became a fact, so `subject_id` names the node the rejection concerned, which is the source it came from or the fact it contradicted. `candidate` holds the text that was rejected. Read by a later run so it does not re-raise the same one |

**Every frontmatter field maps.** The vault's `CLAUDE.md` is the authority, and
this is the mapping REQ-006 tests against.

| Frontmatter | Lands as |
|---|---|
| `type` | `facts.type`, an enum of the nine values the vault defines |
| `title` | `facts.title` |
| `description` | `facts.description`, with a check constraint at 200 characters |
| `space` | `facts.space`, an enum of `collibra`, `koinon`, `personal`, `shared` |
| `tags` | `facts.tags`, a text array |
| `project` | `facts.project`, a text array |
| `status` | `facts.status`, an enum of `draft`, `stable`, `deprecated` |
| `generated`, `generated_by` | `facts.generated`, `facts.generated_by` |
| `verified`, `verified_by` | `facts.verified`, `facts.verified_by`. Never written by a machine |
| `stale_after` | `facts.stale_after`, an absolute date |
| `sources` | An edge of kind `derived_from` per entry. A wikilink resolves to a node, and a URL becomes a node of kind `url` |
| A `[[wikilink]]` in the body | An edge of kind `links_to`. An unresolved target becomes a node of kind `unresolved` |
| An inline `- [ ]` item | A `tasks` row against the fact it sat on |

`generated_by` and `verified_by` stay separate columns. Who wrote a fact is not
who confirmed it, and no machine ever writes the second.

**The embedding width is pinned by the model.** Voyage's current models take a
configurable output dimension, 1024 by default, and the 4-series has superseded
`voyage-3`. A pgvector column needs a fixed width, so the schema story picks the
model and the dimension together and records both. It cannot be deferred to the
embedder story, because the column is declared first.

KPA-26 settled it on 27 August 2026: `voyage-4` at 1024, held in
`src/embedding.ts`. The brief named `voyage-3` until that day and now names the
same pair this paragraph does.

---

## 4. Requirements

### Functional requirements

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| REQ-001 | PostgreSQL 18 with pgvector runs on amaterasu under systemd | P0 | `SELECT extversion FROM pg_extension WHERE extname='vector'` returns a version, and repeats after `systemctl restart postgresql` and after a reboot |
| REQ-002 | A `kpa` role owns the schema and holds no superuser rights | P0 | `\du` shows the role, and `rolsuper` is false. No other role is created this slice |
| REQ-003 | Two databases exist on that server, `kpa` and `kpa_dev` | P0 | Tests connect to `kpa_dev` and never to `kpa`. A test run leaves `kpa` row counts unchanged |
| REQ-004 | The server listens on the LAN address only, with `scram-sha-256` and the Mac's address allowed | P0 | `psql` from the Mac connects. `psql` from an address outside the LAN is refused. `listen_addresses` never reads `0.0.0.0` |
| REQ-005 | The connection is encrypted in transit | P0 | The server holds a certificate, the client connects with `sslmode=require` or stronger, and `SELECT ssl FROM pg_stat_ssl` reports true for the migration's connection. A client offering no TLS is refused |
| REQ-006 | A TypeScript workspace builds and migrates from a clean clone, with dependencies pinned | P0 | `npm install`, `npm run migrate`, `npm test` all succeed, and `npm run migrate down` returns the database to empty. A lockfile is committed and `engines` names the Node major |
| REQ-007 | The migration runner refuses to run over a populated database | P0 | Running it twice fails the second time and names what it found, rather than writing a second copy or attempting a partial update |
| REQ-008 | The core schema exists, and every vault frontmatter field maps to a column or an edge kind | P0 | A test fails on any frontmatter key present in the vault and absent from the mapping table in section 3 |
| REQ-009 | Edges resolve through the `nodes` registry, with real foreign keys on both ends | P0 | `from_id` and `to_id` both carry a foreign key. An unresolved wikilink produces a node of kind `unresolved` whose `ref` holds the raw link text, and no dangling reference exists. A constraint rejects a node whose `kind` disagrees with the child table claiming its id, and rejects an id claimed by two child tables |
| REQ-010 | The embedding model and its output dimension are pinned in the schema | P0 | The vector columns declare a fixed width, and one configuration value names the model. Changing the model is a migration, and the schema documentation says so |
| REQ-011 | `facts` carries `valid_from`, `valid_to` and `valid_to_inferred`, and nothing is ever deleted | P0 | Retiring a fact sets a date. A query as at an earlier date still returns the fact. An inferred date sets the flag |
| REQ-012 | `owner_id` exists on `sources`, `facts` and `tasks`, defaulted to one row in `users` | P0 | The column is present and defaulted, and no other code reads it |
| REQ-013 | A reader parses and validates every note, and fails loudly | P0 | Malformed fixtures each fail and name the file, the field and the reason. The run reports files read, valid and failed, with zero silent skips. An unknown frontmatter key fails the file |
| REQ-014 | Every `[[wikilink]]` and every `sources:` entry becomes a typed edge | P0 | The broken-link count matches what `check.py` reports. A backlink query returns what Obsidian shows for a chosen note. A `sources:` entry that is a URL produces a node of kind `url` carrying the URL in `ref` |
| REQ-031 | The new checks reproduce every problem `check.py` raises, with its message text unchanged | P0 | All six problem cases port across: the 120-note space ceiling, the 200-character description, an unknown `type`, an unknown `status`, `verified` without `verified_by`, and a wikilink with no note. Each new message string equals `check.py`'s character for character, because REQ-030's diff compares text rather than meaning. A problem sets a non-zero exit, exactly as it does today. None of the six is an advisory |
| REQ-015 | Every inline task becomes a row carrying its due, start and done dates, and its original line | P0 | A round-trip renders `raw_line` back unchanged, character for character, over every task in the vault. A task with no due date stays undated |
| REQ-016 | The four gates run as separate tested functions that default to reject | P0 | Each gate has a passing, a failing and a boundary fixture. A gate that throws rejects. A model response that is neither a clean pass nor a clean fail is an error, and an error rejects. A rejection records a reason a later run reads |
| REQ-017 | Gate 4 retires what it contradicts in the same transaction that writes the replacement | P0 | A test injects a failure between the two writes and proves neither survives |
| REQ-018 | Every model call passes through one inference interface, and no test calls a live model | P0 | The test suite passes with the network unavailable. Gate 1 and gate 2 fixtures use recorded responses. Continuous integration makes no model call and needs no model credential |
| REQ-019 | Only a source or a human sets `valid_to`. The staleness sweep never does | P0 | A test asserts the sweep leaves `valid_to` untouched on every fact it flags |
| REQ-020 | The staleness sweep and the four advisory checks report and change nothing | P0 | The four are orphaned facts, links crossing the Collibra and Koinon boundary, the ratio of uncompiled sources, and review pile-up. A stale fact never fails the run, and neither does an advisory. The two ceilings are not advisories and belong to REQ-031 |
| REQ-021 | Tests reset their own state and never depend on a previous run | P0 | The suite passes twice in a row against `kpa_dev` without a manual reset between runs |
| REQ-022 | Test fixtures carry no Collibra customer material | P0 | Fixtures are synthetic. A review of `test/fixtures/` finds no customer name, no commercial figure, and no content copied from a `collibra/` note |
| REQ-023 | The three launchd jobs pause for the duration of the slice, and the steps to restore them are recorded | P0 | `com.koinon.daily-memory-review`, `com.koinon.gmail-filter-review` and `com.koinon.weekly-vault-review` are unloaded and disabled, so a reboot does not restart them during an undated slice. A runbook names the command that restores each |
| REQ-032 | Drift in the vault is detected rather than assumed away | P0 | The freeze records the vault's git `HEAD`. The verification re-reads it and fails when it has moved, naming the commits. This catches every writer REQ-023 does not touch: Obsidian, a hand edit, a git operation, and the `.smart-env` plugin directory. Without it a stray write reads as a migration defect |
| REQ-024 | The migration and its verification run from one machine, in one command | P0 | One command runs `check.py` on the Mac, the new checks against amaterasu, the count reconciliation, and the diff, with no manual step between |
| REQ-025 | Secrets reach the code from outside the repository, and no secret is committed | P0 | `.env.example` names every variable the code reads and holds no value. A scan of the whole history finds no key |
| REQ-026 | Sources and facts chunk on structure and embed through Voyage, behind an interface | P1 | A chunk maps back to a byte range in the original through `byte_start` and `byte_end`. Re-running the embedder leaves the row count unchanged. A failed call retries with backoff and leaves `embedding` null |
| REQ-027 | The vault's `log.md` reaches a destination the migration records | P1 | Every entry in `log.md` exists in Postgres or in `docs/`, an entry being one `## [date]` heading and the prose under it. The destination is recorded where it was chosen |
| REQ-028 | Continuous integration runs the lint, the build and the tests on every push | P1 | A pull request with a failing test reports failure before review. The workflow needs no model credential and no database outside the runner |
| REQ-029 | The repository carries a `CLAUDE.md` recording its conventions | P1 | The file names the build, test and migrate commands, the directory layout, and the branch and commit rules. A reviewer checks each against the repository as it stands |
| REQ-030 | The migration is verified by an empty diff and reconciled counts | P0 | The diff covers exactly what `check.py` emits: its note count, its problem list, its stale list and its advisories. The counts that `check.py` does not emit are reconciled separately, per REQ-033 |
| REQ-033 | A second counter, independent of the migration, supplies the counts `check.py` does not emit | P0 | It counts sources, tasks, questions and edges from the vault's files. It is a Python script beside `check.py`, so it cannot import the migration's parser and the independence is structural rather than promised. Its own fixtures prove it counts correctly. The two counts must agree exactly |

**Priority definitions.** P0 blocks the slice. P1 should ship with it and does
not block. No P2 requirement survived, because anything nice to have belongs in
a later slice rather than in the slice that sets the schema.

### Non-functional requirements

| ID | Category | Requirement | Target | Measurement |
|---|---|---|---|---|
| NFR-001 | Performance | Postgres is tuned for a 7.6 GB box that shares its CPU | `shared_buffers`, `work_mem`, `effective_cache_size` and `max_connections` set per nabium's `postgres-tuning.md` | Read the settings back with `SHOW` |
| NFR-002 | Performance | The full migration completes inside one working session | Under 10 minutes for 17 facts and 32 sources, excluding embedding calls | Time the run |
| NFR-003 | Availability | Postgres survives a reboot and a transcode burst | The service starts at boot, and a query succeeds while all twelve threads are busy | Reboot once, then query during a transcode |
| NFR-004 | Recoverability | The database can be restored from a backup | nabium's backup runbook is followed once end to end, with a restore into a scratch database | Restore and compare row counts |
| NFR-005 | Security | No secret enters the repository at any point in its history | Zero findings | Scan the whole history before the pull request merges |
| NFR-006 | Correctness | The new checks agree with `check.py` | An empty diff, or every remaining difference carries a written reason | Run the verification script |

---

## 5. Alternatives considered

| Approach | Summary | Why not selected |
|---|---|---|
| Local Postgres on the Mac for development | Homebrew PostgreSQL 17 is already installed. Tests run with no network | Shane chose to develop live against amaterasu. Two servers at two versions would also let a migration pass locally and fail on the box that matters |
| Postgres in Docker | Pins the version and the pgvector build | Adds a container to a project that chose bare metal, and the version pin is available from PGDG without one |
| One database for development and the migration | Simplest to stand up | A test run would write into the database that later holds the real facts. A second database on the same server costs one `CREATE DATABASE` |
| Run the migration on amaterasu | Puts the code beside the database | The vault and `check.py` live on the Mac. Moving them means copying the input the verification compares against, which is the one thing that must stay authoritative |
| A polymorphic `target_id` with a discriminator column | One table, no registry, trivial to write | Postgres cannot enforce a foreign key on it, so the one table every later slice traverses would carry no integrity. A dangling edge is a lost fact |
| Separate nullable foreign key columns per target kind | Real constraints, no extra table | Five nullable columns and a check constraint make every recursive traversal harder to read, and traversal is what ADR-0001 chose Postgres for |
| An off-the-shelf migration library | Nothing to write or maintain | The runner needs up, down, ordered files and a record of what ran. That is roughly a hundred lines against the `pg` driver, and a library brings a configuration surface larger than the feature |
| Pinning a vault git commit as the test oracle | The vault is already a git repository, so freezing costs nothing and the jobs keep working | Shane chose to pause the three launchd jobs instead. The commit is still recorded, under REQ-032, as a drift check rather than as the oracle. Pausing stops the writers that are known; the recorded `HEAD` catches the ones that are not |
| Neo4j for the memory | The data is a graph | Rejected in ADR-0001. The queries are neighbourhood queries, and one store beats two |
| Keep the vault and sync | No migration to write | Rejected in the brief. Two systems means a sync problem, and the rules stay prose in one of them |

---

## 6. Edge cases and error handling

| Category | Scenario | Expected behaviour | Requirement |
|---|---|---|---|
| Invalid input | A note carries an unknown frontmatter field | The file fails and the message names the file, the field and the reason. The run continues and reports the failure in its totals | REQ-013 |
| Invalid input | A note carries a relative date such as "next month" | The file fails. Dates are absolute or they are wrong | REQ-013 |
| Invalid input | A `sources/` note carries no frontmatter | It passes. Imported material may carry any frontmatter or none, and the validator knows the difference | REQ-013 |
| Invalid input | A note's `description` exceeds 200 characters | The note still migrates, and the checks raise a problem carrying `check.py`'s exact wording. Nothing rejects the row, because `check.py` does not | REQ-031 |
| Boundary | A wikilink points at a note that does not exist | A node of kind `unresolved` records the raw link text, and the broken link appears in the report. `check.py` reports the same count | REQ-009, REQ-014 |
| Boundary | A `sources:` entry is a URL rather than a wikilink | A node of kind `url` carries it, and the edge is still `derived_from` | REQ-014 |
| Boundary | A task carries no due date | It stays undated. Nothing invents one | REQ-015 |
| Boundary | A task starts in the future | The query predicate excludes it until that date, matching what the vault's homepage query selects today | REQ-015 |
| Boundary | A space exceeds 120 notes | A problem is raised and the run exits non-zero, exactly as `check.py` does. At 17 facts this never fires against real data, so a fixture proves it, and the fixture asserts the failure rather than a report | REQ-031 |
| Boundary | The vault changes after the freeze | The verification reads the recorded `HEAD`, finds it moved, and fails naming the commits, rather than reporting the drift as a migration defect | REQ-032 |
| Failure mode | A gate throws | The candidate is rejected. The default is to reject, so an error never becomes a fact | REQ-016 |
| Failure mode | A model returns a hedge, a refusal or a malformed answer | It parses to an error rather than to a pass. An error rejects | REQ-016 |
| Failure mode | The Voyage API fails | The call retries with backoff, `embedding` stays null, and the row is retried on the next run | REQ-026 |
| Failure mode | The LAN drops mid-migration | The transaction rolls back. The runner then refuses the re-run until the database is emptied, which is the behaviour REQ-007 chose over a partial update | REQ-007 |
| Failure mode | A contradicting source names no date | `valid_to` takes the source's own date and `valid_to_inferred` is set, because recording the uncertainty is what the vault's never-guess rule requires | REQ-011 |
| Concurrency | Gate 4 writes a replacement while retiring the fact it contradicts | Both happen in one transaction. A test injects a failure between the two writes and proves neither survives | REQ-017 |
| Concurrency | The embedder runs twice | Rows update in place. The row count does not change | REQ-026 |
| Recovery | The migration is re-run over a populated database | It refuses and names what it found | REQ-007 |
| Permission | The `kpa` role attempts a superuser action | It fails. The role owns the schema and nothing more | REQ-002 |
| Permission | A client connects without TLS | The server refuses it | REQ-005 |

---

## 7. Success metrics and how the counts are proved

`check.py` prints four things: a note count over the four space folders, a
problem count and its list, the stale list, and the advisories. It never counts
sources, tasks, questions or edges, because `notes()` globs the space folders
alone. So the diff proves parity on what it emits, and nothing more.

The remaining counts need a second counter, and REQ-033 governs it. Independence
is the property that makes it worth having, so it is structural rather than
promised: the counter is a Python script beside `check.py`, which cannot import
the migration's TypeScript parser even by accident. A shared misreading therefore
cannot make both sides agree while both are wrong.

`check.py` raises six kinds of problem, and every one sets a non-zero exit: the
120-note space ceiling, the 200-character description, an unknown `type`, an
unknown `status`, `verified` without `verified_by`, and a wikilink with no note.
None of the six is an advisory. REQ-031 ports all six with their message text
unchanged, because the diff compares text rather than meaning.

| Metric | Baseline | Target | Measurement |
|---|---|---|---|
| Facts migrated with provenance intact | 0 rows exist | 17 | `facts` row count, and `generated_by` populated on each |
| Sources migrated | 0 rows exist | 32 | `sources` row count against the independent counter |
| Tasks, questions and edges | 0 rows exist | The independent counter's figures | The two counters agree exactly |
| Diff against `check.py` | Not comparable until the new checks exist | Empty, or every difference carries a written reason | `scripts/verify-migration.sh` exits zero |
| Gates running as code rather than prose | 0 of 4 | 4 of 4, each with a passing, a failing and a boundary test | The test suite |
| Frontmatter keys unmapped to a column or edge | Not measurable before the mapping exists. The target is absolute | 0 | The mapping test over the real vault |
| Silent skips during the vault read | Not measurable before the reader exists. The target is absolute | 0 | Files read equals the file count on disk |

### Verification that must be done by hand

Four acceptance criteria cannot run in the test suite. They are listed here so
the slice is not reported complete on a green suite alone.

1. REQ-004: a connection attempt from outside the LAN is refused.
2. REQ-005: a client offering no TLS is refused.
3. REQ-022: a read of `test/fixtures/` finding no customer content. A green
   suite says nothing about this, so it is signed off by a person or it did not
   happen.
4. NFR-003: a reboot, then a query during a transcode burst.
5. NFR-004: the backup runbook followed end to end, with a restore into a
   scratch database.

---

## 8. Dependencies

### Internal

| Dependency | Type | Status | Impact if unavailable |
|---|---|---|---|
| The Obsidian vault at `~/Development/obsidian_vaults/Memory` | Data | Present: 17 facts, 32 sources | The migration has no input |
| `scripts/check.py` in the vault | Code | Present, 361 lines | The verification loses its known-good original, which is the slice's main proof |
| nabium's `docs/runbooks/postgres-tuning.md` | Reference | Present | Tuning falls back to defaults sized for a dedicated server |
| nabium's `docs/runbooks/database-backup.md` | Reference | Present | The backup runbook is written from nothing |
| amaterasu | Infrastructure | Reachable over SSH, 6.8 GB free, no Postgres | Nothing can be provisioned |

### External

| Dependency | Type | Status | Impact if unavailable |
|---|---|---|---|
| PGDG repository for Ubuntu noble | Packages | `postgresql-18` and `postgresql-18-pgvector` both present | Fall back to 17, which the same repository carries |
| Voyage AI | API | Key not yet issued, and the model is not yet chosen | REQ-026 stalls. REQ-010 still needs the model named, because the column width depends on it |
| Anthropic, through the Claude CLI | API | In use by existing jobs | Gates 1 and 2 call it at run time. No test and no continuous integration run calls it, per REQ-018 |

---

## 9. Security and compliance

### Threat model

Slice one ships no interface and no public URL, so the realistic threats are
local. Two matter. Another device on the same LAN can observe traffic between
the Mac and amaterasu, which is why REQ-005 requires TLS. And anyone with
physical access to amaterasu can read its disk, which section 13 records as an
open item rather than a closed one.

| Area | Requirement | Implementation |
|---|---|---|
| Authentication | The database rejects anonymous connections | `scram-sha-256` in `pg_hba.conf`, with the Mac's LAN address allowed and nothing wider |
| Authorization | The application role holds the least privilege that works | `kpa` owns the schema and is not a superuser. No second role is created, because nothing in this slice consumes one |
| Network exposure | The database is unreachable from outside the LAN | `listen_addresses` names the LAN address. The server never binds `0.0.0.0`, and no port is forwarded |
| Transport | Content is encrypted between the Mac and amaterasu | A certificate on the server, `sslmode=require` or stronger on the client, verified through `pg_stat_ssl` |
| Injection | Note content never reaches the query planner as text | Parameterised statements throughout. Imported material under `sources/` is the least constrained input and takes the same path |
| Data protection | No secret enters the repository | `.env.example` carries names and no values. Real values live outside the repository, readable by the owner only |
| Data protection | Secrets reach a systemd unit without appearing in a unit file | `EnvironmentFile=` pointing at a root-owned file with mode 0600 |
| Data protection | Test fixtures carry no customer material | Fixtures are synthetic, per REQ-022 |
| Audit | A retirement records who set `valid_to`, and whether the date was inferred | `generated_by` and `verified_by` stay separate, and `valid_to_inferred` records the uncertainty |

### Compliance

Slice one holds Collibra customer material, because six of the 17 facts sit in
the `collibra/` space. The brief records the position: Shane is the decision
maker and has accepted the exposure directly, and the employer policy checklist
is not a gate. This PRD records that position rather than re-opening it.

Two consequences belong in this slice. The database must not be reachable from
outside the LAN, and the traffic must be encrypted, because the material now
sits in a service rather than in files on a laptop. And the Collibra and Koinon
wall is a guideline with nothing in the database enforcing it, so the cross-space
advisory check is the only signal that a boundary was crossed. That check is
therefore a P0 part of REQ-020 rather than an advisory nicety.

---

## 10. Risks and mitigations

| Risk | Description | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The schema is wrong | Every later slice writes into it, so a mistake becomes a migration for everything built afterwards | M | H | Judge the slice on the schema rather than on 17 rows arriving. REQ-008 fails on any unmapped key, and REQ-009 makes every edge endpoint a real foreign key |
| The verification window closes | The diff against `check.py` is available only while the vault exists | M | H | Shane chose to retire the vault in a later slice, so both systems stay alive through slice one |
| The vault sits paused for an undated slice | REQ-023 unloads the three jobs, so the vault stops being maintained and the nightly review stops running for as long as the slice takes | M | M | The runbook names the restore command per job, so the pause is reversible in one step. The slice has no date, which is what makes this a real cost rather than a formality |
| Developing live against amaterasu | Tests share a box with a transcode monitor that takes all twelve threads, and need the LAN | H | M | REQ-003 puts tests in `kpa_dev`, so a test never touches the migration's data. A slow test run is a delay, not a defect |
| Silent parse failure | A note that parses subtly wrong enters as a fact and reads as true for months | M | H | REQ-013 fails loudly and reports totals. Silence is the failure mode the reader is designed against |
| A gate passes on error | An exception or a hedged model answer treated as a pass writes an unverified fact | M | H | REQ-016 defaults to reject. A throw rejects, and anything that is not a clean pass or fail is an error, which also rejects |
| Live model calls inside the test suite | Gates 1 and 2 call the model, and REQ-028 runs the suite on every push. Unmocked, that is cost, flakiness and the rate limit the brief already names against the Claude subscription | H | M | REQ-018 puts every call behind one interface and backs the tests with recorded responses. The suite passes with the network unavailable |
| Employer material in a networked service | Collibra customer facts move from files on a laptop into a database | M | H | LAN-only binding, TLS in transit, and synthetic fixtures. Accepted risk otherwise, per the brief |
| Voyage key and model unchosen | Embedding cannot run, and the vector column cannot be declared | M | M | REQ-010 forces the model choice into the schema story, where the column is declared. REQ-026 is the only P1 that needs the key |
| One person holds every skill | The slice spans Postgres administration and tuning, systemd, TypeScript tooling, and prompt design for two model-calling gates, and one person does all of it with no date to absorb a gap | H | M | Named rather than mitigated. The story order puts the operational work first, so a skill gap surfaces before the application code depends on it |
| The board misdirects the work | All sixteen blocking links run backwards, so the selector offers stories that are not ready | H | M | Section 0 corrects every link during `plan`, then reads the graph back with the documented rule rather than the rule that produced the fault |

---

## 11. Sequence and milestones

Slice one carries no delivery date, so this section states order rather than
dates. The corrected dependency graph is seven stories deep, and that depth is
the schedule. `plan.md` carries the graph itself and the crosswalk from each
milestone below to the stories that satisfy it.

| Milestone | Success criteria |
|---|---|
| The vault is frozen | The three launchd jobs are unloaded and disabled, the vault's git `HEAD` is recorded, and the restore steps are written down |
| The platform stands up | PostgreSQL 18 with pgvector answers on amaterasu over TLS, and a clean clone migrates and tests against it |
| The schema exists | Every frontmatter key maps to a column or an edge kind, the embedding model and width are pinned, and the mapping test passes over the real vault |
| The vault reads | All 17 facts and 32 sources parse with zero silent skips |
| The rules are code | Four gates and three retirement paths are tested, no test calls a live model, and the sweep never sets `valid_to` |
| The migration is proved | The diff is empty, both counters agree, and the vault's `HEAD` has not moved since the freeze |

The two P1 requirements sit outside this chain. REQ-026, embedding, follows the
schema and can land any time after it. REQ-028 and REQ-029, continuous
integration and the repository's `CLAUDE.md`, follow the workspace and block
nothing.

---

## 12. Out of scope

Slice one ships none of the following. Each is named because leaving it unnamed
invites it in.

- Any user interface. No Next.js, no dashboard, no chat.
- The worker process and pg-boss. This slice runs no scheduled jobs.
- Mail ingestion, triage, labelling and drafting.
- Nabium integration and the read-only connection to its database. The role
  REQ-002 previously created for it is dropped, because nothing in scope
  consumes it.
- The policy engine and the audit table. The brief lists `policies` and `audit`
  as tables the migration touches. They arrive with the slice that acts
  autonomously, because a policy table with nothing consulting it is scaffolding.
- Retirement of the vault. The three launchd jobs pause under REQ-023 and the
  vault itself stays, because REQ-030 depends on both systems existing.
- The journal that crosses a machine boundary. `journal.py` renders from Claude
  Code transcripts on the Mac, and it needs the same treatment as nabium.
- Populating `entities`. The table exists in the schema. Every note in a space
  becomes a `facts` row this slice, whatever its `type`, and entity resolution
  arrives with the slice that ingests a second source of people.
- Migration of the vault's `index.md` question and Decisions tables. Both are
  empty, and Shane chose to drop the story and rescope it in a later brainstorm.
- Cloudflare Access, WorkOS and remote access of any kind.

---

## 13. Open questions

| # | Question | Status | Answer |
|---|---|---|---|
| 1 | Which Voyage model, and at which output dimension? | Closed 27 August 2026 by KPA-26 | `voyage-4` at 1024 dimensions, held in `src/embedding.ts`. `voyage-3` is now listed as legacy. The brief's decision table is corrected to match |
| 2 | Where does `log.md` land: a table, a set of ADRs, or a kept document? | Open | Decided inside REQ-027's story, and recorded there |
| 3 | Has the Voyage AI key been issued? | Open | Blocks REQ-026 only |
| 4 | Is amaterasu's disk encrypted, and are its backups? | Open, recorded not closed | The security lens raised both as critical. Offered alongside TLS in transit and not selected, so the exposure stands unmeasured |
| 5 | Should a purge path exist for employer material? | Open, recorded not closed | Nothing can delete a fact, so no destruction route exists even in principle. Offered and not selected |
| 6 | Which second factor does WorkOS enforce? | Open, deferred | Carried from the brief. Nothing in slice one depends on it |
| 7 | Are nabium's Teams and chat collectors built? | Open, deferred | Carried from the brief. Nothing in slice one depends on it |
| 8 | Which channel carries push notifications? | Open, deferred | Carried from the brief. Nothing in slice one depends on it |

---

## 14. Documents this PRD makes stale

`docs/project-brief.md` line 691 lists "Port the two tables on `index.md`" as
step 5 of the migration. Both tables are empty and the story is dropped, so the
brief is now wrong on that step. The brief is the source these stories derive
from, and where the two disagree the brief gets fixed rather than the story
rewritten. A task in `plan.md` carries the correction.

---

## Appendix

### A. Gap analysis

| # | Topic | Status | Summary |
|---|---|---|---|
| 1 | Problem statement | Covered | Section 1 |
| 2 | Target users | Covered | Section 2. One user, one hedge column, and both operator paths |
| 3 | Proposed solution | Covered | Section 3, including the node registry and the full frontmatter mapping |
| 4 | Success metrics | Covered | Section 7, with the two counters separated and manual verification listed |
| 5 | Constraints | Covered | 7.6 GB of RAM shared with a transcode monitor, per NFR-001 and NFR-003 |
| 6 | Tech stack | Covered | PostgreSQL 18, pgvector, TypeScript on Node 22 over the `pg` driver, with a committed lockfile |
| 7 | Performance requirements | Covered | NFR-001 to NFR-003 |
| 8 | Security considerations | Covered | Section 9, with a threat model. Two items stay open in section 13 by choice |
| 9 | Dependencies | Covered | Section 8. Every one verified by a command |
| 10 | Out of scope | Covered | Section 12. Ten exclusions, each named |
| 11 | Risks | Covered | Section 10. Eleven risks with mitigations |
| 12 | Timeline expectations | Partial | Section 11 states order and no dates, because no date was given |

### B. References

| Document | Location |
|---|---|
| Discovery | `discovery.md` |
| Review | `review.md` |
| Plan | `plan.md` |
| Project brief | `../../project-brief.md` |
| Decisions | `../../adr/` |
| Vault conventions | `~/Development/obsidian_vaults/Memory/CLAUDE.md` |
| Postgres tuning | `~/Development/personal/nabium/docs/runbooks/postgres-tuning.md` |
| Database backup | `~/Development/personal/nabium/docs/runbooks/database-backup.md` |

### C. Glossary

| Term | Definition |
|---|---|
| The vault | The Obsidian vault at `~/Development/obsidian_vaults/Memory`, holding 17 facts and 32 sources |
| Fact | One compiled record that passed the four gates. One fact per record, one row per note in a space |
| Source | Raw material, stored verbatim and never edited |
| Space | One of `collibra`, `koinon`, `personal` and `shared`. Retrieval filters by space by default |
| Node | A row in the registry every edge endpoint points at. Its kind is `fact`, `source`, `entity`, `url` or `unresolved` |
| Gate | One of the four tests in section 3 that a candidate passes before it becomes a fact |
| Stale | A fact past its `stale_after` date. Due for review, not false |
| Retired | A fact carrying a `valid_to` date. Kept, and queryable as at an earlier date |
| amaterasu | A 2018 Mac mini running Ubuntu 24.04, on the LAN at 192.168.20.110 |
| nabium | Shane's macOS meeting recorder, which feeds Sukkal in a later slice |
