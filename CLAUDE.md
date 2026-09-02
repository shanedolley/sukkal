# KPA conventions

Read `docs/project-brief.md` first. It carries the architecture, the decisions,
the policy the assistant operates under, and the risks accepted. `docs/adr/`
holds the decisions that were hard to reverse.

Work is tracked in Jira project KPA on `koinon.atlassian.net`.

## The golden rule: verify in both directions

A finding is unverified until you have run something that proves it, whoever
produced it. Both directions have paid, and each one caught a defect the other
would have missed.

**Verify inward.** Check what somebody else reports before you act on it or
repeat it. A subagent's report, a comment in the code, a paragraph in a runbook:
open the source. A subagent once reported an audit table as append only and it
was, against `UPDATE` and `DELETE`. `TRUNCATE` emptied it in one statement and
fired no trigger, and only running the statement found that.

**Verify outward.** Before reporting your own finding, run the thing that would
fail if you were wrong. Two claims made here on 2 September 2026 were wrong:
that the vault held 17 facts, and that `check.py` reported three cross-space
links. Both came from reading truncated output. The vault holds 19 and the
links number four.

**A subagent that contradicts you has been right.** Check the claim rather than
the source of it. One was told three cross-space links, ran `check.py` three
times, reported four, and was correct.

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
| `npm run lint` in `apps/web` | The same `oxlint`, with the react, nextjs, jsx-a11y and import plugins on. `apps/web/.oxlintrc.json` carries every suppression and its reason |
| `npm run build` | `tsc --noEmit`. It checks types and emits nothing |
| `npm test` | `node --test` over `test/**/*.test.ts` |
| `npm run migrate` | Applies pending migrations. `npm run migrate down` reverses every one |
| `npm run worker` | Runs the worker and its pg-boss queue. `docs/runbooks/worker.md` |
| `./scripts/scan-history.sh` | Scans every commit for a credential. Run it before you push |

Run the lint, the build and the tests before you report anything finished, and
watch the run afterwards with `gh run list --limit 1`. A push nobody watches is
how the trunk went red on 2 September 2026 and stayed red across two pushes,
found only because Shane asked what CI said.

`.github/workflows/ci.yml` runs two jobs. `check` runs the root's three commands
against PostgreSQL 18 with pgvector 0.8.6, the versions amaterasu runs, and
migrates nothing because no database it could migrate exists in a runner. `web`
installs both packages and runs `npm run check`, `npm run build` and
`npm run lint` inside `apps/web`.

**Run the suite the way CI runs it, which is without the vault.** Several tests
read the frozen Obsidian vault, and it exists on this Mac and nowhere else, so a
suite green here can be red there for that reason alone. Every vault-reading
suite builds a `vaultReason` and skips on it; `test/read-vault.test.ts` shows
the pattern.

```
VAULT_PATH=/nonexistent DATABASE_URL_TEST=... node --test "test/**/*.test.ts"
```

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

**amaterasu is often unreachable from the Mac**, and the connection then hangs
for 75 seconds per suite rather than failing. This Mac runs Homebrew PostgreSQL
17 with pgvector 0.8.6, the same extension version, so a local database tests
everything. The loopback rule above is what makes it work without weakening
anything.

```
createdb kpa_dev && psql -d kpa_dev -qc "CREATE EXTENSION IF NOT EXISTS vector"
DATABASE_URL_TEST="postgresql://$(whoami)@localhost:5432/kpa_dev" npm test
```

## Layout

```
migrations/     One .sql file per migration, applied in filename order
apps/web/       The Next.js interface. Its own package, its own node_modules
src/db/         The connection module and the migration runner
src/memory/     The four gates, the inference seam, the state rule and the sweep
src/migrate/    The vault reader, and what it turns notes into
src/checks/     check.py ported: six problems that fail, four advisories that do not
src/webhooks/   What an inbound delivery is authenticated and stored by
src/worker/     The worker process, and the jobs pg-boss runs in it
test/           The suite, and its fixtures under test/fixtures/
docs/adr/       Decisions that were hard to reverse
docs/runbooks/  Operating the server, and where the secrets live
scripts/        Provisioning and checks, all bash
```

**A `date` comes back as a string, not a `Date`.** `src/db/connect.ts` says so
to the driver. Parsing a calendar date into a `Date` puts it at local midnight,
and reading that back as UTC moves it a day west: a fact retired on 1 June
reads as 31 May from Sydney. Compare dates as `YYYY-MM-DD` text.

**The driver is installed twice, and a parser reaches one copy.** `apps/web`
has its own `node_modules/pg`, so a bare `pg` resolves to the root's copy in
`src/` and to the web tier's copy in `apps/web/`. They are two module
instances with two type registries. `connect.ts` exports `keepDatesAsText` for
that reason and `apps/web/lib/db.ts` calls it with its own registry. Without
that call a source dated 19 August read as the 18th from Sydney, which is how
this was found on 2 September 2026. KPA-68 leaves one copy and ends it.

