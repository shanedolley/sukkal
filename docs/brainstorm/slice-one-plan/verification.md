# Verification

## Method

The repository holds no test suite and no build step, so there is nothing to
compile or run. Both runbooks written in this pass tell a reader to run
commands, so the verification is to run each read-only one against the live
server and compare the output against what the runbook claims.

Run on 26 August 2026, from the Mac at `192.168.20.107` against amaterasu at
`192.168.20.110`. No destructive command ran: no second backup drill, no reboot,
no restore over `kpa`.

## `docs/runbooks/database-backup.md`

| Claim | Command | Result |
|---|---|---|
| The Mac's `pg_dump` refuses the newer server | `pg_dump --schema-only "$DATABASE_URL"` | `aborting because of server version mismatch`, `server version: 18.6`, `pg_dump version: 17.11`. Matches the quoted error |
| The server's dump tools are 18.6 | `pg_dump/pg_dumpall/pg_restore --version` on amaterasu | All three report 18.6 (Ubuntu 18.6-1.pgdg24.04+2) |
| `pg_dump -Fc` runs against `kpa` | `sudo -u postgres pg_dump -Fc -d kpa \| wc -c` | 1292 bytes. Piped to `wc`, so nothing was written to disk |
| `pg_dumpall -r` emits the `kpa` role | `sudo -u postgres pg_dumpall -r \| grep "^CREATE ROLE"` | `CREATE ROLE kpa;` and `CREATE ROLE postgres;`. The password hash was not printed |
| `pg_restore -l` inspects an archive without touching a database | `pg_dump -Fc -d kpa \| pg_restore -l` | `Format: CUSTOM`, `TOC Entries: 6`, `dbname: kpa` |
| The row-count comparison query runs | `psql -tAX -d $db -c 'SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname'` | Zero rows for `kpa` and for `kpa_dev`. Both hold no user tables yet |
| `~postgres` is `/var/lib/postgresql` | `sudo -u postgres bash -c 'echo $HOME'` | `/var/lib/postgresql`, so the `scp` path in the runbook is right |
| The freshness check reports no backup today | `sudo -u postgres ls -lt /var/lib/postgresql/backups/` | `No such file or directory`. The runbook says to expect this, and why |
| `kpa`'s `public` schema is empty | `SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace` | `0`. This is why the drill's comparison was vacuous |
| The drill ran on the box | `grep kpa_drill /var/log/postgresql/postgresql-18-main.log` | Connections as `postgres@kpa_drill` at 11:55:35, then `DROP DATABASE kpa_drill` at 11:55:36 |
| The drill's count step failed | Same log | `ERROR: syntax error at or near "\"`, statement `... relnamespace = \x27public\x27::regnamespace` |

## `docs/runbooks/postgres-setup.md`

