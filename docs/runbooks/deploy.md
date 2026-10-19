# Deploying to amaterasu

Written for KPA-166 on 19 October 2026. ADR-0026 records the decision.

**Nothing in this runbook has run on amaterasu.** The Mac could not reach the
box when it was written. Every command in *Build*, *Prove it locally* and *Logs*
ran on the Mac against a local database. The steps under *Ship*, *First start* and
*Roll back* are the pattern. Whoever runs them first corrects this file.

Four containers run from `compose.yaml`:

| Service | Runs | Reads |
|---|---|---|
| `web` | `next start`, bound to `127.0.0.1:3000` | `/etc/sukkal/env` |
| `worker` | `src/worker/index.ts` and its pg-boss queue | `/etc/sukkal/env` |
| `site` | Caddy serving `site/`, bound to `127.0.0.1:3001` | `site/` and `site.Caddyfile`, read-only |
| `cloudflared` | Sukkal's own tunnel | `/etc/sukkal/tunnel-token` |

`web` and `worker` use one image, `sukkal:<tag>`. The existing `cloudflared`
container on amaterasu serves another domain. Do not inspect it, stop it or join
it. Compose names the new one `sukkal-cloudflared-1`, so the two never collide.

## What only Shane does

Do these in order. The agent that built this cannot do any of them.

1. **Create the tunnel.** In the Cloudflare dashboard, open Zero Trust, Networks,
   Tunnels. Create a Cloudflared tunnel named `sukkal`. Copy the token it shows.
2. **Add the public hostname.** On that tunnel, route `app.sukkal.app` to the
   service `http://localhost:3000`. Cloudflare writes the one proxied CNAME.
3. **Create the Access application.** Make it self-hosted, on `app.sukkal.app`,
   with one Allow policy that admits your email alone. Test with a second
   identity: Access must refuse it before the request reaches the tunnel.
4. **Put the token on the box.** Type the token without echo, so it never enters
   shell history or a file you can read back:

   ```
   sudo install -d -m 0755 /etc/sukkal
   read -rs TUNNEL_TOKEN && printf '%s' "$TUNNEL_TOKEN" | sudo sh -c 'umask 077; cat > /etc/sukkal/tunnel-token'; unset TUNNEL_TOKEN
   sudo chown 65532:65532 /etc/sukkal/tunnel-token
   ```

   The owner is uid 65532, the user of the `cloudflared` image.
5. **Write the env file.** See *The env file*. Only you can type the values.
6. **Add the Google redirect URI** `https://app.sukkal.app/oauth2/callback` in
   Google Cloud project `personal-assistant-506014`, beside the two localhost
   URIs.
7. **Approve the production migration** in a comment on KPA-166. Production
   `sukkal` holds 21 migrations and the repository holds 32 files, numbered to 033. Nobody migrates it
   without that comment.

## The env file

One file serves `web` and `worker`: `/etc/sukkal/env`. This settles the conflict
between `worker.md` and `secrets.md`. The home directory path is gone.

```
sudo install -m 0600 -o 1000 -g 1000 /dev/null /etc/sukkal/env
sudo -e /etc/sukkal/env
```

Uid 1000 is the `node` user inside the image. Mode 0600 means no other user on
the box reads it.

| Variable | Value on the box |
|---|---|
| `DATABASE_URL` | `postgresql://sukkal:PASSWORD@127.0.0.1:5432/sukkal`. A loopback host needs no `sslmode` |
| `SUKKAL_SECRET_KEY` | A new key from `openssl rand -base64 32`. Never copy the Mac's: credentials sealed under it do not open here |
| `SUKKAL_URL` | `https://app.sukkal.app`, with no trailing slash |
| `GOOGLE_OAUTH_CLIENT_ID` | The same client as the Mac |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The same client as the Mac |
| `NABIUM_WEBHOOK_SECRET` | The secret nabium signs with. See *Known limits* |
| `SUKKAL_INFERENCE` | Optional. `subscription` (the default) or `api`, the order the two Claude credentials are tried in |

Leave out `DATABASE_URL_TEST` and `VAULT_PATH`. No test runs on the box and no
vault reaches it.

The env file holds no `export` lines and no quotes around values. Node's
`--env-file` reads `KEY=value` lines.

**Restart after any change.** Node reads the file once, at start. Recreate the
containers so they mount the file again: `docker compose up -d --force-recreate`.

## Build

Build on the Mac or in CI, never on amaterasu. The base images are multi-arch.

Find the box's architecture first:

```
ssh amaterasu uname -m
```

`x86_64` means `linux/amd64`. `aarch64` means `linux/arm64`. Then build with the
commit as the tag:

```
TAG=$(git rev-parse --short HEAD)
docker buildx build --platform linux/amd64 -t sukkal:$TAG --load .
```

