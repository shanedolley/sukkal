# Where KPA's secrets live

Written for KPA-16, extended for KPA-70, and checked on the Mac on 3 September
2026.

**History is permanent.** A repository that carried a key once carries it
forever, whatever a later commit removes. So no value ever enters this
repository, and the checks below prove it rather than assume it.

The vault's own rule against storing secrets carries forward here. See the
project brief, under *What carries forward*.

## The variables

`.env.example` names each one and holds no value. This section says what each
is for, where it comes from, and what breaks without it.

| Variable | Read by | Without it |
|---|---|---|
| `DATABASE_URL` | `src/db/connect.ts`, its default | The migration and the worker throw at the first connection |
| `DATABASE_URL_TEST` | The suite, and `apps/web/scripts/check-review-rules.ts` | Every test that needs a database skips |
| `NABIUM_WEBHOOK_SECRET` | `apps/web/app/(app)/api/webhooks/nabium/route.ts` | The receiver answers 503 and stores no delivery |
| `KPA_SECRET_KEY` | `src/connections/crypto.ts` | No connection secret seals or opens |
| `VOYAGE_API_KEY` | Nothing, today | Nothing, today |
| `VOYAGE_PROJECT_ID` | Nothing, today | Nothing, today |
| `VAULT_PATH` | `src/vault-mapping.ts` | Nothing. The reader falls back to a path under `$HOME` |

`REUI_LICENSE_KEY` belongs to the web tier and sits in `apps/web/.env.example`.
The last part of this section covers it.

### The two database URLs

Both need `sslmode=require`. amaterasu refuses a client offering no TLS, and
`src/db/connect.ts` refuses a mode that does not encrypt. A loopback host
passes in the clear, because that traffic reaches no network.

The `kpa` role's password was set by `scripts/provision-amaterasu.sh` and is
recorded in `~/.config/kpa/env` only. To change it, run `ALTER ROLE kpa
PASSWORD ...` on amaterasu and edit that file to match.

Unset, the failure names itself and names this file. Checked on 3 September
2026:

```
$ env -u DATABASE_URL node --input-type=module -e "
import { connectionString } from './src/db/connect.ts';
try { connectionString(); } catch (e) { console.log(e.message); }"
DATABASE_URL is unset. See docs/runbooks/secrets.md: real values live in ~/.config/kpa/env.
```

**Never point a test at `kpa`.** `DATABASE_URL_TEST` exists to keep the two
apart, and `test/migrate.test.ts` asserts the database it reached is not `kpa`.

### `KPA_SECRET_KEY`

It seals a connection's credential. A credential reaches an outside system on
Shane's behalf, and two of the three mailboxes it reaches hold Collibra
customer material, so a database backup that leaves the box must carry
ciphertext and leave the key behind. `src/connections/crypto.ts` is the one
place bytes are sealed and the one place they are opened.

Make one with `openssl rand -base64 32`. AES-256 needs exactly 32 bytes, so the
module throws on a key of any other length. It reads the variable on every
call, so a new key takes effect on the next call rather than the next restart.

Checked on 3 September 2026. The length check reads the real key and prints no
value:

```
$ node --env-file-if-exists=$HOME/.config/kpa/env -e "console.log(Buffer.from(process.env.KPA_SECRET_KEY ?? '', 'base64').length)"
32
```

```
$ env -u KPA_SECRET_KEY node --input-type=module -e "
import { encrypt } from './src/connections/crypto.ts';
try { encrypt('x','c'); } catch (e) { console.log(e.message); }"
KPA_SECRET_KEY is unset, so no connection secret can be sealed or read. See docs/runbooks/secrets.md: real values live in ~/.config/kpa/env. Make one with `openssl rand -base64 32`.
```

**Rotating this key costs every stored credential.** Nothing re-seals a row.
`decrypt` throws on every connection sealed under the old key, so each
credential has to be entered again through the connections screen. Rotate it
when the old key is compromised, and expect to retype every secret.

### Voyage is metered

`VOYAGE_API_KEY` bills per call to the embeddings endpoint. It is a meter, not
a login: a key left in a log or a history costs money as well as access. Make
one at `dash.voyageai.com`. `VOYAGE_PROJECT_ID` attributes the spend, and the
endpoint itself takes only the key.

