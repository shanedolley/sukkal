# Handover

State as at 13 September 2026. `prompt.md` holds the instructions for a new
session. This file holds the facts.

## Where the work is

**Branch `main`, pushed, the working tree clean and CI green.** This project
commits straight to `main`; `CLAUDE.md` says why and names the override the
hook wants. Read the head with `git log --oneline -1` rather than from here: a
commit hash written into a file is stale the moment the file is committed.
Read CI with `gh run list --limit 1`.

**[KPA-13](https://koinon.atlassian.net/browse/KPA-13) and
[KPA-131](https://koinon.atlassian.net/browse/KPA-131) shipped on
13 September 2026.** The migration agrees with the vault, and a citation keeps
its words. *The migration is proved* below says what both mean.

Twenty-nine migration files, numbered to `030`. Twenty-seven ADR files,
numbered to `0025`, because `0007` and `0008` each hold two. Counted with `ls`
on 13 September 2026.

The suite runs **629 tests with the vault and 609 without it**, measured on
13 September 2026 after KPA-131. One test skips in both, and it is meant to:
`test/connect.test.ts` skips its TLS case because a loopback database needs
none.

## The board

Project KPA on `koinon.atlassian.net`. **122 stories, 87 shipped, which is 71%
by count.** Counted from Jira on 13 September 2026, two pages, after KPA-131
shipped.

| Status | Stories |
|---|---|
| Done | 59 |
| In Review | 28 |
| To Do | 34 |
| Decision required | 1 |

**In Review means shipped.** Each is on `main`, pushed, and CI green. They wait
on Shane reading them and nothing else, so a story blocked by one is not really
blocked.

    KPA-68  KPA-70  KPA-77  KPA-78  KPA-79  KPA-83  KPA-94  KPA-95
    KPA-97  KPA-98  KPA-99  KPA-100 KPA-104 KPA-127 KPA-128 KPA-137
    KPA-138 KPA-139 KPA-144 KPA-146 KPA-148 KPA-150 KPA-151 KPA-153
    KPA-155 KPA-156 KPA-13  KPA-131

| Epic | Done/All | Title |
|---|---|---|
| KPA-1 | 18/20 | Slice one: migrate the memory |
| KPA-35 | 8/8 | Build the web interface |
| KPA-51 | 7/7 | Finish the memory schema |
| KPA-52 | 16/22 | Join the halves: replace every fixture |
| KPA-53 | 12/12 | Build the application data schema |
| KPA-54 | 5/10 | Connect the accounts |
| KPA-55 | 3/14 | Fill the stores |
| KPA-56 | 6/7 | The agent and the policy engine |
| KPA-57 | 0/7 | Retrieval and chat |
| KPA-75 | 5/6 | Let the installation authenticate its owner |
| KPA-145 | 2/3 | Harden what the installation exposes |
| KPA-149 | 2/2 | Become Sukkal. In Review itself |
| KPA-152 | 3/4 | Move the machine identifiers off KPA |

**Paging matters.** `/rest/api/3/search/jql` caps a page at 100 issues whatever
`maxResults` says, and answers with a `nextPageToken` rather than an error. An
unpaged query reads one page and reports it as the whole project. A handover on
3 September said "62 of 100 stories" for exactly that reason, and both numbers
were wrong.

## The assistant is Sukkal

**Both stories under
[KPA-149](https://koinon.atlassian.net/browse/KPA-149) shipped on
12 September 2026.** KPA-150 carried the name through 190 places a person
reads, and KPA-151 drew the face. Both are on `main` and CI is green.

A sukkal is a role rather than a name: in Mesopotamian religion, a deity who
served a greater one as servant, advisor and envoy, and who could intercede on
a mortal's behalf. The word began as a Sumerian office translated as vizier,
held by somebody who oversaw the execution of a king's commands and acted as
envoy and translator. Scholarship describes the bond between a sukkal and the
deity served "not as cause and effect, but as command and execution", which is
the policy engine ADR-0005 built.

Three held the office and the record treats them differently.

**Ninshubur**, sukkal of Inanna, is the earliest and most important. In
Inanna's Descent she petitions Enlil, then Nanna, then Enki, until one acts.
Her attribute is the staff; her associated objects are doors, shoes and lapis
lazuli; her astral symbol is Orion. Almost no certain depiction of her
survives.

**Isimud**, sukkal of Enki, is the avatar. Akkadian *Usmû*, from a word meaning
two-faced, and that is what he is: one head, two faces looking opposite ways.
Advisor, messenger and doorkeeper. He is the exception among sukkals, because
every other one needs a staff to be identified in art and he does not.

**Nuska**, sukkal of Enlil, is a god of fire and light and a protection at
night. Staff, lamp, rooster, and a bundle of flames on Old Babylonian seals.

**The avatar is Isimud rather than Ninshubur, because something survives to
read.** He appears on cylinder seals from the Akkadian through the Kassite
periods, and the Adda seal in the British Museum is the one to work from:
greenstone, about 2300 BC, showing Shamash rising through the mountains,
Ishtar armed, Enki with water at his shoulders, and behind Enki his two-faced
vizier. Drawing Ninshubur would be an invention wearing a citation.

The two faces also say what the product does. One turned to the person served,
one to the world reached.

**The risk KPA-151 named did not arrive.** It feared two faces at 16px.
`size-16` is a Tailwind class rather than a pixel count, and it renders at
64px, so the smallest place the avatar appears is four times the size the
ticket feared. Both faces read at 64px and the silhouette still holds at 32px.
Nothing was given up.

**The drawing is in
`apps/web/components/setup/assistant-avatar.tsx`, and its silhouette is the
identity.** Two attempts failed before the third worked, and both failed the
same way: a round skull with a bump on each side reads as one head with ears,
whatever is drawn inside it. The outline has to run forehead, nose, lip, chin
and then the same mirrored. Two profiles joined at a point make a spearhead,
so they meet across a plateau the crown covers. A long beard stops reading as
a beard and starts reading as a torso.

`apps/web/scripts/check-avatar.ts` is the twentieth web check. It reads the
source, because Node cannot import a `.tsx`.

**The name is a role, which leaves the instance its own name.** The setup
wizard asks what to call the assistant and stores it in
`users.assistant_name`. Ninshubur and Isimud are on that list now.

**The machine followed, in KPA-153.** Shane ruled on 13 September 2026 that
five of the six identifiers move. The variables, the config folder, the package
names, the repository and the local databases all read `sukkal` now. KPA-152 is
the epic and KPA-154 carries what is left.

**The Jira project key stays `KPA`**, with its 644 references, and so does the
project's own label `KPA · Personal Assistant`, which is keyed to it and seeded
by `migrations/018`.

**Three more things keep the letters, and each is deliberate.** Twelve SVG
names inside the avatar, which never leave the component. `kpa-worker`, the
`application_name` the worker reports to PostgreSQL. And `docs/decisions.md`,
which `npm run decisions` rewrites from Jira on every run.

**The ten browser storage keys moved in KPA-155**, on 13 September 2026. Eight
`kpa.issues` keys, `kpa.space` and `kpa.appearance` all read `sukkal.` now.

Nine of the ten carry their saved value. `readCarried` in
`apps/web/lib/local-store.ts` reads the new name, falls back to the old one,
writes the value forward and removes the old key. Every key renamed the same
way, so one rule covers every caller, and removing the old key is what stops a
stale value overwriting a newer one on some later read.

`sukkal.appearance` carries nothing, because it caches a server value. A browser
used before the rename paints the stylesheet's green once, then the provider
corrects it, which is the single wrong paint ADR-0022 already accepts.

**The rule writes during a render, and React raises nothing.** The store reads
in `getSnapshot` so the first render holds the saved value, and carrying forward
means writing there too. The write is idempotent, so consecutive snapshots
return the same string and `useSyncExternalStore` is satisfied. Proved in Chrome
rather than reasoned about: the console carried no hydration warning and no
React error.

`apps/web/scripts/check-local-store.ts` is the twenty-second web check. It
builds a real store over a stub browser and reads through it, because a check
that only exercised the rule would pass a `createLocalStore` that never called
it. Seven mutations each failed it once.

**The session cookie moved too, in KPA-156.** It is
`__Host-sukkal_session` now. KPA-153 did not list it, another session found it
on 13 September 2026, and Shane ruled the same day: rename it while the only
browser holding one was a laptop, and take the prefix at the same time.

`__Host-` is an instruction rather than a label. The browser refuses the cookie
unless it arrives with `Secure`, with `Path=/`, and with no `Domain`, and then
binds it to this exact origin, so a subdomain can never overwrite the session.
All three set calls already passed those, so the prefix changed the name and
nothing else.

**It makes three attributes load-bearing.** Add a `domain` to any set call and
the browser discards the cookie: the response still says `{"ok":true}`, the
status is still 200, and nobody is signed in.
`apps/web/scripts/check-session-cookie.ts` is what says so.

## The migration is proved

**`scripts/verify-migration.sh` exits 0 against the vault frozen at `da7afce`.**
Run on 13 September 2026, KPA-13. The two reports differ by exactly the two
orphans ADR-0019 permits, and five counts agree:

| Count | Vault, by `scripts/count-vault.py` | Postgres, after the load |
|---|---|---|
| Facts | 19 | 19 |
| Sources | 32 | 32 |
| Tasks | 3 | 3 |
| Questions | 2 | 2 |
| Edges | 84 | 84 |

`docs/runbooks/migration-verification.md` says how to read a failure.

**No story had built the load, and KPA-13 built it.** KPA-5 read the vault,
KPA-6 resolved links and KPA-7 parsed tasks, and none wrote a row. The only load
lived inline in `test/advisories.test.ts`. `src/migrate/load.ts` is the load
now, and that test calls it, so its pinned seven-line report proves the real
load rather than a copy.

**KPA-8 is Done and its parser never existed.** The story names
`src/migrate/index-tables.ts`, and git has no history of that file. ADR-0012
then folded `questions` into `needs_you`. The load reads `index.md`'s
*Questions for you* table itself, and each row becomes an open `needs_you`
question on its fact. Both of the vault's questions carry an answer that was
never written back to the fact, so each loads open with the answer in its
detail.

**Three choices the load makes that no ticket stated:**

- `valid_from` takes `generated`, because `asAt` reads it and the day of the
  migration is not the day a fact became true.
- One `url` or `unresolved` node serves every edge naming that ref. The inline
  load made one per edge.
- A fact linking itself is no edge, because `edges_not_self` would refuse the
  row and roll back the whole load.

**The counter lives in this repository, not beside `check.py`.** REQ-033 says
beside it, and writing a file into the frozen vault is the drift REQ-032 checks
for. It is still Python and still reads the files directly, which is the
independence REQ-033 wants.

**Production has not been loaded.** The script refuses `kpa` and `sukkal`, and
the vault has never been written to amaterasu. That run is a person's, on a day
amaterasu answers.

**A citation keeps its words, since KPA-131.** Every `derived_from` edge holds
its `sources:` entry verbatim in `edges.citation`, added by
`migrations/030_edge_citation.sql`. Measured by classifying all 33 entries in
the frozen vault: eight carry a wikilink with words around it. Seven name
`[[index]]`, which ADR-0019 counted, and the eighth names a real source, which
nobody had. Each still points where it did. `docs/schema.md` records the one
ceiling: `edges_unique` keeps one sentence when a fact cites a target twice.

The report did not move. `scripts/verify-migration.sh` gives the same two
explained orphans and the same 84 edges after KPA-131 as before it.

**The vault is still frozen, and nothing in the repository needs it frozen any
longer.** KPA-13 and KPA-131 were the two stories reading the frozen vault as an
oracle, and both have shipped. `docs/runbooks/vault-freeze.md` says to restore
after KPA-13, and restoring starts three launchd jobs, so it is Shane's step.
KPA-74 is the last story that compares against the frozen report.

## One decision waiting

**[KPA-143] is the open question**, and it sits in filter 10047, the queue Shane
works from. How does a self-hosted box send the reset link? KPA-79 mints the
token and names which connection would carry it, and nothing carries it, so a
shell on the server is the only way to a link.

The comment weighs an SMTP provider card, the OAuth mail connection, and no
mail at all, and recommends SMTP: nodemailer 9.1.1 declares no dependencies and
unpacks to 617 KB, against a root that runs two.

**The register reads two exact strings and nothing else.**
`scripts/decision-register.ts` finds a question only in a warning panel whose
first paragraph flattens to exactly `DECISION NEEDED`, and a recommendation
only in a paragraph starting `MY RECOMMENDATION`. A comment saying the same
things in other words is invisible to it. Run `npm run decisions` after posting
one and read the count it prints.

## Where the OAuth work stands

KPA-103 is nearly done and is not closed. Five commits built it:

- `src/connections/oauth.ts` holds one record per provider. A fourth provider
  is a key in that object rather than a route beside the existing pair.
- `migrations/029_oauth_grants.sql` holds a grant in flight. The id is a
  SHA-256 of the state, the PKCE verifier waits beside it, and claiming one is
  a `DELETE ... RETURNING`.
- `POST /api/connections/authorize` starts a grant. `/oauth2/callback`
  finishes it.
- Removing a connection tells the provider first and keeps the row when the
  provider refuses.

**Three Google accounts are connected in `sukkal_local`.** Three `google` rows
in `connections`, counted on 13 September 2026. The session that built KPA-103
proved all three tokens by opening each sealed credential and refreshing it
against Google, and nobody has refreshed them since.

**Two criteria are still open.**

1. "Three accounts produce three distinct connections" is built and half
   proved. The address the provider reports names the connection, and
   `connectionNamed` makes a second grant of the same account refresh the row.
   Granting one account twice would prove the rest in a minute.
2. "A refresh runs before expiry and rewrites the date" is not built. `renew`
   exists in the module and nothing calls it. The worker runs only the drain
   and the nightly review. KPA-107 is the re-verification schedule and this
   criterion sits on KPA-103.

## What runs

```
npm run lint                  # oxlint over src, test and scripts
npm run build                 # tsc --noEmit, which emits nothing
npm test                      # node --test over test/**/*.test.ts
npm run migrate               # applies pending migrations
npm run decisions             # rebuilds docs/decisions.md from Jira
./scripts/scan-history.sh     # every commit, for a credential
./scripts/reset-password.sh   # --link prints a reset link, --unlock ends a run
```

In `apps/web`: `npm run lint`, `npm run build`, and `npm run check`, which runs
twenty-three scripts under plain node.

`./scripts/verify-migration.sh` verifies the migration against the frozen vault.
It needs the vault and local PostgreSQL, and it recreates `sukkal_verify`.

Run the suite the way CI runs it, which is without the vault:

```
VAULT_PATH=/nonexistent DATABASE_URL_TEST="postgresql://$(whoami)@localhost:5432/sukkal_dev" npm test
```

Watch the run afterwards with `gh run list --limit 1`. A push nobody watches is
how the trunk went red on 2 September 2026 and stayed red across two pushes.

## Three databases, and only one is safe for the app

| Database | Who writes it |
|---|---|
| `kpa` on amaterasu | The migration. Production. Five migrations behind |
| `sukkal_dev` | Every test. The suite drops every table in it |
| `sukkal_local` | The running application. No test names it |
| `sukkal_verify` | `scripts/verify-migration.sh`, which drops and recreates it on every run |

**amaterasu still calls its two `kpa` and `kpa_dev`**, because KPA-153 could
not reach the box. Only this Mac's databases moved. `DATABASE_URL` and
`DATABASE_URL_TEST` in the env file therefore still name the old ones, and
KPA-154 changes all four together.

**Both names mean production.** `PRODUCTION` in `src/db/connect.ts` holds
`kpa` and `sukkal`, the migration runner refuses either, and every test calls
`refuseProduction` after it connects. KPA-154 drops `kpa` from that array, and
that is the whole of its change in this repository.

`sukkal_local` exists because the suite ends on `down()`. On 10 September 2026 a
test run destroyed three Google OAuth connections that had taken three consent
screens to create, and the tokens survived at Google where nothing could reach
them to revoke. Start the dev server like this:

```
cd apps/web && DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_local" npm run dev
```

**Production `kpa` holds migrations 001 to 024 and nothing since.** 025 through
029 are not there, so production is five behind. It was migrated by accident on
3 September 2026 and Shane chose to leave it. The command now names the
database before it acts and refuses `kpa` outright;
`SUKKAL_ALLOW_PRODUCTION=1 npm run migrate` migrates it deliberately.

## Environment

`~/.config/sukkal/env`, mode 0600, outside the repository.
`docs/runbooks/secrets.md` says what each value is for.

| Variable | For |
|---|---|
| `DATABASE_URL` | Production `kpa` on amaterasu. The migration reads this and nothing else |
| `DATABASE_URL_TEST` | `kpa_dev` on amaterasu, which KPA-154 renames. Override it with a local URL |
| `SUKKAL_SECRET_KEY` | Seals every connection credential |
| `GOOGLE_OAUTH_CLIENT_ID` | Identifies Sukkal to Google |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The callback exchanges a code with it |
| `SUKKAL_URL` | Where this installation answers. `http://localhost:3000` today |
| `VOYAGE_API_KEY`, `VOYAGE_PROJECT_ID` | Read by no code. KPA-104 moved a vendor key into a connection |

**One OAuth client serves Sukkal and workspace-mcp**, in Google Cloud project
`personal-assistant-506014`. Google holds exactly two redirect URIs, and both
are needed:

```
http://localhost:8000/oauth2callback     workspace-mcp. No slash before callback
http://localhost:3000/oauth2/callback    Sukkal. With the slash
```

## Traps

`CLAUDE.md` carries the traps this repository has paid for more than once:
`noclobber` on `>`, a test run piped into `tail` reporting the wrong exit code,
`--test-concurrency=1` on a bare `node --test`, and the stale
`apps/web/.next/dev/types` that fails a build after a page is removed. What
follows is new, and each cost time on 9 to 13 September 2026.

**Revoking Sukkal at Google's permissions page revokes workspace-mcp too.** The
two share one OAuth client, so removing the application's access at
`myaccount.google.com/permissions` kills every token issued under that client.
Shane cleared three orphaned Sukkal tokens on 12 September and workspace-mcp's
three died with them, including the one account that had worked since August.
Registering a second client would separate them, and nobody has decided to.

**`--env-file` does not override a variable already set.** So
`DATABASE_URL=... ./scripts/reset-password.sh` reaches the database named on the
command line, not the one in `~/.config/sukkal/env`. Proved on 12 September rather
than assumed, and it is what makes the reset script safe to point at
`sukkal_local`.

**A compound command the delete guard blocks runs nothing at all, including
what came before the delete.** A `python3` heredoc followed by `&& rm -rf ...`
in one Bash call was rejected whole, so an edit that reported success had never
run. The tool result says `Could not parse this command to verify delete
safety`; read it as "nothing happened", not as "the delete was skipped".

It bit twice more on 13 September 2026 and now lives in `CLAUDE.md`.

**A grep check can pass for the wrong reason.** Checking that a banner read
"That account is connected" passed against the old code, because the old
ternary used the same sentence as its fallback. The second check, for the
string that only the old path could produce, is what caught it. Pick the string
that proves the change rather than the one the change happens to keep.

**`curl ... | grep -q X && echo good || echo bad` reports good when curl
fails.** The pipeline's status is grep's, and a failed curl makes grep find
nothing, which takes the `||` branch or the `&&` branch depending on the test.
One verification reported that Google had accepted a redirect when curl had
refused the arguments entirely.

**A query parameter is in the page source whatever a component renders.** Next
mirrors the search params into the router state in the flight payload. Removing
a value from the screen does not remove it from the response, so the fix for
anything sensitive is to keep it out of the URL rather than out of the render.

**No route may name `secretFor`.** `test/connections-read.test.ts` reads every
file under `apps/web/app/(app)/api` and fails when one does. The first shape of
the connection revoke opened the sealed token inside the route handler and that
test refused it. The plaintext lives behind `revokeConnection` in
`src/connections/oauth.ts`, which hands a route a verdict.

**The Content-Security-Policy is a nonce, and nothing is prerendered.** KPA-148
shipped on 13 September 2026 and ADR-0025 records why. `apps/web/lib/csp.ts`
writes the policy and `proxy.ts` mints 128 bits per request.

**A hash was never available, and measuring is what showed it.** Every page
carries four to six inline scripts. Three are constant: the appearance
bootstrap, `next-themes`, and a 43-byte line creating `self.__next_f`. The rest
is the flight payload, which carries the rendered page. Eleven pages gave
sixteen distinct hashes, and `/sprints/[scope]` gave eight across three of its
own URLs. A hash of something rendered from the database at request time cannot
be written at build time.

**`export const dynamic = "force-dynamic"` in `apps/web/app/layout.tsx` is the
whole cost, and it is one line rather than twelve.** All 34 routes are dynamic;
12 were prerendered before. Measured at 3 to 6ms prerendered against 10 to 15ms
dynamic, ten requests a page against `next start`.

**The two scripts Next did not write need the nonce handed to them.** Next
nonces its own, including all fifteen `<script src>` bundles, which is what
makes `'strict-dynamic'` safe. `AppearanceBootstrap` and `ThemeProvider` each
take a `nonce` prop from the root layout, which reads `x-nonce`.

**`style-src` keeps `'unsafe-inline'` and a nonce is not an upgrade.** A nonce
applies to a `<style>` element and never to a `style` attribute. Serving
`style-src 'self' 'nonce-...'` raised nineteen violations on the settings screen,
one per attribute: the sidebar's width, an `aspect-ratio`, and the colour
swatches.

**`upgrade-insecure-requests` is absent on purpose.** It would govern an address
that does not exist. KPA-147 owns it.

`apps/web/scripts/check-csp.ts` is the twenty-third web check, and sixteen
mutations each failed it once. One of those mutations caught the check itself
being too weak: asserting that `randomBytes` appeared anywhere passed a proxy
whose first of two nonces had been replaced by a constant. It counts them now.

**A signed-in screen needs no password.** Insert a `sessions` row into
`sukkal_local` whose `id` is the SHA-256 hex of a random token, with a one-hour
`expires_at` and a `user_agent` naming the story. Send the token as the
`__Host-sukkal_session` cookie, and delete the row by its `user_agent`
afterwards. The prefix constrains what a browser accepts from `Set-Cookie` and
not what a request may carry, so `curl -H 'Cookie: __Host-sukkal_session=...'`
works unchanged.
KPA-146 saw the briefing, the connections dialog and the OAuth callback this
way on 13 September 2026, and it left the owner's password alone.

**`next start` holds its build in memory, so a plain `kill` and an immediate
restart serves the old one.** On 13 September 2026 a rebuilt enforcing policy
came back as the previous report-only one, and reading it looked like the edit
had not taken. `kill -9`, then wait for the port to actually free, then start:

```
PID=$(lsof -ti:3000); kill -9 "$PID"
until ! lsof -ti:3000 >/dev/null 2>&1; do sleep 1; done
```

**A mutation that lands in a comment proves nothing.** Two of KPA-148's
mutations replaced the first occurrence of a string, and in `lib/csp.ts` the
first occurrence of `'strict-dynamic'` and of `frame-ancestors 'none'` is in the
doc comment that explains them. Both checks passed and both passes were empty.
Target the line a browser sees, and read the failure message rather than the
exit status.

**A dev server started before KPA-153 still names the old database and answers
500 on every route.** One was found on port 3000 on 13 September 2026, holding
`DATABASE_URL` for `kpa_local`, which KPA-153 renamed to `sukkal_local`. Nothing
in the response says which database: the page is a plain 500 and the name
appears only in `apps/web/.next/dev/logs/next-development.log`. Read that log
before assuming the code is at fault.

**`next dev` refuses a second server for the same directory**, whatever `PORT`
says, and names the running process and its log. So the handover's advice to
take another port does not apply to this one: either reuse the server or stop
the process it names.

**`__Host-` costs nothing on `http://localhost`.** Chrome counts localhost a
secure context, so `document.cookie = "__Host-sukkal_session=...; Path=/;
Secure"` is accepted there and a signed-in screen needs no HTTPS to reach.
Proved in Chrome on 13 September 2026 while KPA-155 read a real board.

**The Write tool overwrote a tracked file without refusing.** On
13 September 2026 it replaced `test/verify.test.ts`, the vendor-key suite, with
an unrelated file, and reported "updated" where a new file reports "created".
Its description says an unread existing file fails to write, and this one did
not. `git show HEAD:test/verify.test.ts` restored it before anything was
staged. Check `git ls-files <path>` before writing a file you believe is new.

**`vault-freeze.sh check` exits 128 rather than naming the drift when the
recorded commit does not exist.** Its `git log want..have` fails first under
`set -e`. A real drift names a commit that exists, so this bites only when
`docs/vault-freeze.txt` is corrupted, which is how a KPA-13 mutation found it.

**`node_modules` was found empty once**, on 9 September, with no explanation.
`npm install` restored 474 packages and the lockfile did not change. A
`Cannot find package 'pg'` from a file that has always imported it means this
rather than a broken import.

## Document map

| File | Holds |
|---|---|
| `CLAUDE.md` | The golden rule, the commands, the layout, and every trap paid for twice |
| `docs/project-brief.md` | The architecture, the decisions, the policy, the risks accepted |
| `docs/adr/` | The decisions that were hard to reverse |
| `docs/decisions.md` | The lighter rulings, generated from Jira |
| `docs/schema.md` | Every table, every enum, and why each constraint exists |
| `docs/runbooks/` | Operating the server, and where the secrets live |
| `apps/web/AGENTS.md` | The Next.js here is not the one you know |

## Two facts worth not rediscovering

**`apps/web/AGENTS.md` is right, and it has now been right four times.** KPA-77
found that `middleware.ts` is deprecated and renamed to `proxy.ts`, and that
Proxy defaults to the Node.js runtime, which is what lets a guard reach the
database. KPA-128 found that a static page calling `useSearchParams` fails the
production build without a Suspense boundary, so `/sign-in`, `/reset` and
`/connections` read their parameters on the server and hand them down. KPA-148
found the third and the fourth: a nonce forces dynamic rendering, and Next
nonces only the scripts it wrote, so `next/script` and `next-themes` each need
the prop handed to them.

**The guide lives in the root `node_modules`, not under `apps/web`.** AGENTS.md
says to resolve it from its own directory and warns that a monorepo may hide it
from the root, and this repository is the other way round: `apps/web` is a
workspace, so npm hoists `next` and the path is
`node_modules/next/dist/docs/01-app/...` from the repository root. Looking for
it under `apps/web/node_modules` answers `No such file or directory`.

**Transcripts come from nabium, not from Zoom.** `migrations/007_meetings.sql`
says a meeting may point at the source its transcript became, and that source
arrives when nabium sends one. Zoom stays in the catalogue and has no grant
record: an unpublished Zoom app installs only on the developer's own account,
and a free account holds no cloud recording to read.

[KPA-143]: https://koinon.atlassian.net/browse/KPA-143