The build installs the Claude Code CLI at one pinned version from the npm registry
(ADR-0027), so it needs the network, and the image grows by about 270 MB.

Build from a clean checkout of the commit you mean to ship. `.dockerignore`
keeps `.env*`, host `node_modules`, `.next`, the vault and `docs` out of the
image. Check it before the first ship:

```
docker run --rm --entrypoint sh sukkal:$TAG -c 'find / -name ".env*" -not -path "*/node_modules/*" 2>/dev/null'
```

It prints `/app/.env.example` and `/app/apps/web/.env.example`, which hold no
value, and nothing else.

## Ship

The image holds no secret, so no registry is needed. Stream it over ssh:

```
docker save sukkal:$TAG | gzip | ssh amaterasu 'gunzip | docker load'
ssh amaterasu 'install -d /opt/sukkal'
scp compose.yaml site.Caddyfile amaterasu:/opt/sukkal/
rsync -a --delete site/ amaterasu:/opt/sukkal/site/
```

The `site` service mounts `site/` and `site.Caddyfile` from `/opt/sukkal`. Copy both
again after any change to the public pages. Caddy reads the files on each request,
so the pages need no restart. A change to `site.Caddyfile` needs
`docker compose restart site`.

## First start

1. Run the migration, and only after Shane approved it on the ticket. Read the
   ledger before and after.

   ```
   ssh amaterasu 'cd /opt/sukkal && echo SUKKAL_TAG='$TAG' > .env'
   psql "$DATABASE_URL" -c 'SELECT count(*) FROM schema_migrations'
   ssh amaterasu 'cd /opt/sukkal && docker compose run --rm -e SUKKAL_ALLOW_PRODUCTION=1 worker node --env-file=/run/sukkal/env src/db/migrate.ts'
   psql "$DATABASE_URL" -c 'SELECT count(*) FROM schema_migrations'
   ```

   The runner names the database before it acts. Expect 21 rows before and 32 after,
   because no `002` exists.
2. Start all four:

   ```
   ssh amaterasu 'cd /opt/sukkal && docker compose up -d'
   ```

3. Check the web tier from the box:

   ```
   ssh amaterasu 'curl -si http://127.0.0.1:3000/ | head -1'
   ```

   Expect `HTTP/1.1 307 Temporary Redirect` with `location: /sign-in?next=%2F`.
4. Check the tunnel from a phone off the home network. Access should ask for your
   email, and Sukkal's sign-in should follow.

The `.env` file in `/opt/sukkal` holds the tag and nothing secret. Compose reads
it for `${SUKKAL_TAG}`.

## The public site

`web.sukkal.app` serves the homepage, privacy policy and terms that Google's OAuth
verification needs. The `site` service holds nothing but static files. It shares no
code, session or route with the web tier, so `web.sukkal.app` reaches no app page.

Do these in order. Only Shane can.

1. **Add the public hostname.** In the Cloudflare dashboard, open the `sukkal`
   tunnel. Route `web.sukkal.app` to the service `http://localhost:3001`.
2. **Leave Access off it.** Create no Access application for `web.sukkal.app`. The
   page must stay public, or Google cannot read it. The Access application covers
   `app.sukkal.app` only. Check that no wildcard application, such as
   `*.sukkal.app`, covers the new name.
3. **Check it from outside.** Open `https://web.sukkal.app/` on a phone off the home
   network. The page must load with no Access prompt.

Then the Google steps. Use the Google Cloud project `personal-assistant-506014`.

1. **Verify the domain.** Open Google Search Console and add a Domain property for
   `sukkal.app`. Google shows a TXT record. Add it in Cloudflare DNS, then select
   Verify. Use the Google account that owns the Cloud project.
2. **Authorise the domain.** In Google Auth Platform, open Branding. Under
   Authorized domains, add `sukkal.app`.
3. **Fill the Branding page.** Set the app name to `Sukkal`, the same name the pages
   use. Upload `site/logo.png`, which is 120 by 120 pixels. Set the homepage to
   `https://web.sukkal.app/`, the privacy policy to
   `https://web.sukkal.app/privacy.html`, and the terms to
   `https://web.sukkal.app/terms.html`. Set the support email.
4. **Fill the Data Access page.** Add these seven scopes and no others. They match
   `src/connections/oauth.ts` and the privacy policy:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events.freebusy`
   - `https://www.googleapis.com/auth/drive`

The pages name every scope in `src/connections/oauth.ts`. Change the pages in the
same commit as any change to those scopes.

Prove the service on the Mac with only that one service. Port 3000 stays free:

```
SUKKAL_TAG=x docker compose -p sukkalsiteproof up -d site
curl -si http://127.0.0.1:3001/privacy.html | head -20
SUKKAL_TAG=x docker compose -p sukkalsiteproof down
```

