# Where KPA's secrets live

Written for KPA-16, extended for KPA-70, KPA-137 and KPA-138, and checked on
the Mac on 3 September 2026.

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
| `GOOGLE_OAUTH_CLIENT_ID` | `src/connections/oauth.ts` | The Google grant cannot start |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `src/connections/oauth.ts` | The callback cannot exchange a code |
| `KPA_URL` | `src/connections/oauth.ts` | The grant redirects to `http://localhost:3000` |
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

### A vendor key is not in this file

`VOYAGE_API_KEY` and `VOYAGE_PROJECT_ID` were named here and read by no code.
KPA-104 settled where a vendor key lives on 3 September 2026, and the answer is
a connection: the screen collects it, `src/connections/crypto.ts` seals it, and
`connection_credentials` holds it beside the date it expires and the last
verdict a vendor gave. An environment variable carries a string and no date,
and the brief requires both of every credential.

So Voyage, OpenRouter, Claude and Linear are added on the connections screen
and appear nowhere in `~/.config/kpa/env`. `KPA_SECRET_KEY` is what protects
them all, which is why rotating it costs every one.

**Voyage is metered, and verifying it costs a little.** It publishes no
endpoint that names a key, so the cheapest authenticated call
`src/connections/verify.ts` can make is an embedding of one short string.
`Probe.cost` records that as `metered` where the other three read `free`, so a
schedule can decide whether to pay for a nightly check. KPA-107 is that
schedule.

### An OAuth client is not a vendor key, and it does live here

`GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` sit in this file,
where the section above sends every vendor key to a connection instead. The two
are different things.

A vendor key belongs to one account and expires on a date, which is the shape
`connection_credentials` holds. An OAuth client identifies the application to
Google. One client serves all three Google accounts, so it fits no single row,
and the callback route needs it to exchange an authorization code before any
connection row exists. `KPA_SECRET_KEY` sets the same precedent: what the
application needs before it can open a sealed secret cannot itself be one.

What the grant returns is a vendor credential and follows the rule above. The
refresh token for each account goes through `src/connections/crypto.ts` into
`connection_credentials`.

**The expiry column stays null on a Google connection**, because Google names
no lifetime for a refresh token: it works until somebody revokes it. The
callback writes the expiry the answer carries and invents none, so a date on
that row would tell the briefing a credential lapses on a day nobody promised.
The access token does carry a lifetime, and it is not what is stored: it lasts
an hour and is re-minted from the refresh token on demand.

The client came from Google Cloud project `personal-assistant-506014`, which
`workspace-mcp` already used. KPA inherits it rather than registering a second
one, so revoking one client revokes both. The redirect URIs are registered in
that project's console.

### `KPA_URL` is not a secret, and it still has to be right

It names where this installation answers, and it is the one value the grant
cannot guess. `redirectUri` in `src/connections/oauth.ts` builds
`$KPA_URL/oauth2/callback`, and the provider compares that string to
the ones its console holds, character for character.

**Configure it rather than read it off the request.** A value taken from
`x-forwarded-host` is a value the caller wrote, which is the class of defect
ADR-0023 refused for identity. Here it fails in a way nobody can read: the
provider answers `redirect_uri_mismatch` and names neither value.

Absent, it falls back to `http://localhost:3000`, which suits `next dev` and
nothing else. Set it to the tunnel address, with no trailing slash, and add
the same address in the provider's console.

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

`receive` checks that each secret is not empty and checks nothing else, so
length is a choice rather than a rule. Thirty-two bytes matches every other key
here:

```
openssl rand -base64 32
```

Put the one value on both sides: nabium's sender configuration, and the
receiver's environment. Never in this repository.

### Rotating one

**The receiver holds every secret the variable names**, so a rotation drops
nothing. `NABIUM_WEBHOOK_SECRET` carries one secret or two, separated by a
comma, and `receive` in `src/webhooks/receive.ts` accepts a signature matching
any of them. No base64 secret contains a comma, so the separator cannot cut one
in half. KPA-138 built this on 3 September 2026.

The procedure:

1. **Add the new secret.** Make it with the command above. Set
   `NABIUM_WEBHOOK_SECRET` to both values, the old one first, separated by a
   comma: `OLD,NEW`. Restart the receiver. It now accepts either.
2. **Move nabium across.** Set the new value alone on nabium. Prove it with the
   signed request below.
3. **Drop the old secret.** Set `NABIUM_WEBHOOK_SECRET` to the new value alone.
   Restart the receiver.

Restart after each change to the variable. The handler reads `process.env` on
every request, and the process reads its environment once at startup.

No step depends on the minute you run it. A delivery arriving at any point in
the rotation is signed with a secret the receiver holds, so a meeting may run
throughout. **ADR-0013 records that nabium does not retry**, which is why the
old procedure asked you to pick the right minute.

A space after the comma is safe. The route trims each entry, so `OLD, NEW`
holds two secrets and neither carries a space.

An empty entry is not a secret. `,,` and an empty variable both leave the
receiver holding nothing, and it answers 503.

A delivery re-posted with its original delivery id is safe. `receive` writes
`ON CONFLICT (source, delivery_id) DO NOTHING`, so a repeat stores once whether
or not the first attempt arrived.

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

**2. The credentials in use.** Reads every value in `~/.config/kpa/env` and
greps the whole history for each one. No false positives, and it answers the
question that matters: is a key that works today in the history? It prints no
value either way. It names the variable that matched and the commits holding
it, because a commit hash is not a secret and a scrub needs one. `KPA_ENV_FILE`
points the check at another file, which is how its own failure path is tested.

A connection string is searched whole, and its password is searched alone. The
check read only that password until KPA-137, so a leaked `KPA_SECRET_KEY`
passed all three checks.

**Four kinds of value are skipped**, and each rule drops a value that would
fail every run rather than one that could leak. A `*_PATH` or `*_DIR` names a
location on disk, and `VAULT_PATH` holds a path the repository names
throughout. An empty value matches every commit. An all upper case value is a
placeholder, the shape check 3 already clears. A value under 16 characters is
shorter than anything this project issues: the database password is 32
characters and `KPA_SECRET_KEY` is 44. Issue a longer secret rather than lower
that number.

**3. Connection strings carrying a password.** A pattern grep over every commit.
A `${SHELL_VARIABLE}` or an all-caps `PASSWORD` placeholder passes. A literal
fails.

Check 3 carries a `reviewed` list in the script, holding matches a person read
and cleared. Add an entry only after reading the commit it comes from, and say
why the match is not a credential.

**What all three checks miss.** Check 2 searches for the values that file holds
today. The Mac's file names five variables and omits `NABIUM_WEBHOOK_SECRET`,
so nothing searches for that secret. A rotated key is the same case: the file
holds the new value while the history holds the old one. Check 3 reads
connection strings only, and gitleaks has no rule for a bare base64 key. Both
were measured on 3 September 2026 against a fake 44-character key in a
throwaway repository, which gitleaks read and cleared.

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
| `NABIUM_WEBHOOK_SECRET` | Both sides, by *Rotating one* above | A restart |
| `KPA_SECRET_KEY` | A new `openssl rand -base64 32` | Every stored credential, retyped |
| `REUI_LICENSE_KEY` | Reissue at `reui.io` | A premium block install |
