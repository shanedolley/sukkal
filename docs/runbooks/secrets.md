# Where KPA's secrets live

Written for KPA-16, and checked on the Mac on 27 August 2026.

**History is permanent.** A repository that carried a key once carries it
forever, whatever a later commit removes. So no value ever enters this
repository, and the checks below prove it rather than assume it.

The vault's own rule against storing secrets carries forward here. See the
project brief, under *What carries forward*.

## On the Mac

Real values live at `~/.config/kpa/env`, outside the repository.

```
$ stat -f '%Sp %Su %N' ~/.config/kpa ~/.config/kpa/env
drwx------ shanedolley /Users/shanedolley/.config/kpa
-rw------- shanedolley /Users/shanedolley/.config/kpa/env
```

The owner reads it and nobody else does. The directory is `0700` as well, so no
other user lists it.

### Creating it

```
mkdir -p ~/.config/kpa
cp .env.example ~/.config/kpa/env
chmod 700 ~/.config/kpa
chmod 600 ~/.config/kpa/env
```

Then fill in both connection strings. `.env.example` names every variable the
code reads and holds no value.

The `kpa` role's password was set by `scripts/provision-amaterasu.sh` and is
recorded in that file only. To change it, run `ALTER ROLE kpa PASSWORD ...` on
amaterasu and edit `~/.config/kpa/env` to match.

### How the code reads it

`package.json` passes `--env-file-if-exists=$HOME/.config/kpa/env` to Node.
Nothing calls `dotenv`, and no code names a path of its own.

`src/db/connect.ts` is the only place a connection opens. It reads a named
variable, so no host, user or password is written in the repository.

**An exported variable beats the file.** Node's `--env-file` does not overwrite
a variable already set in the environment. Checked on 27 August 2026:

```
$ printf 'FOO=from_file\n' > t.env
$ FOO=from_shell node --env-file-if-exists=t.env -e 'console.log(process.env.FOO)'
from_shell
```

This is what lets continuous integration set `DATABASE_URL_TEST` to a service
container and carry no file at all. It also means a stale exported variable in
your shell silently wins over the file you just edited. Open a new shell when a
change appears not to take.

**`--env-file-if-exists` never fails on a missing file**, which is why a clean
clone runs before anyone creates one.

## On amaterasu, under systemd

No unit exists yet. Slice one ships no service, so **nothing in this section
has been run on amaterasu.** It is the pattern to follow, not a checked
procedure, and whoever writes the first unit should verify each command and
correct this file.

When a unit lands, it reads its environment from a file rather than from
`Environment=` lines, because `systemctl show` prints `Environment=` values to
any user who asks.

```ini
[Service]
EnvironmentFile=/etc/kpa/env
ExecStart=/usr/bin/node /opt/kpa/src/worker.ts
User=kpa
```

The file is root's, and the service user never writes it:

```
sudo install -d -m 0755 /etc/kpa
sudo install -m 0600 -o root -g root /dev/null /etc/kpa/env
sudo -e /etc/kpa/env
```

```
$ sudo stat -c '%A %U:%G %n' /etc/kpa/env
-rw------- root:root /etc/kpa/env
```

Systemd reads the file as root before it drops to `User=`, so mode `0600` and
root ownership work. A service that can read its own secrets file is a service
that can leak them if it is compromised.

Never put a secret in the unit file. `/etc/systemd/system/` is world readable,
and the unit is committed to git in most setups.

## Proving it

```
./scripts/scan-history.sh
```

Three checks, and no one of them is enough alone.

**1. gitleaks.** Broad rules, run over every commit.

**gitleaks does not flag a database URL carrying a password.** Proved on
27 August 2026, by accident. A session meant to write a `DATABASE_URL` holding
a full connection string, password and all, into a scratch repository, and
wrote it into this one instead, in a commit called `oops`. gitleaks scanned that commit directly and reported no leaks. The commit
was removed before it reached the remote, and the password in it was invented
for the test and works on nothing.

Anyone reading a clean gitleaks run as proof that no connection string was
committed is reading it wrong. That is why the next two checks exist, and check
3 catches exactly this case.

**2. The credentials in use.** Reads each password from `~/.config/kpa/env` and
greps the whole history for it. No false positives, and it answers the question
that matters: is a key that works today in the history? It prints no value
either way.

**3. Connection strings carrying a password.** A pattern grep over every commit.
A `${SHELL_VARIABLE}` or an all-caps `PASSWORD` placeholder passes. A literal
fails.

Check 3 carries a `reviewed` list in the script, holding matches a person read
and cleared. One entry today: a synthetic fixture in `test/connect.test.ts`
committed in `cecd24f`, pointing at `10.0.0.1`, which the test never connects
to. Add an entry only after reading the commit it comes from, and say why the
match is not a credential.

## If a key does reach the history

Rotate first, scrub second. A key in a pushed history is compromised from the
moment it is pushed, and rewriting history does not un-push it.

1. Change the credential on the server. For the database, `ALTER ROLE kpa
   PASSWORD ...` on amaterasu.
2. Update `~/.config/kpa/env`.
3. Rewrite the history with `git filter-repo`, then force push.
4. Run `./scripts/scan-history.sh` and confirm it passes.

Step 1 is the one that ends the exposure. Steps 3 and 4 stop the next reader
finding a key and assuming it still works.