## Deploy a new commit

Build, ship the image, then change the tag and recreate:

```
ssh amaterasu "cd /opt/sukkal && sed -i 's/^SUKKAL_TAG=.*/SUKKAL_TAG=$TAG/' .env && docker compose up -d"
```

Run a new migration first when the commit adds one, with the command under
*First start*. The tables the web tier reads must exist before it starts.

## Roll back

A rollback is the previous tag. Compose keeps no history, so list the tags:

```
ssh amaterasu 'docker images sukkal --format "{{.Tag}}  {{.CreatedSince}}"'
ssh amaterasu "cd /opt/sukkal && sed -i 's/^SUKKAL_TAG=.*/SUKKAL_TAG=<old tag>/' .env && docker compose up -d"
```

**A migration does not roll back with the image.** The old image runs against the
new schema. `npm run migrate down` reverses every migration at once and drops the
`pgboss` schema, so it is never part of a rollback. Prune old tags only after the
new one has run for a day: `docker image rm sukkal:<old tag>`.

## Logs

```
ssh amaterasu 'cd /opt/sukkal && docker compose logs --since 1h worker'
ssh amaterasu 'cd /opt/sukkal && docker compose logs -f web'
ssh amaterasu 'cd /opt/sukkal && docker compose ps'
```

Each service keeps three files of 10 MB, so logs never fill the disk. `ps` shows
`web` as `healthy` once it answers.

Prove the worker ran without anyone starting it. The hourly recheck writes rows:

```
SELECT name, state, completed_on FROM pgboss.job ORDER BY created_on DESC LIMIT 5;
SELECT max(verified_at) FROM connection_credentials;
```

## Restart

```
ssh amaterasu 'cd /opt/sukkal && docker compose restart worker'
```

Use `restart` for one service and `up -d --force-recreate` after an env file
change. Every container has `restart: unless-stopped`, so the box starts them at
boot and after a crash, provided the Docker service starts at boot. Check it
once: `systemctl is-enabled docker`.

## Prove it locally

Docker Desktop on the Mac has no host networking, so the compose file cannot
reach the Mac's Postgres as written. A forwarder container fixes that. It
listens on its own `localhost:5432`, and `web` and `worker` share its network, so
`connect.ts` takes the same loopback path it takes on the box.

Create a database that no test and no dev server uses:

```
createdb sukkal_dev_docker && psql -d sukkal_dev_docker -qc "CREATE EXTENSION IF NOT EXISTS vector"
DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_dev_docker" npm run migrate
```

Write `compose.local.yaml` outside the repository:

```yaml
services:
  pg-bridge:
    image: alpine/socat
    command: TCP-LISTEN:5432,fork,reuseaddr TCP:host.docker.internal:5432
  web:
    network_mode: service:pg-bridge
  worker:
    network_mode: service:pg-bridge
```

Write an env file and a placeholder token file, then start the two:

```
printf 'DATABASE_URL=postgresql://%s@localhost:5432/sukkal_dev_docker\nSUKKAL_SECRET_KEY=%s\nSUKKAL_URL=http://localhost:3100\n' "$(whoami)" "$(openssl rand -base64 32)" > local.env
export SUKKAL_TAG=<tag> SUKKAL_WEB_PORT=3100 SUKKAL_ENV_FILE=$PWD/local.env SUKKAL_TUNNEL_TOKEN_FILE=$PWD/token
docker compose -f compose.yaml -f compose.local.yaml -p sukkalproof up -d pg-bridge web worker
docker run --rm --network container:sukkalproof-pg-bridge-1 curlimages/curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3100/
```

Expect `307 http://127.0.0.1:3100/sign-in?next=%2F`. The worker prints its queue
and the two start-up jobs. Port 3000 stays free for a dev server.

Do not start the `cloudflared` service locally: it needs a real token. To check
that the token file is read, run the image with a junk file. A bad token answers
`Provided Tunnel token is not valid` and a missing file answers `Failed to read
token file`.

## Known limits

- **Nabium cannot reach the web tier on the LAN.** The tier binds `127.0.0.1`, and
  the webhook route is `/api/webhooks/nabium`. Sending it through the tunnel
  meets Access, which refuses a non-browser caller. Choose one: set
  `SUKKAL_WEB_HOST=0.0.0.0` in `/opt/sukkal/.env` and open the LAN to port 3000,
  or add an Access service token. This runbook decides neither.
- **No CI job builds the image.** A broken `Dockerfile` shows at the first build.
- **Membership of the `docker` group equals root on the box.** The env file keeps
  its secrets out of `docker inspect`, and a member of the group can still read
  the file through a container.
