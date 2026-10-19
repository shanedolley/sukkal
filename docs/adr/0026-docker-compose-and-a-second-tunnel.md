# Docker with compose, and a second tunnel

Sukkal runs on amaterasu as one image started twice, as the web tier and as the
worker, beside its own `cloudflared` container. Shane ruled this on 19 October
2026 on KPA-166, comments 11790 and 11951.

This supersedes the brief's *Deployment* row, which chose bare metal under
systemd and no containers. Measured on 14 October 2026, that plan no longer fits
the box: amaterasu runs Docker 29.8.0, has no Node, and has 6.9 GB of memory
available.

## Considered Options

1. **Node 22 under systemd** - lost. Ubuntu 24.04 ships Node 18 and the
   repository needs 22.18, so it needs NodeSource or a tarball. It builds on the
   box, next to the transcoding load, and a rollback needs a kept build. It adds a
   second way to run things beside the tunnel container. The memory saving is
   under 30 MB of 6.9 GB, so memory did not decide it.
2. **Docker with a compose file** - chosen. The build runs on the Mac or in CI.
   A deploy is a new image tag and a rollback is the old one. It runs the same
   container ADR-0009 says Sukkal ships as.
3. **Join the existing `cloudflared` container** - lost. That container serves
   another domain. Sharing it would tie two sites to one token and one restart.
   Sukkal leaves it alone.

## Decisions inside it

- **One image, two commands.** The web tier imports twelve modules from `src/`, so
  both processes need the same tree. One tag then names one release.
- **Host networking.** Postgres on amaterasu listens only on localhost and
  `192.168.20.110`. The web tier binds `127.0.0.1`, so the box opens no port.
- **A second tunnel, with its own token.** Shane creates it in the Cloudflare
  dashboard. Its token reaches the container through a file and
  `cloudflared tunnel run --token-file`, which cloudflared 2026.10.1 supports.
- **No secret in `docker inspect`.** Any member of the `docker` group reads every
  environment value and every command line. So the env file is mounted read-only
  and Node reads it with `--env-file`. Compose uses no `env_file:` and no
  `environment:` for a secret.
- **One env file path: `/etc/sukkal/env`.** It settles the conflict between
  `worker.md`, which named `/home/sukkal/.config/sukkal/env`, and `secrets.md`,
  which named `/etc/sukkal/env`. The file is owned by uid 1000, the `node` user
  in the image, with mode 0600. The tunnel token is `/etc/sukkal/tunnel-token`,
  owned by uid 65532, which is the `cloudflared` image's user.
- **The image is built off the box and shipped with `docker save`.** No registry
  exists yet, and the image holds no secret.

## Consequences

- Membership of the `docker` group on amaterasu equals root there. It was true
  before this decision and remains true.
- The Mac cannot run the host-networking file. Docker Desktop has no host
  networking by default, so a local run needs a forwarder for Postgres. The
  runbook shows one.
- A change to the env file takes effect at the next restart, because Node reads it
  once at start.
- amaterasu's CPU architecture was unknown when this was decided. The image builds
  for either, and the runbook names the `--platform` flag.
- The image weighs about 760 MB, because it holds the root `node_modules` and the
  built web tier. A standalone Next build would shrink it. It would also edit
  `apps/web/next.config.ts`, so it is left until the size costs something.
