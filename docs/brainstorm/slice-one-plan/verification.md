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