**No code reads either variable today.** Measured on 3 September 2026 by
grepping `src/`, `apps/web/` and `scripts/` for both names. `src/embedding.ts`
pins the model and the width and makes no request, and nothing else names them.
`apps/web/lib/providers.ts` offers Voyage as a connection instead, which stores
its key in the database under `KPA_SECRET_KEY`. One key with two homes is a
decision nobody has made. Until somebody makes it, treat the two environment
variables as reserved.

### `VAULT_PATH` is not a secret

It names the Obsidian vault, and that vault exists on Shane's Mac and nowhere
else. Absent, `src/vault-mapping.ts` falls back to
`$HOME/Development/obsidian_vaults/Memory`. Continuous integration sets no
value and carries no vault, so every vault-reading test skips on a missing
path. `VAULT_PATH=/nonexistent` reproduces that here.

### `REUI_LICENSE_KEY` belongs to the build

It lives in `apps/web/.env.example`, and `apps/web/components.json` hands it to
the shadcn CLI as a bearer token when somebody installs a premium block. The
running application never reads it. Both `.gitignore` files ignore `.env*`,
checked on 3 September 2026:

```
$ git check-ignore -v apps/web/.env.local
apps/web/.gitignore:34:.env*	apps/web/.env.local
```

### The web tier reads its own environment

`next dev` and `next start` pass no `--env-file`, and nothing under `apps/web`
calls `dotenv`. So `~/.config/kpa/env` reaches the root package's commands and
does not reach the web tier.

`NABIUM_WEBHOOK_SECRET` is the one variable a route handler reads, so it has to
reach the web tier itself: an exported variable in the shell that starts it, or
the unit's `EnvironmentFile` on amaterasu. Next.js also loads
`apps/web/.env.local` on its own, and **nobody has run that path here**, so
prefer an exported variable until somebody proves it and corrects this
sentence.

The Mac's file holds no such entry today, and this reports the count rather
than the value:

```
$ grep -c '^NABIUM_WEBHOOK_SECRET=' ~/.config/kpa/env
0
```

## The nabium shared secret

### Making one

`receive` checks that the secret is not empty and checks nothing else, so
length is a choice rather than a rule. Thirty-two bytes matches every other key
here:

```
openssl rand -base64 32
```

Put the one value on both sides: nabium's sender configuration, and the
receiver's environment. Never in this repository.

### Rotating one

**The receiver holds one secret, so a rotation has a window.** `receive` in
`src/webhooks/receive.ts` takes a single `secret`, `signatureMatches` compares
against that one, and the route reads a single variable. Nothing accepts an old
secret and a new one together. A delivery signed with the secret the receiver
no longer holds earns 401 and is not stored.

**ADR-0013 records that nabium does not retry**, so a delivery lost in the
window stays lost until somebody re-posts it. Two facts close the window to
nothing.

Nabium posts when a meeting session is ready, so a rotation run while no
meeting is running loses nothing. That is the whole trick, and it is the only
one this code supports.

A delivery re-posted with its original delivery id is safe. `receive` writes
`ON CONFLICT (source, delivery_id) DO NOTHING`, so a repeat stores once whether
or not the first attempt arrived.

The procedure:

1. Make the new secret with the command above.
2. Confirm no meeting is running, and none is about to end.
3. Set the new value on nabium, and in the receiver's environment.
4. Restart the receiver. The handler reads `process.env` on every request, so
   the restart is what loads the changed file.
5. Prove the new secret with the signed request below.
6. Re-post any delivery from the window, keeping its original delivery id.

**A receiver holding two secrets would remove the window**, and no such code
exists. `receive` would have to take a list and try each, and the rotation
would then be: add the new secret, move nabium across, drop the old one. That
is a change to `src/webhooks/receive.ts` and to its route, and nobody has
written it.

### Proving the new secret

`sign` computes the header nabium sends, so the same function proves the
rotation. Run on 3 September 2026 against a placeholder, and never against a
real secret:

```
$ NABIUM_WEBHOOK_SECRET=PLACEHOLDER_SECRET node --input-type=module -e "
import { sign } from './src/webhooks/receive.ts';
const body = JSON.stringify({ event: 'ping', sessionId: 'rotation-check' });
console.log(body);
console.log(sign(body, process.env.NABIUM_WEBHOOK_SECRET));
"
{"event":"ping","sessionId":"rotation-check"}
sha256=840f7a68f63bd085778b00e16c0194bfb294252a014b4c6747fd85a54d7c5522
```

