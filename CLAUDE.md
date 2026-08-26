# KPA conventions

Read `docs/project-brief.md` first. It carries the architecture, the decisions,
the policy the assistant operates under, and the risks accepted. `docs/adr/`
holds the decisions that were hard to reverse.

Work is tracked in Jira project KPA on `koinon.atlassian.net`.

## Committing: push straight to main

**This project accepts direct commits to `main`.** Shane decided this on
24 August 2026. Do not cut a branch, and do not open a pull request, unless he
asks for one.

This overrides the global rule in `~/.claude/CLAUDE.md`, which requires a branch
and a pull request. That rule still applies to every other project.

**It is temporary.** The repository holds documents, runbooks and setup scripts,
and one person writes all of them. Review by pull request costs more than it
returns while that stays true. Expect this section to be withdrawn once the
application code lands and a second reader has something to review.

`hooks/guard-commit-on-main.py` still denies a commit on `main`, because it
reads no project file. Prefix each command with the override the guard itself
names:

```
KOTHAR_ALLOW_MAIN=1 git commit -m "..."
KOTHAR_ALLOW_MAIN=1 git push
```

That prefix records the decision at the moment it is used, which is the point of
it. Do not disable the hook: it protects every other repository on this machine.

Every other rule in the global `CLAUDE.md` still holds. Absolute paths for every
delete. No destructive git without `KOTHAR_ALLOW_DESTRUCTIVE=1`. Commits credit
Shane and never Claude Code, and end with the `Claude-Session` line.

## Commands

| Command | What it does |
|---|---|
| `npm run lint` | `oxlint` over `src` and `test`. A warning fails the run |
| `npm run build` | `tsc --noEmit`. It checks types and emits nothing |
| `npm test` | `node --test` over `test/**/*.test.ts` |
| `npm run migrate` | Applies pending migrations. `npm run migrate down` reverses every one |
| `./scripts/scan-history.sh` | Scans every commit for a credential. Run it before you push |

Run the lint, the build and the tests before you report anything finished.
`.github/workflows/ci.yml` runs those three on every push, against PostgreSQL 18
with pgvector 0.8.6, the versions amaterasu runs. It never migrates, because no
database it could migrate exists in a runner.

**There is no build step.** Node 22.18 strips types as it loads a file, so
nothing compiles and nothing bundles. `npm run build` is a type check that
writes no output. Import a local module by its real name, `./connect.ts`, not
`./connect.js`.

## Reaching the database

Two databases on amaterasu at `192.168.20.110`, both owned by the `kpa` role.

| Variable | Database | Written by |
|---|---|---|
| `DATABASE_URL` | `kpa` | The migration. It holds the facts |
| `DATABASE_URL_TEST` | `kpa_dev` | Every test and every rehearsal |

**Never point a test at `kpa`.** Separating the two is the whole reason
`kpa_dev` exists, and `test/migrate.test.ts` asserts the database it connected
to is not `kpa`.

Values live at `~/.config/kpa/env`, mode 0600, outside the repository.
`docs/runbooks/secrets.md` says why and how to create it.

`src/db/connect.ts` is the only place a connection opens. It reads a named
environment variable, refuses a remote host that does not encrypt, and lets a
loopback host through in the clear.

## Layout

```
migrations/     One .sql file per migration, applied in filename order
src/db/         The connection module and the migration runner
src/memory/     The four gates, the inference seam, and the prompts they read
test/           The suite, and its fixtures under test/fixtures/
docs/adr/       Decisions that were hard to reverse
docs/runbooks/  Operating the server, and where the secrets live
scripts/        Provisioning and checks, all bash
```

**A `date` comes back as a string, not a `Date`.** `src/db/connect.ts` says so
to the driver. Parsing a calendar date into a `Date` puts it at local midnight,
and reading that back as UTC moves it a day west: a fact retired on 1 June
reads as 31 May from Sydney. Compare dates as `YYYY-MM-DD` text.

**A gate's prompt is a file, never a string in code.** `src/memory/prompts/`
holds them, and the gate reads its file on every call, so a renamed prompt
throws and rejects the candidate rather than judging it by nothing. The default
everywhere in `src/memory/` is to reject: a gate that throws rejects, and a
model answer that is neither a clean `PASS` nor a clean `FAIL` rejects.

A migration file carries both directions, separated by a line reading
`-- @down`. The runner refuses rather than guesses: a database holding tables
it did not create stops it, and so does a second run with nothing left to
apply. Neither is a bug. Read what it names.

## Committing

The rules are in *Committing: push straight to main* above. Nothing else.

One commit per story. Stage the files by name, and never `git add -A`.