| Claim | Command | Result |
|---|---|---|
| An ssh key reaches amaterasu | `ssh -o BatchMode=yes -o ConnectTimeout=6 amaterasu true` | Succeeded with no prompt |
| `sudo` needs no password | `ssh amaterasu 'sudo -n true'` | Succeeded |
| `psql` is on the Mac at the path given | `ls -l /opt/homebrew/opt/postgresql@17/bin/psql` | Present. 17.11 |
| Host facts | `/etc/os-release`, `/proc/meminfo`, `nproc`, `hostname -I` | Ubuntu 24.04.4 LTS (noble), 7785 MB, 12 threads, `192.168.20.110` |
| The packages are from PGDG | `dpkg-query -W postgresql-18 postgresql-18-pgvector ssl-cert` | `18.6-1.pgdg24.04+2`, `0.8.6-1.pgdg24.04+1`, `1.1.2ubuntu1` |
| The service is active and enabled | `systemctl is-active/is-enabled postgresql`, `is-active postgresql@18-main` | `active`, `enabled`, `active` |
| Every tuning value in the table | `SHOW <name>` for all twelve, from the Mac | All twelve match the runbook exactly. See below |
| The values live in `conf.d/kpa.conf` | `grep -vE '^\s*(#\|$)' /etc/postgresql/18/main/conf.d/kpa.conf` | Same twelve, plus `log_line_prefix` and `log_min_duration_statement` |
| The connection is encrypted | `SELECT ssl, version, cipher FROM pg_stat_ssl WHERE pid=pg_backend_pid()` | `true`, `TLSv1.3`, `TLS_AES_256_GCM_SHA384` |
| `kpa` is not a superuser | `SELECT rolsuper, rolcreaterole, rolcanlogin FROM pg_roles WHERE rolname='kpa'` | `false`, `false`, `true` |
| No read-only role exists | Same query for `kpa_ro` | No row returned |
| Both databases exist and are owned by `kpa` | `SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname LIKE 'kpa%'` | `kpa` and `kpa_dev`, both owned by `kpa` |
| Both carry pgvector | `SELECT extversion FROM pg_extension WHERE extname='vector'` in each | `0.8.6` in both |
| The server never listens on `0.0.0.0` | `ss -ltnp \| grep 5432` | `127.0.0.1:5432` and `192.168.20.110:5432` only |
| `pg_hba` holds two `hostssl` lines | `grep -A3 '^# KPA' /etc/postgresql/18/main/pg_hba.conf` | `hostssl kpa` and `hostssl kpa_dev`, both `192.168.20.0/24 scram-sha-256` |
| An unencrypted client is refused | `psql "...?sslmode=disable"` | `FATAL: no pg_hba.conf entry for host "192.168.20.107", user "kpa", database "kpa", no encryption` |
| The Mac is on Wi-Fi inside that `/24` | `ssh amaterasu 'echo $SSH_CLIENT'` | `192.168.20.107`, which the `/24` covers. This is the evidence for the correction |
| The post-reboot check runs | `systemctl is-active postgresql@18-main`, then the `extversion` query | `active`, then `0.8.6` |
| The reboot is still outstanding | `uptime -s`, `uptime -p` | Up since 2026-08-17, 1 week 2 days. KPA-2 stays In Progress |

### The twelve settings, read from the Mac with `SHOW`

```
shared_buffers         512MB
work_mem               16MB
maintenance_work_mem   256MB
effective_cache_size   2GB
max_connections        25
random_page_cost       1.1
checkpoint_timeout     15min
max_wal_size           2GB
min_wal_size           256MB
jit                    off
listen_addresses       localhost,192.168.20.110
ssl                    on
```

## The corrected count query in `scripts/provision-amaterasu.sh`

The 26 August drill lost its `\x27` escapes and answered with a syntax error.
The replacement uses no single quote and no dollar sign, so nothing in the
chain of a local double-quoted string, an ssh argument and a remote
single-quoted `bash -c` can mangle it.

Checked without running a second drill, by sending the same command shape at
the existing `kpa` database instead of a scratch one:

```
$ ssh amaterasu "sudo -u postgres bash -c '
    set -e
    echo \"restored objects: \$(psql -tAX -d kpa -c \"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema()\")\"'"
restored objects: 0
```

It prints a number. The old form printed nothing and logged a syntax error.
`bash -n scripts/provision-amaterasu.sh` parses.

## Result

**Verification passed.** Every read-only command in both runbooks produces the
output the runbook claims.

## Two things this does not prove

**The backup drill did not verify anything.** Its count step failed, and both
sides would have been zero regardless, because `kpa` holds no objects yet. The
dump, create, restore and drop cycle demonstrably runs. Data surviving a round
trip is untested, and stays untested until KPA-4 and KPA-5 put something in the
database. Both runbooks say so.

**The reboot has not happened.** KPA-2's "Done when" needs it, the box has been
up for nine days, and rebooting it interrupts NFS. It stays In Progress.

---

# Verification: the build phase

Appended on 27 August 2026. The section above covers the two runbooks and stays
as it was written.

## The commands

