# Discovery: the slice one plan

## The ask

Analyse the project and the issues that already exist, then set the project up
properly. Shane refined this to: follow the brainstorm process, and verify and
consolidate the existing Jira tickets through the scoring, expansion and
research the workflow specifies.

## What exists today

The repository holds documentation and no code. `docs/project-brief.md` runs to
723 lines and carries the architecture, the sequence diagrams, the policy, the
risks accepted and three open questions. `docs/adr/` holds six decisions. Two
commits stand on `main`.

Jira project KPA holds epic KPA-1, "Slice one: migrate the memory", and twelve
stories under it. Each story carries acceptance criteria, the files it touches,
a test and a definition of done. The descriptions run between 2,200 and 3,300
characters, so the stories are specifications rather than titles.

## What research found

Research checked every external thing the stories depend on. Each item below is
a command that ran, not an assumption.

**The vault matches the stories exactly.** `~/Development/obsidian_vaults/Memory`
holds 17 facts across `collibra/`, `koinon/` and `shared/`, and 32 files under
`sources/`. `scripts/check.py` exists. The stories name all three figures
correctly.

**amaterasu is reachable and empty.** SSH with key authentication works. The box
reports 7.8 GB of RAM with 6.8 GB available. No `psql`, no `node`, and
`systemctl is-active postgresql` returns `inactive`. The brief describes the
machine correctly.

**PostgreSQL 18 with pgvector is packaged.** The PGDG repository for Ubuntu
noble carries `postgresql-18` and `postgresql-18-pgvector`. It also carries 16
and 17.

**nabium's runbooks exist.** `docs/runbooks/postgres-tuning.md` and
`docs/runbooks/database-backup.md` both sit where KPA-2 says they do.

**The Mac carries the development tools.** Node 22.22.0, npm 10.9.4, Homebrew
PostgreSQL 17, and Docker. The three launchd jobs the brief retires all run:
`com.koinon.daily-memory-review`, `com.koinon.gmail-filter-review` and
`com.koinon.weekly-vault-review`.

### Two faults on the board

**All sixteen blocking links run backwards.** Read through the REST API, the
stored graph says `KPA-3 blocks KPA-2`, `KPA-4 blocks KPA-3`, and fourteen more
in the same direction. KPA-13 verifies the migration, so every other story
blocks it, and the board records the reverse. A link on an issue names the other
end, which inverts the type's wording: an entry carrying `outwardIssue: Y` means
Y blocks X. A previous session found this inversion, corrected it with the same
wrong mapping, and re-created the fault.

The consequence is that the next-issue selector offers the stories that are not
ready and hides the ones that are. It reads as working, because it always
returns something.

**Scoring and expansion never ran.** No story carries story points. No story
carries a subtask. The workflow scores each story on the Fibonacci scale and
expands every 8, and neither step happened.

### Four gaps no ticket covers

**Where the migration runs.** The vault sits on the Mac and Postgres will sit on
amaterasu. No story says which machine runs the reader, or how KPA-13 runs
`check.py` and the Postgres checks together across two boxes.

**`log.md` has no destination.** The vault's `log.md` holds the decision history,
newest first. KPA-8 ports `index.md` and nothing ports the log. The vault
retires, so the history needs a home.

**Repository hygiene.** KPA-3 wires a lint script and nothing runs it. No
continuous integration, and no `CLAUDE.md` in this repository recording the
conventions.

**Secrets on amaterasu.** KPA-3 writes `.env.example`. No story says how the real
`VOYAGE_API_KEY` and database URL reach a systemd unit, or where they live on
the box.

### One story research shrank

Both tables on the vault's `index.md` carry headers and no rows. KPA-8 migrates
the questions and Decisions tables, so it has nothing to move.

## Questions and answers

Each entry names the question, the options offered and the answer given.

**Scope.** Asked what "setup this project properly" covers, against KPA-3, KPA-2,
repository hygiene and Jira hygiene. Shane answered: "follow the brainstorm
process. verify the and consolidate the existing jira tickets following task
expansion and research as per the brainstorm workflow".

**Phases.** Asked how the chain should handle the plan Jira already holds, against
skipping to build, running document and plan again, and dropping the workspace.
Shane chose to run document and plan again.

**Board work.** Asked what this run should change, against fixing the sixteen
links, scoring every story, expanding what the score says, and adding stories for
gaps. Shane chose all four.

**Epics.** Asked whether twelve stories under one epic should stay, against
assessing and proposing, keeping one epic, and splitting infrastructure from
migration. Shane chose to assess and propose.

**The PRD.** Asked what the PRD should be, against a thin document referencing the
brief, a full standalone document, and treating the brief as the PRD. Shane chose
the full standalone PRD.

**Stop point.** Asked where this run stops, against stopping after plan and
continuing into build. Shane chose to stop after plan.

**Gaps.** Asked which of the four gaps become stories. Shane chose all four.

**The development database.** Asked which database development runs against,
against local Postgres on the Mac, amaterasu only, and Postgres in Docker. Shane
answered: "can you create a new postgres18 database on amaterasu and develop
live?"

**Decommissioning.** Asked when the vault and its three launchd jobs retire,
against a later slice, slice one after KPA-13, and leaving it unplanned. Shane
chose a later slice.

**KPA-8.** Asked what the story should become given both tables are empty,
against keeping and rescoping it, folding it into KPA-4, and keeping it
unchanged. Shane answered: "drop it. we will rescope later as a new brainstorm".

## What the answers change

**PostgreSQL 18, not "16 or later".** KPA-2 names the version loosely today.
Shane's answer fixes it at 18, and the PGDG repository carries it with pgvector.

**Development runs live against amaterasu.** Tests need the LAN, and they share
the box with a transcode monitor that takes all twelve threads when it fires.
One refinement is worth proposing in the plan: a second database on the same
server, so development never writes into the database that later holds the real
facts.

**KPA-8 closes.** It moves to Done with a comment recording that both source
tables are empty and that a later brainstorm rescopes the work. Its blocking
links go with it.

**Four stories join the epic**, one per gap.

## Classification

**Complex.** Three of the four tests hold. The work spans several systems: two
machines, a Jira board, a Postgres server and an Obsidian vault. It carries real
dependencies, since the corrected graph is seven stories deep. It settles
architectural questions, since the migration's execution boundary and the secret
handling both change how slice one is built.

Complex sends the plan to Jira and requires a PRD, which matches the answers
given.

## Next

`document` writes the PRD for slice one and reviews it through the applicable
lenses.
