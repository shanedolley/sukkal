# Sukkal conventions

Read `handover.md` first. It carries where the work stands, what runs, and the
traps found since the last session. `prompt.md` beside it is what a fresh
session is given. The two replaced `docs/session-handoff.md` on 12 September
2026.

Then read `docs/project-brief.md`. It carries the architecture, the decisions,
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
| `npm run lint` | `oxlint` over `src`, `test` and `scripts`. A warning fails the run |
| `npm run lint` in `apps/web` | The same `oxlint`, with the react, nextjs, jsx-a11y and import plugins on. `apps/web/.oxlintrc.json` carries every suppression and its reason |
| `npm run build` | `tsc --noEmit`. It checks types and emits nothing |
| `npm test` | `node --test` over `test/**/*.test.ts` |
| `npm run migrate` | Applies pending migrations. `npm run migrate down` reverses every one |
| `npm run worker` | Runs the worker and its pg-boss queue. `docs/runbooks/worker.md` |
| `./scripts/scan-history.sh` | Scans every commit for a credential. Run it before you push |
| `./scripts/reset-password.sh` | Sets the owner's password on the box itself. `--link` prints a reset link, `--unlock` ends a run of failed sign-ins |
| `npm run decisions` | Rebuilds `docs/decisions.md` from the decision blocks in Jira |
| `./scripts/verify-migration.sh` | Loads the frozen vault into a fresh `sukkal_verify` and diffs it against `check.py`. `docs/runbooks/migration-verification.md` |

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

Two databases on amaterasu at `192.168.20.110`, both owned by the `sukkal` role.

| Variable | Database | Written by |
|---|---|---|
| `DATABASE_URL` | `sukkal` | The migration. It holds the facts |
| `DATABASE_URL_TEST` | `sukkal_dev` | Every test and every rehearsal |

**Production was called `kpa` until 30 September 2026**, when KPA-154 renamed
the database and the role. A record older than that names `kpa`, and means
`sukkal`. `PRODUCTION` in `src/db/connect.ts` holds `sukkal` alone.

**Never point the running application at `sukkal_dev`.** The suite ends on
`down()`, which drops every table, so a test run destroys whatever the app put
there. On 10 September 2026 it destroyed three Google OAuth connections that
had taken a person three consent screens to create, and the tokens survived at
Google where nothing could reach them to revoke. Use a third database:

```
createdb sukkal_local && psql -d sukkal_local -qc "CREATE EXTENSION IF NOT EXISTS vector"
DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_local" npm run migrate
cd apps/web && DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_local" npm run dev
```

`sukkal_dev` is for tests, which own it and drop it. `sukkal_local` is for the
running app, and no test names it.

**`npm run migrate` reads `DATABASE_URL` and ignores `DATABASE_URL_TEST`.**
Writing `DATABASE_URL_TEST=... npm run migrate` points it AT production rather
than away from it, which is the shape of the mistake: the prefix reads like a
safety measure and is none. An agent did exactly that on 3 September 2026 and
put all 21 migrations into `kpa`. Nothing was lost, because `kpa` was empty and
the runner refuses a schema holding tables it did not create.

The command now names the database before it acts and refuses every name in
`PRODUCTION`. `SUKKAL_ALLOW_PRODUCTION=1 npm run migrate` migrates it
deliberately. To reach any other database, set `DATABASE_URL` itself.

**Never point a test at production.** Separating the two is the whole reason
`sukkal_dev` exists. Every test calls `refuseProduction` from
`src/db/connect.ts` after it connects, and that function asks the server which
database it reached rather than reading the connection string, because a string
can name one database and `PGDATABASE` reach another.

A refused run reports `# fail 0`, because the throw lands in a `before` hook
and Node cancels the tests rather than failing them. Read the exit code or
`# cancelled N` as well as `# fail N`.

Values live at `~/.config/sukkal/env`, mode 0600, outside the repository.
`docs/runbooks/secrets.md` says why and how to create it.

`src/db/connect.ts` is the only place a connection opens. It reads a named
environment variable, refuses a remote host that does not encrypt, and lets a
loopback host through in the clear.

**amaterasu can look unreachable from the Mac when it is up**, and the connection
then hangs for 75 seconds per suite rather than failing. On 13 October 2026 the
cause was the macOS Local Network permission of the terminal app (Orca), not the
box. Ping another LAN host such as `192.168.20.10` before you call it down: if
only the router answers, the permission is the cause. This Mac runs Homebrew PostgreSQL
17 with pgvector 0.8.6, the same extension version, so a local database tests
everything. The loopback rule above is what makes it work without weakening
anything.