KPA-3 created the first suite, so `/verification-before-completion` now has
three commands to run. All three run from the repository root, and `npm test`
and `npm run migrate` read `.env`.

| Command | What it proves |
|---|---|
| `npm run lint` | `oxlint` finds no fault in `src` or `test`. A warning fails the run |
| `npm run build` | `tsc --noEmit` type-checks under `strict`. It emits nothing |
| `npm test` | `node --test` runs the suite against `DATABASE_URL_TEST`, which is `kpa_dev` |
| `npm run migrate` | Applies pending migrations to `DATABASE_URL`, which is `kpa` |

## KPA-3: scaffold the repository and migration tooling

Commit 6862fb8.

| Acceptance criterion | Command | Result |
|---|---|---|
| A TypeScript Node workspace with strict mode on | `npm run build` | Passes. `tsconfig.json` sets `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`, `exactOptionalPropertyTypes` and `erasableSyntaxOnly` |
| A runner with up and down, applying files in order and recording what ran | The suite, and the CLI rehearsal below | 8 tests pass. `schema_migrations` holds one row per applied file |
| npm scripts for migrate, test and lint | `npm run migrate`, `npm test`, `npm run lint` | All three run. `build` exists as well |
| A test runner wired and passing | `npm test` | 8 passed, 0 failed, 0 skipped |
| `.env.example` records every variable, and no secret is committed | `git show 6862fb8:.env.example` | Two variables, both with placeholder values. `.gitignore` already covered `.env` |
| REQ-007: a second run fails and names what it found | CLI rehearsal | `nothing to apply: 1 migration(s) already recorded: 999-cli-rehearsal.sql`, exit 1 |
| `npm run migrate down` returns the database to empty | CLI rehearsal | 0 relations in `public` afterwards |
| REQ-021: the suite passes twice with no manual reset | `npm test` twice | 8 passed both times |
| A lockfile is committed and `engines` names the Node major | `git show 6862fb8 --stat` | `package-lock.json` committed. `engines.node` is `>=22.18.0` |

### The CLI rehearsal

The suite exercises the exported functions. This exercises the command a person
types. It ran against `kpa_dev`, never `kpa`, with a scratch migration file that
was removed afterwards.

```
$ DATABASE_URL="$DATABASE_URL_TEST" node src/db/migrate.ts up
up: 999-cli-rehearsal.sql                                    exit 0
$ DATABASE_URL="$DATABASE_URL_TEST" node src/db/migrate.ts up
nothing to apply: 1 migration(s) already recorded: ...        exit 1
$ psql "$DATABASE_URL_TEST" -c '<relations in public>'
cli_rehearsal, cli_rehearsal_id_seq, schema_migrations
$ DATABASE_URL="$DATABASE_URL_TEST" node src/db/migrate.ts down
down: 999-cli-rehearsal.sql                                   exit 0
$ psql "$DATABASE_URL_TEST" -c '<count of relations in public>'
0
```

`npm run migrate` and `npm run migrate down` then ran against `kpa` itself, with
`migrations/` empty. Both printed `nothing to up` and `nothing to down`, and
`kpa` still holds zero relations. An empty migrations directory writes no
ledger, which is why running it left no trace.

### Two things this does not prove

**No migration file is committed.** `migrations/` ships holding only
`.gitkeep`. KPA-4 writes the first one. The runner is proved against fixtures
in `test/fixtures/`, which is a real test of the runner and not a test of the
schema.

**The clean-clone claim was not run from a clean clone.** The story's "done
when" asks a second machine to reproduce the steps from the README alone. The
README carries them and every command in it ran here, but nobody has cloned the
repository fresh and followed it.

## KPA-15: reach amaterasu's Postgres from the Mac over TLS

Three of the five acceptance criteria were proved on 26 August and are recorded
in the section above: the server holds a certificate and refuses a client
offering no TLS, the Mac connects with `sslmode=require`, and
`SELECT ssl FROM pg_stat_ssl` reports true. They were not re-run.

The two remaining criteria are below.

