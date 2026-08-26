# Backing up the KPA database

Written for KPA-22, and checked against the live server on 26 August 2026.

The database is PostgreSQL 18.6 on amaterasu, at `192.168.20.110`, running under
systemd as `postgresql@18-main`. It holds two databases, `kpa` and `kpa_dev`,
both owned by the `kpa` role.

## Nothing is scheduled

**No cron job, no systemd timer and no script takes a dump.** A dump happens
when a person runs the commands below, and nothing alerts when one is missed.

That is a deliberate gap, not an oversight. No acceptance criterion in slice one
asks for a schedule, and `kpa` holds no application data yet: its `public` schema
contained zero objects when this was written. Add a schedule once KPA-5 loads the
vault, because that is the first commit that puts something in there worth
losing.

## Run the dump on amaterasu, not on the Mac

The Mac's client is PostgreSQL 17.11 from Homebrew. The server is 18.6.
`pg_dump` refuses to read a server newer than itself:

```
pg_dump: error: aborting because of server version mismatch
pg_dump: detail: server version: 18.6 (Ubuntu 18.6-1.pgdg24.04+2); pg_dump version: 17.11 (Homebrew)
```

So the dump runs on the box, where `pg_dump`, `pg_dumpall` and `pg_restore` are
all 18.6. This rule binds the dump tools only. `psql` 17.11 talks to the 18.6
server without complaint, which is why the connection checks elsewhere run from
the Mac and these do not.

Installing a PostgreSQL 18 client on the Mac would lift the restriction. Nobody
needs it yet.

## Take two dumps, not one

`pg_dump` writes the database and no roles at all. `pg_dumpall -r` writes the
roles and nothing else. A rebuilt box needs the `kpa` role to exist before any
restore of `kpa` works, so the second dump is the one that gets forgotten and
then missed.

Run this on amaterasu as the `postgres` user:

```bash
ssh amaterasu
sudo -u postgres bash

mkdir -p ~/backups
STAMP=$(date +%Y%m%d)
pg_dump -Fc -d kpa -f ~/backups/kpa-$STAMP.dump
pg_dumpall -r -f ~/backups/roles-$STAMP.sql
chmod 600 ~/backups/roles-$STAMP.sql
```

`~` is `/var/lib/postgresql` for that user, so the files land beside the data
directory. Two things about those commands are worth knowing before you need
them.

**The roles dump holds the password hash.** That is why it gets mode 600. It is
a SCRAM verifier rather than the password, so it does not hand an attacker the
credential, but it does hand them an offline target.

**`pg_dump` never blocks a writer.** It reads through a consistent MVCC
snapshot and locks no table, so it is safe against the live cluster at any time.

`-Fc` writes the custom format. It compresses, and `pg_restore` can list and
select from it, which the next section uses.

## A copy of the data directory is not a backup

Do not back up `/var/lib/postgresql/18/main` with a filesystem snapshot, an
`rsync`, or any copy tool. Postgres writes to that directory continuously while
it runs. A copy taken mid-write captures files at different points in time
relative to each other and to the write-ahead log. Postgres then refuses to
start from it, or starts and serves corrupted data. Only the `pg_dump` output
above restores.

## The dumps sit on the same disk as the data

`~/backups` is on the same logical volume as `/var/lib/postgresql/18/main`. So a
dump protects against a bad migration, a mistaken `DROP`, and a mistaken
`DELETE`. It protects against disk failure, theft and fire not at all.

Copy a dump to the Mac to close that gap:

```bash
scp amaterasu:/var/lib/postgresql/backups/kpa-YYYYMMDD.dump ~/Downloads/
```

That command needs the file readable by your own user first, because `~postgres`
is not. Choosing a permanent off-box destination is Shane's decision and no
acceptance criterion in this slice asks for one.

## Restoring

Two facts about these dumps will cost you time at 3am if you meet them for the
first time then.

**The dump carries no `CREATE DATABASE`.** `pg_dump -Fc` without `-C` emits none,
so the target database must already exist before `pg_restore` runs.

**The dump carries no roles.** On a rebuilt box, load
`roles-YYYYMMDD.sql` first. Without the `kpa` role, every `SET OWNER` in the
archive fails.

Restore into a scratch database, never over `kpa`:

```bash
sudo -u postgres bash

# On a rebuilt box only. Skip it when the kpa role already exists.
psql -f ~/backups/roles-YYYYMMDD.sql

# Inspect the archive before trusting it. Read-only, no database touched.
pg_restore -l ~/backups/kpa-YYYYMMDD.dump | head

# Create the target first. The dump will not create it.
createdb -O kpa kpa_restore

pg_restore -d kpa_restore --no-owner --exit-on-error ~/backups/kpa-YYYYMMDD.dump
```

`--no-owner` drops the `SET OWNER` commands, so the restoring role owns
everything. Use it whenever the restoring role is not `kpa`.

`--exit-on-error` turns `pg_restore`'s default "log it and carry on" into a hard
stop. Without it a half-restored database reads as a success.

## Compare before you overwrite

An unverified backup is a guess. Compare the scratch database against the source
before you trust either one:

```bash
sudo -u postgres bash

for db in kpa kpa_restore; do
  echo "== $db"
  psql -tAX -d "$db" -c \
    'SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY relname'
done
```

Every table must appear in both lists with the same count. Then remove the
scratch database:

```bash
dropdb kpa_restore
```

Restoring over the live `kpa` is the same commands with `-d kpa` and `--clean`,
and it discards whatever is in there now. Do the comparison above first, every
time.

## The drill that has run

Stage 6 of `scripts/provision-amaterasu.sh` ran a dump and a restore on
26 August 2026, as `postgres` on amaterasu. It did five things:

1. `pg_dump kpa > /tmp/kpa-drill.sql`, a plain SQL dump rather than `-Fc`.
2. `dropdb --if-exists kpa_drill`, then `createdb kpa_drill`.
3. `psql -q -d kpa_drill -f /tmp/kpa-drill.sql`.
4. Counted the objects in the restored `public` schema.
5. `dropdb kpa_drill`, and removed the dump file.

The Postgres log records the connections to `kpa_drill` and the
`DROP DATABASE kpa_drill` that closed the run. **Two limits on what that drill
proved, recorded rather than smoothed over.**

**Step 4 produced no count.** The wizard's quoting mangled the string literal in
the query, and the server logged `syntax error at or near "\"` instead of
answering. The count reached `echo` empty. The quoting is corrected in the
script as of 26 August 2026, and the drill was not run a second time.

**The comparison was vacuous anyway.** `kpa`'s `public` schema holds zero
objects today, so both sides of step 4 were zero. The drill proves the dump,
create, restore and drop cycle runs end to end on this box. It does not prove
that data survives a round trip, because there is no data.

**Repeat the drill after KPA-4 creates the schema and KPA-5 loads the vault.**
That run tests the thing this runbook exists for. Use the `-Fc` commands above
rather than the wizard's plain SQL, and use the row-count comparison in the
previous section.

## Checking a dump is fresh

Nothing watches this, so check it by hand:

```bash
ssh amaterasu 'sudo -u postgres ls -lt /var/lib/postgresql/backups/'
```

Read the newest timestamp and compare it against the last time the database
changed. A dump older than the most recent migration protects nothing.

That command reports `No such file or directory` today, because no dump has been
taken with the commands above and `mkdir -p ~/backups` has never run. Treat that
error as the answer "there is no backup", which is the truthful one.

**Take a dump before every migration and before every restore.** Those are the
two moments this runbook is for, and both are moments a person controls, which
is what makes the missing schedule survivable for now.
