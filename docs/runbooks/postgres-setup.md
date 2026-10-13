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
| Configuration | `/etc/postgresql/18/main`, with the tuning in `conf.d/sukkal.conf` |
| Data | `/var/lib/postgresql/18/main` |
| Databases | `sukkal` and `sukkal_dev`, both owned by `sukkal`, both carrying pgvector |
| Role | `sukkal`. `LOGIN`, `NOSUPERUSER`, `NOCREATEROLE` |
| Client credentials | `.env` at the repository root, git-ignored |

**This box was the last thing called KPA.** KPA-153 moved every other machine
name to Sukkal on 13 September 2026 and could not reach amaterasu, so the two
databases, the role, `conf.d/kpa.conf`, the `# KPA` marker in `pg_hba.conf` and
`/etc/sudoers.d/kpa` kept the old name until KPA-154 renamed them too.

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

The wizard generates the `sukkal` password itself, sets it on the role, and writes
it into `.env`. It never prints it. `.env` is git-ignored, so nothing is
committed.

## The settings, and where the numbers came from

`conf.d/sukkal.conf` holds all of them. The file names the script that wrote it, so
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
hostssl sukkal       sukkal  192.168.20.0/24  scram-sha-256
hostssl sukkal_dev   sukkal  192.168.20.0/24  scram-sha-256
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
Sukkal reading nabium's database, not the reverse. An unused credential with read
access to Collibra material is attack surface that earns nothing yet.

**`sslmode=require`, not `verify-full`.** The connection is encrypted but the
certificate is not verified. Verification needs a certificate carrying the host
address, and `conf.d/sukkal.conf` can take that upgrade later with no migration.

**Tests point at `sukkal_dev`.** `DATABASE_URL_TEST` in `.env` names it, so a test
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

## Surviving a reboot, and why it needed two fixes

**A reboot is the only real test, and it failed the first time it was run.**

`listen_addresses` names the LAN address rather than a wildcard, so Postgres has
to bind an address that must already exist. The stock unit orders
`After=network.target`, which means networking is starting, not that an address
has been assigned. On 26 August 2026 Postgres won that race and logged:

```
could not bind IPv4 address "192.168.20.110": Cannot assign requested address
WARNING:  could not create listen socket for "192.168.20.110"
```

It then served loopback only. `systemctl is-active postgresql` reported
`active` throughout, so nothing looked wrong until a client on the LAN was
refused. Treat "the unit is active" as no evidence at all here. Check the
socket.

### Fix one: order Postgres after the network is up

`scripts/provision-amaterasu-root.sh` writes this drop-in, so a rebuild inherits
it:

```
/etc/systemd/system/postgresql@.service.d/network-online.conf

[Unit]
Wants=network-online.target
After=network-online.target
```

### Fix two: make the box wait for the right interface

Fix one alone worked, and it worked for the wrong reason. `network-online.target`
was reached only because `systemd-networkd-wait-online` gave up after 120
seconds and failed. Postgres started 124 seconds into a boot, behind a timeout.

The cause was inverted netplan flags. amaterasu carries two interfaces:

| Interface | What it is | State |
|---|---|---|
| `enp4s0` | the built-in NIC | no cable, `no-carrier` |
| `enxc8a362ed7e5e` | a USB adapter, holds 192.168.20.110 | `routable` |

`50-cloud-init.yaml` left `enp4s0` mandatory, and `99-usb-ethernet.yaml` marked
the USB adapter `optional: true`. So the box waited for the dead NIC and ignored
the live one. Both flags were swapped on 27 August 2026, and the previous files
are kept beside them as `*.bak-2026-08-27`.

`sudo netplan generate` rewrites the wait-online drop-in in `/run` without
touching the running network, so the result can be read before a reboot proves
it:

```bash
ssh amaterasu 'sudo cat /run/systemd/system/systemd-networkd-wait-online.service.d/10-netplan.conf'
```

It must name `enxc8a362ed7e5e`. If it names `enp4s0`, the flags are back to
front.

### What the two fixes bought

| | Before | After |
|---|---|---|
| `systemd-networkd-wait-online` | failed, every boot | success |
| `network-online.target` reached | 124s | 11.7s |
| Postgres started | 126.7s | 14.4s |
| Total boot | roughly 127s | 14.4s |
| Sockets bound | loopback only | loopback and the LAN address |

### Verifying it yourself

A restart is a weaker test than a reboot: it proves the unit starts, not that
the boot sequence does. A reboot interrupts NFS and any transcode, so run it
when the box is quiet.

```bash
ssh amaterasu sudo reboot
```

Then check all four things, because the first two pass even when it is broken:

```bash
ssh amaterasu 'systemctl is-active postgresql@18-main'
ssh amaterasu 'systemctl show systemd-networkd-wait-online -p Result --value'
ssh amaterasu 'sudo ss -lntp | grep 5432'
ssh amaterasu 'sudo journalctl -u postgresql@18-main -b --no-pager | grep -c "could not bind"'
psql "$DATABASE_URL" -tAXc "SELECT extversion FROM pg_extension WHERE extname='vector'"
```

Two sockets must appear, `127.0.0.1:5432` and `192.168.20.110:5432`, and the
bind-error count must be zero.

## What is still open

**Nothing on this runbook's own subject.** KPA-2 closed on 27 August 2026, after
the reboot above ran three times: once to find the bind failure, once to prove
the drop-in, and once to prove the netplan flags.

Two things nearby are open, and neither belongs to provisioning.

**The backup drill proved nothing yet.** It dumped, restored and dropped a
scratch database, so the mechanics work, but both sides of the row-count
comparison were zero because `kpa`, now `sukkal`, held no objects that day.
KPA-22 was reopened and blocked by KPA-5. On 14 October 2026 KPA-5 was Done and
KPA-22 sat in To Do, waiting on the vault load into production.
`docs/runbooks/database-backup.md` carries the detail.

**Nothing watches the box's own recovery.** These fixes make Postgres come back
correctly after a reboot; nothing tells anyone when it does not. That gap is
real and no story covers it yet.