| Acceptance criterion | Command | Result |
|---|---|---|
| A connection module reads its configuration from the environment, never from a literal | `test/connect.test.ts` | 6 tests pass. `connect()` names the variable it could not find, refuses `disable`, `prefer`, `allow` and a missing mode, and reads host, user and database from the string it was given |
| An ADR records that the migration runs on the Mac, and why the reverse was rejected | `docs/adr/0008-the-migration-runs-on-the-mac.md` | Written. It carries the three rejected options and four consequences |
| The migration's own connection is encrypted | `npm test` | `the connection is encrypted` asserts `ssl` is true and the version starts `TLSv1.` |

### The live connection, opened through the module

```
$ node --env-file-if-exists=.env -e "<connect('DATABASE_URL_TEST'), then pg_stat_ssl>"
{ db: 'kpa_dev', ssl: true, version: 'TLSv1.3', cipher: 'TLS_AES_256_GCM_SHA384' }
```

### One thing found while proving it

**libpq and node-postgres read `sslmode=require` two different ways.** libpq
encrypts and does not verify, which is why `psql` connected on 26 August. The
driver verifies, and amaterasu's certificate is self-signed, so the driver
failed with `DEPTH_ZERO_SELF_SIGNED_CERT`. `connect()` translates `require` to
the driver's own `no-verify`, which means what libpq means. One `.env` therefore
serves `psql` and Node, and ADR-0008 records the trade this accepts.

## The order these ran in

The board has KPA-15 blocking KPA-3. They ran the other way round, by the team
lead's instruction. KPA-15 delivers `src/db/connect.ts`, and no TypeScript file
can exist before KPA-3 creates the workspace that type-checks and runs it. The
boundary decision does come first, and it is recorded in ADR-0008; only the code
could not.

The graph is not wrong about the dependency. It is wrong about which artefact
carries it.

## KPA-16: keep every secret out of the repository and out of the unit file

| Acceptance criterion | Command | Result |
|---|---|---|
| `.env.example` names every variable and carries no value | `cat .env.example` | Two variables, both empty. The format sits in a comment |
| Real values live outside the repository, readable by the owner only | `stat -f '%Sp %Su' ~/.config/kpa/env` | `-rw------- shanedolley`. The directory is `drwx------` |
| A runbook records the `EnvironmentFile=` pattern, mode 0600, root owned | `docs/runbooks/secrets.md` | Written. That section is marked untested, because no unit exists yet |
| A scan of the whole history finds no key | `./scripts/scan-history.sh` | `PASS: three checks, no finding`, exit 0 |
| `.gitignore` covers `.env` and every variant | `git check-ignore` on four names | `.env`, `.env.local` and `.env.production` ignored. `.env.example` tracked, which is correct |
| Nothing breaks without the old file | lint, build, test, migrate | All pass with no `.env` in the repository |

### The move

`~/.config/kpa/env` was created from the repository's `.env`, `cmp` proved the
two byte for byte identical, and the repository copy then went, by absolute
path. `package.json` passes `--env-file-if-exists=$HOME/.config/kpa/env` to
Node, and 14 tests pass in a fresh shell with nothing exported, which is what
proves the new location is the one being read.

### The scan fires, as well as passing

A scan that only ever passes proves nothing, so each check was made to fail.

| Check | Made to fail by | Result |
|---|---|---|
| 2, the credentials in use | `KPA_ENV_FILE` pointing at a file whose password is `secret`, which commit `cecd24f` contains | `FAIL: a password ... appears in the history`, exit 1 |
| 3, connection strings | Running it before the `reviewed` list existed | Named `cecd24f:test/connect.test.ts:25` and exited 1 |

### gitleaks alone is not enough, and that was proved the hard way

**gitleaks does not flag a database URL carrying a password.** A command in this
session meant to write a decoy connection string into a scratch repository and
wrote it into this one instead, in a local commit called `oops`. gitleaks
scanned that commit directly and reported no leaks.