Post that body and that signature. **This command was not run**, because no
receiver listened on this Mac. Whoever runs it first should correct this
paragraph.

```
curl -i -X POST http://amaterasu:3000/api/webhooks/nabium \
  -H 'content-type: application/json' \
  -H 'x-nabium-delivery-id: rotation-check' \
  -H "x-nabium-signature: $SIGNATURE" \
  --data "$BODY"
```

Read the status. `statusFor` maps them, and this table came from running it on
3 September 2026:

| Status | Meaning |
|---|---|
| 202 | Stored |
| 200 | This delivery id had already arrived |
| 401 | The two sides hold different secrets, or no signature came |
| 413 | The body exceeds five megabytes |
| 400 | The body is not JSON, or lacks `event` or `sessionId` |
| 503 | The receiver holds no secret at all |

## On the Mac

Real values live at `~/.config/kpa/env`, outside the repository. Checked on
3 September 2026:

```
$ stat -f '%Sp %Su %N' ~/.config/kpa ~/.config/kpa/env
drwx------ shanedolley /Users/shanedolley/.config/kpa
-rw------- shanedolley /Users/shanedolley/.config/kpa/env
```

```
$ stat -f '%OLp %N' ~/.config/kpa ~/.config/kpa/env
700 /Users/shanedolley/.config/kpa
600 /Users/shanedolley/.config/kpa/env
```

The owner reads the file and nobody else does. The directory is `0700`, so no
other user lists it.

### Creating it

```
mkdir -p ~/.config/kpa
cp .env.example ~/.config/kpa/env
chmod 700 ~/.config/kpa
chmod 600 ~/.config/kpa/env
```

Then fill in the values. `.env.example` names every variable the root package
reads and holds no value.

### How the code reads it

`package.json` passes `--env-file-if-exists=$HOME/.config/kpa/env` to Node.
Nothing calls `dotenv`, and no code names a path of its own. The web tier is
the exception, covered above.

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

The web tier needs its own unit and its own `EnvironmentFile`, because it reads
`NABIUM_WEBHOOK_SECRET` and the worker does not.

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
wrote it into this one instead, in a commit called `oops`. gitleaks scanned
that commit directly and reported no leaks. The commit was removed before it
reached the remote, and the password in it was invented for the test and works
on nothing.

Anyone reading a clean gitleaks run as proof that no connection string was
committed is reading it wrong. That is why the next two checks exist, and check
3 catches exactly this case.

**2. The credentials in use.** Reads each password from `~/.config/kpa/env` and
greps the whole history for it. No false positives, and it answers the question
that matters: is a key that works today in the history? It prints no value
either way. `KPA_ENV_FILE` points the check at another file, which is how its
own failure path is tested.

This check reads a password out of a connection string, so it covers the two
database URLs and reaches none of the other five variables.

**3. Connection strings carrying a password.** A pattern grep over every commit.
A `${SHELL_VARIABLE}` or an all-caps `PASSWORD` placeholder passes. A literal
fails.

Check 3 carries a `reviewed` list in the script, holding matches a person read
and cleared. Add an entry only after reading the commit it comes from, and say
why the match is not a credential.

## If a key does reach the history

Rotate first, scrub second. A key in a pushed history is compromised from the
moment it is pushed, and rewriting history does not un-push it.

1. Change the credential at its source. The table below says where.
2. Update `~/.config/kpa/env`, and the web tier's own file when the key is the
   nabium secret.
3. Rewrite the history with `git filter-repo`, then force push.
4. Run `./scripts/scan-history.sh` and confirm it passes.

Step 1 is the one that ends the exposure. Steps 3 and 4 stop the next reader
finding a key and assuming it still works.

| Key | Where to change it | What it costs |
|---|---|---|
| A database password | `ALTER ROLE kpa PASSWORD ...` on amaterasu | A restart |
| `NABIUM_WEBHOOK_SECRET` | Both sides, by *Rotating one* above | A delivery, if a meeting ends mid-rotation |
| `VOYAGE_API_KEY` | Revoke and reissue at `dash.voyageai.com` | Whatever the old key was billed |
| `KPA_SECRET_KEY` | A new `openssl rand -base64 32` | Every stored credential, retyped |
| `REUI_LICENSE_KEY` | Reissue at `reui.io` | A premium block install |