**oxlint is installed twice, and both copies name the same exact version.**
The root and `apps/web` each pin `1.80.0` rather than a caret range, because
`^1.80.0` resolves to 1.81.0 today and two versions is two rule sets. KPA-135
asked for one linter across both packages, so bump both together. The plugin
lists differ on purpose: `src/` and `test/` hold no JSX, so the root runs
three plugins and the web tier runs seven. KPA-68 leaves one copy and ends
this too.

**Both packages run TypeScript 7.0.2, the native compiler.** `apps/web` ran
5.9.3 until KPA-135. A cross-package import still names the `.ts` extension,
and `allowImportingTsExtensions` is what lets 7.0.2 accept it: turn that
option off and the native compiler reports `TS5097` on all ten imports.

**`npm test` leaves the database with no tables, so an `apps/web` check run
after it fails.** `npm run check` reads real rows when `DATABASE_URL_TEST` is
set, and the suite ends on a `down()`, so the next check reports `42P01`,
relation does not exist. That is the suite's own tidying rather than a defect.
Apply the migrations again before the check, or unset `DATABASE_URL_TEST`,
which is what CI does and why its web job skips those reads. Cost this session
a detour on 3 September 2026.

**A test run piped into `tail` reports `tail`'s exit code, not the test's.**
`node --test ... | tail -6` exits 0 on a run that failed. Read `# fail N` in
the output rather than checking `$?`, or drop the pipe. Proved on 2 September
2026: the same failing run reports 0 piped and 1 unpiped. It hid a failing
hook from an agent that trusted the code, and it would have hidden one from
this session's own integration passes, which survived only because they read
the count.

**Pass `--test-concurrency=1` to a bare `node --test` over more than one
file.** `npm test` carries the flag and a hand-written run does not. Two files
against one database in parallel produced 31 cancelled tests and two migration
errors that meant nothing.

**A read that narrows in SQL is never narrowed again in the browser.**
`spacesFor` in `apps/web/lib/space.ts` carries `shared` with every space, so
the SQL returns it. `inSpace` keeps one space and discards the rest, so calling
it on rows the SQL already narrowed drops every `shared` row. The screen then
shows fewer rows than the query returned, and nothing fails. Found on
2 September 2026 in an integration pass, on the briefing, both review pages and
the sidebar at once, after an agent had warned about the same shape on its own
screen. ADR-0018.

**A cross-package import from `apps/web` names the `.ts` extension.**
`../../../src/db/connect.ts`, not `../../../src/db/connect`. Turbopack
resolves either, and `node --experimental-strip-types` resolves only the
first, so a check under `apps/web/scripts/` can run the real module rather
than a copy of it. `allowImportingTsExtensions` in `apps/web/tsconfig.json` is
what lets `tsc` accept it.

**A gate's prompt is a file, never a string in code.** `src/memory/prompts/`
holds them, and the gate reads its file on every call, so a renamed prompt
throws and rejects the candidate rather than judging it by nothing. The default
everywhere in `src/memory/` is to reject: a gate that throws rejects, and a
model answer that is neither a clean `PASS` nor a clean `FAIL` rejects.

A migration file carries both directions, separated by a line reading
`-- @down`. The runner refuses rather than guesses: a database holding tables
it did not create stops it, and so does a second run with nothing left to
apply. Neither is a bug. Read what it names.

## Running subagents in parallel

Three or four agents on one repository works here, and every round has found
defects. Each agent proves its own work and none can see the interaction, so
the orchestrator supplies what they cannot.

**Give each agent its own database.** Concurrent `down()` and `up()` cycles on
one database produce failures that mean nothing. `kpa_dev_a` through `kpa_dev_d`
is the pattern.

**Have each run only its own test file.** `npm test` runs the other agents'
half-written work, and the phantom failures cost more than the coverage buys.

**Name the files each agent owns, and name the shared ones you own.** In this
repository those are `docs/schema.md` and `test/schema.test.ts`, and both change
in almost every round. An agent that needs a section writes it to a scratchpad
file and you integrate it.

**Tell each agent to grep for every caller of anything it changes.** One round
ended with 18 failures because a migration dropped a column that four other
files still wrote, including production code, and every agent's own tests
passed.

**Keep every git write to yourself.** One commit per story, staged by name,
after the integration pass.

### The integration pass

The orchestrator runs this, and it is where the value is:

1. Run the full suite on a fresh database, both with the vault and without it.
2. Reconcile the shared files.
3. Verify each agent's load-bearing claims against the source.
4. Commit, push, and watch the run.

Expect step 3 to find something. A citation that could open the wrong passage
under the right title, a sweep that raised nothing at all, and an audit log one
statement could empty were each found this way and none in the story that wrote
it.

## Committing

The rules are in *Committing: push straight to main* above. Nothing else.

One commit per story. Stage the files by name, and never `git add -A`.