The commit never reached the remote. `git reset` moved `main` back to `cecd24f`,
and the decoy file went by absolute path. The password in it was invented for
the test and works on nothing. The unreachable object stays in the reflog until
git expires it, which is local to this machine and needs no action.

Two things came out of it, and both are kept. `scripts/scan-history.sh` gained
checks 2 and 3, because check 1 alone would have missed exactly this. And
`docs/runbooks/secrets.md` records the gap, so nobody reads a clean gitleaks run
as proof that no connection string was committed.

### One thing this changes for other sessions

**The repository no longer holds a `.env`.** Anything reading one finds nothing.
The values are at `~/.config/kpa/env`, and `docs/runbooks/secrets.md` says so.

## KPA-17: run the checks on every push, and record the conventions

**Partially delivered. The story stays open.** Everything but the green and red
proof is done, and that one criterion is blocked by a GitHub outage rather than
by anything in this repository.

| Acceptance criterion | Command | Result |
|---|---|---|
| A workflow runs the lint, the build and the tests on every push | `.github/workflows/ci.yml` | Written. GitHub parsed it and registered workflow 343062771, name `CI`, state `active` |
| The workflow needs no model credential and no database outside the runner | Read the file | One `env` block, holding a loopback connection string and no secret. Postgres is a service container, `pgvector/pgvector:0.8.6-pg18`, the same two versions amaterasu runs |
| `CLAUDE.md` names the commands, the layout and the rules | `git diff CLAUDE.md` | The only lines taken out are the five of the placeholder section. Every claim was checked against the repository |
| The "Committing: push straight to main" section survives unchanged | `git diff CLAUDE.md` | Untouched. Lines 1 to 38 are byte for byte what they were |
| A failing test reports failure before review | Blocked | See below |

### The claims in CLAUDE.md, checked against the repository

Checked rather than copied from the story, as the story asks.

| Claim | Checked by | Result |
|---|---|---|
| Five commands exist and do what the table says | Reading `package.json` and `ls scripts/` | All five present, and each matches its description |
| CI runs those checks on pgvector 0.8.6 and PostgreSQL 18 | Reading `ci.yml` | Correct after one fix. The first draft said CI runs four commands; it runs three, and never migrates |
| The suite asserts it is not connected to `kpa` | `grep` | `test/migrate.test.ts:52` |
| `connect.ts` allows loopback and refuses remote plain text | `grep` | `src/db/connect.ts:27` and `:58` |
| Every directory in the layout exists | `test -d` on all seven | All present |
| The scripts are all bash | `head -1 scripts/*.sh` | Five files, five bash shebangs |

### What is blocked, and why

**GitHub Actions was in a major outage while this ran.**

```
$ curl -s https://www.githubstatus.com/api/v2/components.json
  Actions: major_outage
  API Requests: operational
  Git Operations: operational

$ curl -s https://www.githubstatus.com/api/v2/incidents/unresolved.json
Incident with Actions  [investigating]  since 2026-08-26T15:11
  primary failover briefly improved performance but did not fully mitigate,
  we've throttled inbound traffic and are investigating upstream Vitess issues
```

Three pushes landed inside that window, at roughly 15:56, 16:05 and 16:12 UTC,
and GitHub created no run for any of them. `total_count` stayed at 0.

This is GitHub, not the workflow, and four separate checks say so.

1. `gh workflow list` reports `CI  active  343062771`. GitHub only registers a
   workflow it has parsed, so the file is valid.
2. Actions is enabled on the repository: `{"enabled":true,
   "allowed_actions":"all"}`.
3. The same account ran Actions successfully earlier the same day, on
   `gwt-manager` at 11:16 UTC. So this is not a quota and not a plan limit.
4. `kothar` did produce a run at 15:40 UTC, inside the incident, and it failed
   with `startup_failure`. Its annotation reads `The job was not acquired by
   Runner of type hosted even after multiple attempts`.

### The proof that is waiting to run

The branch `ci-proof-failing-test` is pushed and holds
`test/deliberately-failing.test.ts`, one assertion of `1 === 2`. It runs red
locally:

