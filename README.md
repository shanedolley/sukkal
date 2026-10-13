# Sukkal

A hosted web application that acts as Shane Dolley's personal assistant. It
connects to three Google Workspace accounts, ingests meeting transcripts from
nabium, and maintains a memory that learns and corrects itself.

It is to run on `amaterasu`, a Mac mini running Ubuntu, reached through
Cloudflare Tunnel and Access. On 14 October 2026 amaterasu held the production
database and no Sukkal service. KPA-166 deploys the web tier at `app.sukkal.app`.

## Where things are

| Path | Holds |
|---|---|
| `docs/project-brief.md` | what we are building, why, and every decision made so far |
| `docs/adr/` | the decisions that were hard to reverse, with the options they beat |
| `docs/schema.md` | what each table holds, and three decisions a reader would question |
| `docs/vault-log.md` | the Memory vault's log, moved whole, and why it lives here |
| `docs/runbooks/` | how to operate the server, and where the secrets live |
| `migrations/` | one `.sql` file per migration, applied in filename order |
| `src/db/` | the connection module and the migration runner |
| `src/worker/` | the worker process, and the jobs pg-boss runs in it |
| `test/` | the suite, and its fixtures |
| `apps/web/` | the Next.js interface, a workspace of this package |

**Read the brief first.** It carries the architecture, the sequence diagrams, the
policy the assistant operates under, the risks accepted, and the questions still
open.

## Running it

You need Node 22.18 or newer, and an account on the PostgreSQL server.

1. `npm install` at the root. `apps/web` is a workspace, so this installs it too
2. `mkdir -p ~/.config/sukkal && cp .env.example ~/.config/sukkal/env && chmod 600 ~/.config/sukkal/env`
3. Fill in both connection strings in `~/.config/sukkal/env`.
4. `npm run migrate`
5. `npm test`

`DATABASE_URL` names the database that holds the facts. `DATABASE_URL_TEST`
names a separate database the tests own. Never point the two at one database.
Both need `sslmode=require`, because the server refuses a client that offers no
TLS.

Real values live outside the repository, so no commit can carry one.
`docs/runbooks/secrets.md` says why, and `./scripts/scan-history.sh` proves it.

| Command | What it does |
|---|---|
| `npm run migrate` | Applies every migration not yet recorded |
| `npm run migrate down` | Reverses every migration, newest first, and leaves the database empty |
| `npm run worker` | Runs the worker. `docs/runbooks/worker.md` says what it does |
| `npm test` | Runs the suite against `DATABASE_URL_TEST` |
| `npm run lint` | Lints `src`, `test` and `scripts`. A warning fails the run |
| `npm run decisions` | Rebuilds `docs/decisions.md` from Jira |
| `npm run lint` in `apps/web` | Lints the web tier with the same linter. A warning fails the run |
| `npm run build` | Checks types. It emits nothing, because Node runs the TypeScript |

Node 22.18 strips types as it loads a file, so this repository has no build
step and no bundler.

### Writing a migration

One file carries both directions. Give it a numeric prefix, and separate the
two halves with a line reading `-- @down`.

```sql
CREATE TABLE widgets (id serial PRIMARY KEY);

-- @down
DROP TABLE widgets;
```

The runner records each applied file in `schema_migrations`. It refuses a
database holding tables it did not create, and it refuses a second run with
nothing left to apply. It never guesses what a half-applied database needs.

## Work

Tracked in Jira project **KPA** on `koinon.atlassian.net`.

Stories carry their own specification: acceptance criteria, the files they touch,
the test that proves them, and a definition of done an agent can check without
asking. They derive from the brief. Where the two disagree, the brief gets fixed
rather than the story rewritten to match the code.

## Related repositories

**nabium**, at `~/Development/personal/nabium`. Captures and transcribes meetings
on macOS. Sukkal reads its database through a read-only role and it pushes a session
id over the LAN when one is ready. See ADR-0003.

**personal-assistant**, at `~/Development/personal/personal-assistant`, and the
**Memory vault** at `~/Development/obsidian_vaults/Memory`. The markdown system
Sukkal replaces. Its principles carry forward and the brief records which.