```
createdb sukkal_dev && psql -d sukkal_dev -qc "CREATE EXTENSION IF NOT EXISTS vector"
DATABASE_URL_TEST="postgresql://$(whoami)@localhost:5432/sukkal_dev" npm test
```

## Layout

```
migrations/     One .sql file per migration, applied in filename order
apps/web/       The Next.js interface. A workspace of the root package
src/auth/       Hashing a password, holding a session, and resetting one
src/connections/  Sealing a provider's credential, and reading it back
src/db/         The connection module and the migration runner
src/memory/     The four gates, the inference seam, the state rule and the sweep
src/migrate/    The vault reader, the load into Postgres, and the verification
src/checks/     check.py ported: six problems that fail, four advisories that do not
src/webhooks/   What an inbound delivery is authenticated and stored by
src/worker/     The worker process, and the jobs pg-boss runs in it
test/           The suite, and its fixtures under test/fixtures/
docs/adr/       Decisions that were hard to reverse
docs/decisions.md  Every lighter ruling, generated from Jira by npm run decisions
docs/runbooks/  Operating the server, and where the secrets live
scripts/        Provisioning and checks. Bash, the decision register, and the migration verification
```

**A `date` comes back as a string, not a `Date`.** `src/db/connect.ts` says so
to the driver. Parsing a calendar date into a `Date` puts it at local midnight,
and reading that back as UTC moves it a day west: a fact retired on 1 June
reads as 31 May from Sydney. Compare dates as `YYYY-MM-DD` text.

**`apps/web` is a workspace of the root, so one `npm install` at the root
installs both packages.** KPA-68 made it one on 3 September 2026. One lockfile
remains, at the root, and npm hoists `pg`, `oxlint` and `typescript` into the
root `node_modules`. `src/db/connect.ts` and `apps/web/lib/db.ts` therefore
share one driver and one type registry, and one linter reads both packages.
`npm install` run from inside `apps/web` walks up and installs at the root, so
no second lockfile appears there. Never commit a lockfile under `apps/web`.

**Bump a shared dependency in both `package.json` files together.** The two
declare `pg`, `oxlint`, `typescript`, `@types/pg` and `@types/node`
separately, and npm hoists one copy only while the ranges agree. Bump one and
npm nests a second copy under `apps/web`: two linters with two rule sets, or
two drivers with two type registries, where a source dated 19 August reads as
the 18th from Sydney. `oxlint` is pinned at exactly `1.80.0` in both for that
reason rather than at a caret range, and `apps/web/lib/db.ts` still calls
`keepDatesAsText` on its own registry as insurance against the second copy.
The plugin lists differ on purpose: `src/` and `test/` hold no JSX, so the
root runs three plugins and the web tier runs seven.

**A shared package holding `src/db` was weighed and rejected.** The web tier
imports twelve modules under `src/`, not one: `auth/password.ts`,
`auth/session.ts`, `auth/reset.ts`, `auth/attempts.ts`,
`connections/oauth.ts`, `connections/store.ts`, `connections/crypto.ts`,
`webhooks/receive.ts`, `db/connect.ts`, `memory/state.ts`, `memory/source.ts`
and `embedding.ts`. A package holding `src/db` alone closes one import of 24,
and it needs the workspace to link it anyway. Reach for it when a second
repository consumes `src/`.

The counts grow, and each recount has strengthened the case for rejecting the
package rather than weakened it. KPA-68 measured five modules and seven
imports. Both were counted again on 30 September 2026 while accepting that
story.

**Both packages run TypeScript 7.0.2, the native compiler.** `apps/web` ran
5.9.3 until KPA-135. A cross-package import still names the `.ts` extension,
and `allowImportingTsExtensions` is what lets 7.0.2 accept it: turn that
option off and the native compiler reports `TS5097` on every one of the 88
imports under `apps/web` that names the extension. 24 of the 88 reach across
into `src/`. Counted on 30 September 2026.

**`npm test` leaves the database with no tables, so an `apps/web` check run
after it fails.** `npm run check` reads real rows when `DATABASE_URL_TEST` is
set, and the suite ends on a `down()`, so the next check reports `42P01`,
relation does not exist. That is the suite's own tidying rather than a defect.
Apply the migrations again before the check, or unset `DATABASE_URL_TEST`,
which is what CI does and why its web job skips those reads. Cost this session
a detour on 3 September 2026.

**A form seeded from a store now needs re-seeding.** `useState(saved)` reads
the store once, and a store backed by `fetch` answers after the first render,
so the form keeps the fallback for good.
`apps/web/components/projects/project-detail-settings.tsx` sets the draft
during the render when the row it was seeded from changes, which is React's own
answer to a prop that changes. Every screen that moves off `localStorage` meets
this, and nothing fails: the form simply shows the wrong value. Found on
3 September 2026 in KPA-127.