```
$ npm test
# tests 16
# pass 15
# fail 1
```

The branch is never merged. When Actions recovers, push an empty commit to it
and to `main`, then confirm one run is red and the other green. That closes the
last criterion, and KPA-17 with it.

### On the pull request the story asks for

The story's test says to open a pull request. This project commits direct to
`main` and opens no pull request, by Shane's decision of 24 August 2026, which
`CLAUDE.md` records. A branch push exercises the same `on: push` trigger and
produces the same red check, so the branch above is the substitute. Confirm
whether that satisfies him, or whether this one story should get a pull request
of its own.

## KPA-4: create the core schema, with subtasks KPA-23 to KPA-26

| Acceptance criterion | Command | Result |
|---|---|---|
| Ten tables exist | `npm test` | `creates every table the story names` asserts the exact list |
| Every frontmatter field maps to a column or an edge | `npm test` against the real vault | Passes over 19 notes in three spaces. `personal/` holds none |
| `facts` carries `valid_from` and `valid_to`, and nothing is deleted | `npm test` | `retires a fact by date` sets `valid_to` and still finds the fact as at March |
| `generated_by` and `verified_by` stay separate | Read `migrations/001_core_schema.sql` | Two columns, and a check constraint refuses `agent:` in the second |
| `owner_id` on `sources`, `facts` and `tasks`, defaulted to one row | `npm test` | `seeds exactly one user` asserts those three tables and no others, each defaulting to `1` |
| `edges` are typed and directional | Read the migration | `from_id`, `to_id`, `kind`, unique together, and no self-edge |
| pgvector columns with an HNSW index on each | `npm test` | Both declare `vector(1024)`, and both carry an HNSW index |
| The migration applies to an empty database and rolls back cleanly | The CLI, against `kpa_dev` | Applied, then reversed. Zero relations, zero enum types, zero functions afterwards |
| `docs/schema.md` explains every table in a sentence | Read it | Ten rows, one sentence each, plus the enums and three decisions |

### The registry, proved rather than asserted

KPA-23's test names two constraints. Both fire, and so do two more.

| Guard | Attempt | Result |
|---|---|---|
| A node's kind must match the table claiming it | Claim a node of kind `url` from `facts` | `violates foreign key constraint "facts_id_node_kind_fkey"` |
| One id cannot be claimed by two child tables | Insert the same id into `facts` and `sources` | `violates foreign key constraint "sources_id_node_kind_fkey"` |
| A node of kind `fact` must have a `facts` row | Insert the node alone, then commit | `node 3 has kind fact and no fact row to match it`, raised at commit by the deferred trigger |
| A machine never marks its own work verified | Set `verified_by` to `agent:claude-opus-5` | `violates check constraint "facts_machine_never_verifies"` |
| The happy path | A fact, a source, and a `derived_from` edge | Committed. The traversal returns `derived_from` to a node of kind `source` |

The third guard is the one the foreign keys cannot see, and the reason the
deferred trigger exists. ADR-0007 records all of it.

### The vault tests fire, as well as passing

Proved against a scratch vault under `VAULT_PATH`, so the real vault was never
edited.

| Test | Scratch note | Message |
|---|---|---|
| Every key maps | `priority: high` | `unmapped frontmatter keys. Add each to src/vault-mapping.ts and give it a column` |
| Every enum value is accepted | `type: gizmo` | `shared/bad-enum.md: type is "gizmo", which fact_type does not list` |

### Two decisions worth reading

**`facts.path` is not in the PRD's column list, and the schema adds it.** A
wikilink resolves against a note's file name, and `title` is prose: the first
note read carries `title: BHP data lifecycle management, Meridian` and lives at
`collibra/bhp-dlm-meridian.md`. Without `path`, nothing can turn `[[a-note]]`
back into a row, so KPA-6 would have had no way to build an edge. This is a
schema gap found before ingestion, which is what step 1 of the migration exists
for. `docs/schema.md` records it rather than adding it quietly.

