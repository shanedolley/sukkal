# Provisioning PostgreSQL on amaterasu

Written for KPA-2, and checked against the live server on 26 August 2026.

Two scripts do the work, and they are the source of truth. This runbook records
what they apply, why the numbers are what they are, and what to do when a stage
fails. Read the scripts when the two disagree.

| Script | Runs on | Job |
|---|---|---|
| `scripts/provision-amaterasu.sh` | The Mac | The wizard. Six stages, re-runnable |
| `scripts/provision-amaterasu-root.sh` | amaterasu | The root half. Copied over and run under one `sudo` |

## The result

| | |
|---|---|
| Host | amaterasu, `192.168.20.110`, Ubuntu 24.04.4 LTS (noble), 7.6 GB RAM, 12 threads |
| Packages | `postgresql-18` 18.6, `postgresql-18-pgvector` 0.8.6, both from PGDG |
| Service | `postgresql` active and enabled at boot, `postgresql@18-main` active |
| Configuration | `/etc/postgresql/18/main`, with the tuning in `conf.d/kpa.conf` |
| Data | `/var/lib/postgresql/18/main` |
| Databases | `kpa` and `kpa_dev`, both owned by `kpa`, both carrying pgvector |
| Role | `kpa`. `LOGIN`, `NOSUPERUSER`, `NOCREATEROLE` |
| Client credentials | `.env` at the repository root, git-ignored |

## Before you run it

Three things must already be true. The wizard's stage 1 checks the first and
warns about the second.

1. **An ssh key reaches amaterasu.** `ssh -o BatchMode=yes amaterasu true` must
   succeed with no prompt.
2. **`sudo` works on amaterasu.** A password prompt is fine. To remove the
   prompt, run `scripts/setup-sudoers-amaterasu.sh` first, and read what it
   grants before you accept it.
3. **`psql` is installed on the Mac.** Stage 3 verifies over the LAN with it.
   Homebrew's `postgresql@17` supplies it at
   `/opt/homebrew/opt/postgresql@17/bin/psql`.

## Running it

```bash
./scripts/provision-amaterasu.sh
```

Six stages: preflight, provision, verify from the Mac, write `.env`, restart,
and a backup drill. It is safe to re-run. Every step in the root half checks
before it acts, and stage 4 offers the existing `.env` values as defaults.

The wizard generates the `kpa` password itself, sets it on the role, and writes
it into `.env`. It never prints it. `.env` is git-ignored, so nothing is
committed.

## The settings, and where the numbers came from

`conf.d/kpa.conf` holds all of them. The file names the script that wrote it, so
edit the script rather than the server.

| Setting | Value | Reason |
|---|---|---|
| `shared_buffers` | 512MB | 7.6 GB shared with NFS, NZBGet and a transcode monitor |
| `work_mem` | 16MB | Allocated per sort, so `max_connections` caps how much can be in flight |
| `maintenance_work_mem` | 256MB | Index builds run faster and run rarely |
| `effective_cache_size` | 2GB | What the planner can assume the kernel holds |
| `max_connections` | 25 | One migration and one test run, not a web tier |
| `random_page_cost` | 1.1 | NVMe, not a spinning disk. The default of 4 plans badly |
| `checkpoint_timeout` | 15min | Time-driven, so a burst does not force repeated full-page writes |
| `max_wal_size` | 2GB | Room for that interval |
| `jit` | off | These row counts never reach the size where compilation pays back |
| `listen_addresses` | `localhost,192.168.20.110` | The LAN and nothing wider. Never `0.0.0.0` |
| `ssl` | on | The certificate from the `ssl-cert` package |

**The numbers are scaled from nabium's `docs/runbooks/postgres-tuning.md`, not
copied from it.** That runbook targets a 32 GB host and holds
`effective_cache_size` at 8 GB of those 32. Those values on a 7.6 GB box that
also serves NFS would over-commit memory, and memory is the constraint that
binds first here. What carries over unchanged is the reasoning:
`random_page_cost` on NVMe, `jit` off at these row counts, and time-driven
rather than size-driven checkpoints.

## Who may connect

`pg_hba.conf` gains two lines, and only two:

```
hostssl kpa       kpa  192.168.20.0/24  scram-sha-256
hostssl kpa_dev   kpa  192.168.20.0/24  scram-sha-256
```

**The subnet is read at run time, not hard-coded.** The wizard asks amaterasu
what address the ssh arrived from, through `$SSH_CLIENT`, and takes the `/24`
around it. The Mac's wired and Wi-Fi interfaces both sit on `192.168.20.0/24`,
so either interface reaches Postgres. The Mac was on Wi-Fi at `192.168.20.107`
during the run that provisioned the box.

Moving the Mac to a different subnet, a guest SSID or a VLAN needs a second
`hostssl` line for that network. Nothing about the interface type matters.

**The comment on the box was corrected by hand on 26 August 2026.** Both scripts
and the live `pg_hba.conf` now carry the same three lines. A re-run will not
maintain that agreement: the root half skips the block when it finds one, so any
future change to the comment needs the same hand edit, or a deleted block and a
re-run. The previous file is kept at `pg_hba.conf.bak-2026-08-26`.

Because only `hostssl` lines exist for the LAN, a client offering no TLS matches
no line and is refused. That refusal is an acceptance criterion, not a default.

## Three decisions worth knowing

**No read-only role exists.** The original acceptance criterion asked for one
"for later use against nabium", and it had the direction backwards: ADR-0003 has
KPA reading nabium's database, not the reverse. An unused credential with read
access to Collibra material is attack surface that earns nothing yet.

**`sslmode=require`, not `verify-full`.** The connection is encrypted but the
certificate is not verified. Verification needs a certificate carrying the host
address, and `conf.d/kpa.conf` can take that upgrade later with no migration.

**Tests point at `kpa_dev`.** `DATABASE_URL_TEST` in `.env` names it, so a test
run never writes into the database that holds the migration's data.

## When a stage fails

| Stage | Failure | What to do |
|---|---|---|
| 1 Preflight | ssh fails | Fix the key first. The wizard stops on purpose |
| 1 Preflight | The address does not parse | Stop. A malformed network in `pg_hba` locks you out |
| 2 Provision | `apt-get` fails | Check PGDG reaches noble, then re-run. The script is idempotent |
| 3 Verify | Any check fails | Read `/var/log/postgresql/postgresql-18-main.log` on the box. Re-run after the fix |
| 3 Verify | An unencrypted client is accepted | `pg_hba.conf` has a `host` line matching before the `hostssl` ones. Order decides |
| 4 `.env` | Nothing written | Check the working directory. `ENV_FILE` defaults to `.env` where you stand |
| 5 Restart | The service does not return | `systemctl status postgresql@18-main`, then the log above |
| 6 Drill | Declined or failed | Follow `docs/runbooks/database-backup.md` by hand |

Re-running the whole wizard is the normal repair. It generates a new password
and rewrites `.env`, so any client holding the old one needs the new value.

## What is still open

**KPA-2 stays In Progress until amaterasu reboots.** Its "Done when" requires the
service to survive a reboot, and the box has been up for nine days. Stage 5
restarts the service, which is a weaker test: it proves the unit starts, not
that the boot sequence does. A reboot interrupts NFS and any transcode, so Shane
runs it when the box is quiet:

```bash
ssh amaterasu sudo reboot
```

Then confirm the service came back:

```bash
ssh amaterasu 'systemctl is-active postgresql@18-main'
psql "$DATABASE_URL" -tAXc "SELECT extversion FROM pg_extension WHERE extname='vector'"
```