**Removing a page fails `npm run build` until the generated types go.** Next
writes `apps/web/.next/dev/types/validator.ts` naming every route it has seen,
and `tsc` reads it, so a deleted page reports `TS2307: Cannot find module
'../../../app/(auth)/sign-up/page.js'` in a file nobody wrote. Remove
`apps/web/.next/dev/types` and build again. The error names the page you
removed, which reads like the removal was wrong and is the opposite. KPA-128,
3 September 2026.

**This shell has `noclobber` on, so `>` onto a file that exists fails.** The
redirect writes nothing and the command after it runs on the stale file, which
is how a run reported 360 tests when the true count was 407. It cost an agent
a cycle on 3 September 2026 and cost this session one the same night. Use `>|`
to overwrite deliberately, or write to a new path. It is the same family as the
`tail` trap below: the command reports a number and the number is from before.

**The delete guard refuses a whole Bash call it cannot parse, and it has done so
with no `rm` in the command.** Three calls were refused on 12 and
13 September 2026: a `python3` heredoc followed by a delete, a heredoc writing a
TypeScript file holding the JavaScript `delete` operator, and a commit message
passed to `git commit -F -`. The result reads `Could not parse this command to
verify delete safety`, and nothing in the call ran, including what came before
the part it objected to. Write long text through the Write tool and pass the
path, as in `git commit -F <file>`.

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

**A check script cannot import a `.tsx` file.** Node strips types and leaves
JSX alone, so an import of a component answers
`ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".tsx"`. A check on a
component reads its source instead, which
`apps/web/scripts/check-avatar.ts` shows: it is the one check that imports
nothing from the application. Three others read a source file beside importing a
real module, because part of what they assert lives in a string rather than in an
export. KPA-151, 12 September 2026.

**A Tailwind size class is not a pixel count.** `size-16` renders at 64px and
`size-24` at 96px, because `--spacing` is `0.25rem` and the class multiplies
it. KPA-151 named a risk at "16px" that was `size-16` read as pixels, and the
real smallest size on any screen is four times that. Read the number from
`.next/static/chunks/*.css` or from `getBoundingClientRect` rather than from
the class name.

**`apps/web` declares `"type": "module"`, so a test may import from it.**
KPA-139 added the field on 3 September 2026. Node and `tsc` both read the
package as ESM now, which ends two things: a file under `test/` reaches a
constant in `apps/web/lib` through a plain static import, and `npm run check`
runs its scripts in silence. Before, that import needed a variable
specifier to dodge `TS1287`, which `tsc` reported in the imported file rather
than the importing one, and fifteen of those scripts each printed
`MODULE_TYPELESS_PACKAGE_JSON`. `test/workspaces.test.ts` shows the import.

**The root type check judges every `apps/web` file a test imports, and one
setting still differs.** The root sets `moduleResolution: nodenext`, so a
relative import inside a file it reaches names the `.ts` extension:
`apps/web/lib/workspaces.ts` and `apps/web/lib/fixtures.ts` both import
`./types.ts` for that reason, where the rest of the web tier omits it under
`bundler`. It announces itself as `TS2835` and costs one character, and a
resolution failure also makes a callback parameter implicitly `any`, so
`TS7006` beside it is the same fault rather than a second one.

**Both packages set `noUncheckedIndexedAccess`.** KPA-141 turned it on in
`apps/web` on 3 September 2026 and fixed the 24 errors it found, so one indexed
read now types the same way under both checks and a test imports any web module
plainly. `list[0]` is `T | undefined`: guard it, or state the invariant in the
type. `Provider.methods`, `SPACE_OPTIONS`, `LABEL_DOTS` and `CHAT_ANSWERS` are
non-empty tuples for that reason, which is what makes index 0 a value rather
than a maybe.

**That cleanup finished on 30 September 2026, three weeks late.** KPA-141
converted `test/workspace-fields.test.ts` to a plain static import and left
`test/issues.test.ts` and `test/sprints.test.ts` behind. Both still reached
`apps/web/lib/fixtures.ts` through a variable specifier, and both explained it
by saying `apps/web/tsconfig.json` omits `noUncheckedIndexedAccess`, which it
had not since 3 September. A comment defending a workaround with a reason the
reader can check and find false costs more than the workaround does. All three
files import the fixtures plainly now.

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
one database produce failures that mean nothing. `sukkal_dev_a` through `sukkal_dev_d`
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