**One migration file, not four.** KPA-23 names `migrations/001_nodes.sql` and
the parent story names `migrations/001_core_schema.sql`. Both cannot be `001`,
and the parent wins. The deciding reason is atomicity: the runner gives one
transaction per file, so four files could leave a half-built schema, and a
schema either exists or does not.

### Something the vault said that the design did not

`sources/` notes carry a completely different frontmatter set: `attendee`,
`attendees`, `client`, `date`, `duration`, `icon`, `meeting-type`, `period`,
`project`, `purpose`, `tags`, `template-type`, `type`, and some carry none at
all. Thirteen keys, against the thirteen the spaces use, with almost no overlap.

This is not a gap. The vault's `CLAUDE.md` says imported material keeps whatever
frontmatter it arrived with, and `sources.body` stores the file verbatim, so
those keys need no columns. The mapping test therefore reads the four space
directories and never `sources/`, and `src/vault-mapping.ts` says why.

### The embedding model

`voyage-4` at 1024 dimensions, checked against Voyage's own model list on
27 August 2026 rather than taken from the brief. The brief names `voyage-3`,
which is now a legacy model. `voyage-4-large` is Voyage's best general-purpose
model and was not chosen: the corpus is 17 facts and 32 sources, which cannot
show the difference. Both default to 1024, so moving up later changes a model
name and not the schema.

### What was deliberately not done

**The migration has not been applied to `kpa`.** It ran against `kpa_dev` only,
per the instruction covering this session, and `kpa` still holds zero relations.
The story asks for the migration to apply and roll back, and it does. Whoever
runs KPA-5 applies it to `kpa` for the first time.

### The history scan caught this story's own work

Two literals introduced after the scan was written, and both are fixed rather
than waived by hand.

The CI service container's `postgres:postgres@localhost` is now excluded by
rule, because a loopback host reaches no network and its password protects
nothing. That is the same rule `src/db/connect.ts` applies when it lets loopback
connect in the clear.

`docs/runbooks/secrets.md` quoted the decoy connection string while explaining
the gitleaks gap. The runbook now describes it instead of spelling it out, and
the historical commits carry a `reviewed` entry naming why.

## KPA-18: give the vault's log.md a destination

| Acceptance criterion | Command | Result |
|---|---|---|
| The destination is chosen between three options, and recorded with the options it beat | Read `docs/vault-log.md` | A header section names all three and says why two lose |
| Every entry exists at the destination | `npm test` | 14 headings in the vault, 14 in the copy, compared heading by heading |
| Nothing is summarised away | `npm test` | The copy ends with the original, byte for byte |

### The choice

`docs/vault-log.md`, holding the file whole under a header that records the
decision.

**A table in Postgres** loses because the log is not memory. It records what the
vault did, answers no question the assistant will be asked, and would need a
table no story designed and that KPA-13's count reconciliation would then have
to account for.

**A set of ADRs** loses on the numbers. Eight of the fourteen entries are
`ingest`, which is a day's work rather than a decision. The five `change`
entries are small conventions, and none passes the three tests in the
`architecture-decisions` skill. Fourteen ADRs would bury the seven real ones.

**A document in `docs/`** wins. The log is prose a person reads occasionally,
git already gives it permanence and a diff, and moving it costs one copy.

The choice is recorded in the file's own header rather than in an ADR, because
it fails the first ADR test. Moving a markdown file later is trivial.

### The test fires

Changing one `## [` heading to `XX [` in the copy failed all three assertions at
once: the count, the heading list, and the byte-for-byte comparison. The file
was restored from a backup and `cmp` confirmed it identical.

### One thing this leaves open

**The vault's `log.md` is still the original.** KPA-14 freezes the vault and
Shane deferred it until KPA-5, so nothing has been switched off and this is a
copy rather than a move. `test/vault-log.test.ts` compares the two on every run,
so the copy cannot fall behind unnoticed. The header in `docs/vault-log.md` says
the same.
