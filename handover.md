# Handover

State as at 14 October 2026. `prompt.md` holds the instructions for a new
session. This file holds the facts.

**No story was built between 1 and 13 October.** `git log` shows no commit in
that span. What moved was the board, the workflow, and two stories closed by a
read.

**The Jira workflow changed on 3 October 2026.** In Review is gone. A shipped
story goes to **AI Review**, where a reviewer posts
`Review verdict: PASS (reviewer <agent>, builder <agent>)`, and then to **HIL
Review**, which only a person leaves. The `Decision required` status is gone
too. Every move goes through the `kothar:project-manager` agent, and the
transitions now differ by status, so no fixed table of ids holds. Read from
`/rest/api/3/project/KPA/statuses` on 13 October 2026: Backlog, To Do, In
Progress, AI Review, HIL Review, Done.

**KPA-143 is Done**, accepted by Shane by 13 October 2026.

**KPA-154 is Done**, moved by Shane on 14 October 2026. It was rechecked on
amaterasu on 13 October and two lines still named `kpa`: the header of
`/etc/sudoers.d/sukkal` and a section of `CLAUDE.md`. Both were fixed that day.
Comments 11777 and 11778 on the ticket carry the evidence. Epic KPA-152 is now
4 of 4.

**Shane approved model spend on KPA-12 and KPA-86 on 13 October 2026**, in a
comment on each: "I approve the use of AI models for testing and the costs
associated." `npm run decisions` counts both as rulings. Neither connection
exists yet, so each story still needs a key typed into the Connections screen.

**KPA-50 waits for the issue sync, by Shane's ruling of 14 October 2026:**
"Option C: wait for the issue sync". KPA-124 and KPA-105 now block it, proved
with `linkedIssues("KPA-50","is blocked by")`, which returns both.

**KPA-147 needs a deployment first.** Shane asked which DNS records it needs,
and comment 11780 answers: one proxied CNAME, `app.sukkal.app` to the tunnel,
which Cloudflare writes itself. amaterasu has no Node, no `cloudflared` and no
Sukkal service, checked on 14 October 2026, and no story deploys the web tier.

**CI was refused on 13 October 2026 and runs again since 14 October.** GitHub
would not start a job while the account's billing failed. Shane fixed it, and
the rerun of run 38361042663 passed in 1m44s.

## Shipped on 1 October 2026

**The review queue was emptied and then refilled by two shipped stories.** On
30 September 2026 Shane walked all 30 stories that sat In Review and accepted
every one. Each carries a comment saying what was verified and what read wrong.
*What the review found* below keeps the four things worth keeping.

**Then KPA-154 and KPA-143 shipped the same day**, built in parallel by two
agents with the integration pass run here. amaterasu is no longer called KPA, and
the reset link sends through Resend.

**KPA-158 followed on 1 October**, because KPA-143 broke on first contact with a
real person. On 13 October 2026 KPA-143 was Done, KPA-154 sat in HIL Review and
KPA-158 in AI Review.

**Nine stories shipped on 1 October: KPA-157, KPA-159 to KPA-165, and
KPA-108.** A connection can now be fixed and renamed in place, the worker
sweeps what has expired, the decision register carries every question and pairs
every ruling, the one flaky test is fixed, and a credential that expires,
lapses or fails the recheck reaches the briefing.

**KPA-108 was the epic's payoff and Shane ruled both of its decisions on
1 October**, in conversation, recorded on the ticket as decision blocks
carrying the whole reasoning. `needs_you` gained a fifth kind, `credential`,
rather than reusing `deadline`, because two of the three triggers carry no date
and could not deduplicate on `raised_for`. The expiry window is 14 days, as
`EXPIRY_WINDOW_DAYS` in `src/connections/needs-you.ts`, matching
`LIFETIME_DAYS`. Opening a card shows what the connection is and offers the one fix
its method allows: Reconnect on a grant, a new key on a key. A card whose method
takes a key may also be renamed. A grant method's card may not, because its name
is the account the provider reported and `connectionNamed` matches on it.

**The two dead Google connections were reconnected on 1 October 2026, and the
rows survived.** `shanevdolley@gmail.com` and `shane.dolley@collibra.com` kept
ids 1 and 3 and their `created_at` of 12 September, and their credentials now
read `issued_on` 1 October with the verification cleared, which is what
`setCredential` does to a key nobody has tried. Deleting and rebuilding would
have made two new rows. That is KPA-159 proved against the connections it was
raised for, rather than against a fixture.

**A real reset mail now sends.** On 1 October 2026 one went through the real
Resend API with the real send-only key to the owner's own address, using
`request()` exactly as `POST /api/reset` does. `from` read
`"Sukkal Resend" <no-reply@sukkal.app>` and the log line read "reset: a token was
issued and Resend accepted the link". That is the last link in the reset proved
against reality rather than against a stub.

## Where the work is

**Branch `main`, pushed, the working tree clean, and CI green.** This project
commits straight to `main`; `CLAUDE.md` says why and names the override the
hook wants. Read the head with `git log --oneline -1` rather than from here: a
commit hash written into a file is stale the moment the file is committed.
Read CI with `gh run list --limit 1`.

**[KPA-13](https://koinon.atlassian.net/browse/KPA-13),
[KPA-131](https://koinon.atlassian.net/browse/KPA-131) and
[KPA-74](https://koinon.atlassian.net/browse/KPA-74) shipped on
13 September 2026.** The migration agrees with the vault, a citation keeps its
words, and one TypeScript reader reads a note's frontmatter. *The migration is
proved* below says what all three mean.

**[KPA-107](https://koinon.atlassian.net/browse/KPA-107) shipped on
19 September 2026.** The worker rechecks every connection hourly, a failing card
is outlined in red, and the Connections item marks the set. *Where the OAuth work
stands* below says what it found.

**Thirty-two migration files, numbered to `033`.** KPA-108 added
`033_credential_needs_you.sql`. KPA-158 added
`032_connection_send_from.sql`, and KPA-143 added none, because the Resend key is
a credential like every other. KPA-157 and KPA-159 to KPA-165 added none,
because none of them writes a column.
Twenty-seven ADR files, numbered to `0025`, because `0007` and `0008` each hold
two. Both counts read again on 13 October 2026 and unchanged.

The suite runs **692 tests with the vault and 672 without it**, measured again
on 13 October 2026 against a local `sukkal_dev` dropped and recreated before
each run: 0 fail, 0 cancelled, 1 skipped in both. One skip is meant to be there.
The counts first reached these numbers on 1 October, after KPA-108.
KPA-159 added one test, KPA-162 three, KPA-160 one, KPA-161 four, KPA-157 three,
KPA-163 four, KPA-165 two and KPA-108 six, which is what moved both counts.

**The skip is in `test/migrate.test.ts:68`, not `test/connect.test.ts`**, which
this file named until 30 September and which holds no `skip` at all. The test is
`a connection to a remote host is encrypted`, and it skips on the hostname rather
than on a flag: `LOOPBACK` decides, so it skips against a local database and runs
against a remote one.

**Since KPA-154 it can run, and it does.** `DATABASE_URL_TEST` now names
amaterasu's `sukkal_dev`, so the suite pointed at the env file reaches a remote
host. `test/migrate.test.ts` ran 9 tests against it on 30 September 2026, all
passing and none skipped, which is the first time that assertion has been
exercised. Point the suite at a local database and it skips again, which is what
CI does and why CI reports one skip.

Read `# skipped N` as a summary and not as a count of skipped tests. Without the
vault, several suites skip and the summary still reports 1.

## The board

Project KPA on `koinon.atlassian.net`. **131 stories, 91 Done, which is 69% by
count.** Counted from Jira on 13 October 2026, two pages read to the end,
165 issues and every key unique. KPA-154 moved to Done on 14 October.

| Status | Stories |
|---|---|
| Done | 91 |
| AI Review | 10: KPA-108 and KPA-157 to KPA-165, all shipped on 1 October |
| HIL Review | 0 |
| In Progress | 1: KPA-103 |
| To Do | 29 |

**Read these counts by issue type.** The project holds 165 issues: 131 stories,
13 epics and 21 subtasks. A count of everything answers a different question, so
every number here names `issuetype = Story`.

**AI Review and HIL Review both mean shipped.** Every story in either reached
`main` with its checks green. AI Review waits on a reviewer's `Review verdict:
PASS` comment from an agent that did not build it. HIL Review waits on a person.
One epic, KPA-149, sits in AI Review too, which is why a count of everything
shows one more.

| Epic | Done/All | Title |
|---|---|---|
| KPA-1 | 19/20 | Slice one: migrate the memory |
| KPA-35 | 8/8 | Build the web interface |
| KPA-51 | 7/7 | Finish the memory schema |
| KPA-52 | 16/22 | Join the halves: replace every fixture |
| KPA-53 | 12/12 | Build the application data schema. The epic itself still reads To Do |
| KPA-54 | 6/13 | Connect the accounts |
| KPA-55 | 3/14 | Fill the stores |
| KPA-56 | 6/7 | The agent and the policy engine |
| KPA-57 | 0/7 | Retrieval and chat |
| KPA-75 | 6/7 | Let the installation authenticate its owner |
| KPA-145 | 2/8 | Harden what the installation exposes |
| KPA-149 | 2/2 | Become Sukkal. In AI Review itself |
| KPA-152 | 4/4 | Move the machine identifiers off KPA |

**Paging matters.** `/rest/api/3/search/jql` caps a page at 100 issues whatever
`maxResults` says, and answers with a `nextPageToken` rather than an error. An
unpaged query reads one page and reports it as the whole project. A handover on
3 September said "62 of 100 stories" for exactly that reason, and both numbers
were wrong.

## What the review found

All 30 stories that sat In Review were verified against the repository on
30 September 2026, then accepted. **No story was found broken and no shipped work
needed rework.** Four things came out of it that are worth keeping.

**1. Two sweeps were written and nothing ran them. KPA-157 fixed it on
1 October 2026.** `src/worker/sweep.ts` registers `expired.sweep`, daily at
04:15 and once at start-up, and runs both through `Promise.allSettled` so one
throwing cannot skip the other or fail the job. What follows is what the review
found, kept because it says why the grants mattered.

    src/auth/session.ts:216       sweepExpired   expired session rows
    src/connections/oauth.ts:580  sweepExpired   abandoned OAuth grants

Both are tested, and only their tests call them. `src/worker/index.ts` registers
deliveries, nightly and recheck, and `nightly.ts` imports `sweep` from
`src/memory/sweep.ts`, which reviews facts and is a different function.
`sukkal_local` still holds the two stale grants, measured again on
13 October 2026, because the sweep runs only inside the worker and no worker has
run on this Mac since 1 October. They were created on 13 and 19 September and
each expired ten minutes later. The
two successful grants run on 1 October left nothing behind, because claiming one
is a `DELETE ... RETURNING`. So the two that remain are abandoned rather than
ordinary, and each holds a PKCE verifier. An expired session is inert, because a
read refuses it. The verifier is why this is worth doing rather than noting.

**2. The issue cache has no caller.** KPA-98, KPA-99 and KPA-100 built `issues`,
`issue_blocks`, `sprints` and `issue_writes` across migrations 022, 027 and 028.
No file under `src/` or `apps/web/` names any of the four in a query, and all
four are empty. Only tests exercise them. Each story said so honestly, and
together they show the shape of the work left: three shipped stories of schema
waiting on KPA-124, which has not started.

**3. A comment defending a workaround outlived its reason, and that cost more
than the workaround.** `test/issues.test.ts` and `test/sprints.test.ts` each
reached `apps/web/lib/fixtures.ts` behind a variable specifier, and each
explained it by saying `apps/web/tsconfig.json` omits
`noUncheckedIndexedAccess`. It had not since 3 September, when KPA-141 turned it
on. KPA-141 converted one file of three. Both are plain static imports now.

**4. Only two claims in 30 stories were wrong when written.** KPA-77 said the
public-path allowlist holds seven paths; it holds eight and always did. KPA-151
said 250 lines and four gradients; the file is 284 lines and holds three
gradients plus a blur filter, and the shadow is the filter. Everything else that
read wrong read wrong because later work changed what it described, which is the
ordinary cost of a comment naming a number.

**What that suggests about comments.** The claims that aged badly were counts and
line numbers. The claims that held were names, constraints, formulas and the
reasons behind a decision. A comment that says why has outlived every comment
here that said how many.

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

**Production has not been loaded.** The script refuses `sukkal`, and the vault has
never been written to amaterasu.

**amaterasu answers, measured on 13 October 2026** over ssh and on port 5432,
after a reboot that day. Before deciding it is down, read the trap on the
terminal app's Local Network permission below: from a session inside Orca the
box looked dead while it was up. Nothing blocks the load but the decision to run
it. To load it: freeze the vault, run
`scripts/verify-migration.sh`, then load `sukkal` with the production guard lifted
on purpose.

The vault has not moved since the freeze, so that run costs nothing in
surprises. It is still at `da7afce`, with a clean working tree and no commits
since, checked on 13 October 2026, even though the launchd jobs that could write
to it have run since 13 September.

**A citation keeps its words, since KPA-131.** Every `derived_from` edge holds
its `sources:` entry verbatim in `edges.citation`, added by
`migrations/030_edge_citation.sql`. Measured by classifying all 33 entries in
the frozen vault: eight carry a wikilink with words around it. Seven name
`[[index]]`, which ADR-0019 counted, and the eighth names a real source, which
nobody had. Each still points where it did. `docs/schema.md` records the one
ceiling: `edges_unique` keeps one sentence when a fact cites a target twice.

The report did not move. `scripts/verify-migration.sh` gives the same two
explained orphans and the same 84 edges after KPA-131 as before it.

**One reader of a note's frontmatter, since KPA-74.** `src/checks/problems.ts`
carried a private copy of `check.py`'s reader so its report would match
`check.py`'s on any input, and it now reads through `parseNote`, as the load
does. The ruling ran against the ticket's own framing, and a measurement is why.

The copy hid the defect the verification exists to find. Given
`type: "reference"`, `check.py` and the copy both report a problem, so the
reports agree, while the load reads a valid `reference` and migrates it. After
the move that note is an `UNEXPLAINED` line. Proved on a one-note vault: one
unexplained line after, none before.

Nothing moved for the frozen vault. Sukkal's report from
`scripts/verify-migration.sh` is byte-identical to the first KPA-13 run, and
all fifteen ported `check.py` fixtures pass under either reader.
`scripts/count-vault.py` stays a separate Python reader, on purpose.

**The vault is unfrozen, since 13 September 2026.** A last
`scripts/verify-migration.sh` passed against `da7afce` first, then
`scripts/vault-freeze.sh restore` enabled and loaded all three launchd jobs.
They survived a reboot on 19 September. The script now fails at its first step
until the vault is frozen again, which is by design.

## Decisions

**No question waits.** `npm run decisions` reported 15 decided and 0 waiting on
14 October 2026. The last was
[KPA-50](https://koinon.atlassian.net/browse/KPA-50): asked on 13 October
whether to build the editor against fixtures now, Shane ruled on 14 October to
wait for the issue sync. The recommendation had been to build now.

**The story was not moved into a decision status, because none exists.** The
workflow change on 3 October removed `Decision required`. The autonomous skill
parks a story needing a person in HIL Review, through `kothar:project-manager`.
KPA-50 sat in To Do with the question on it. Filter 10047, the old decision
queue, answers 404 to the agent account, measured on 13 October 2026.

**[KPA-143] was decided and built on 30 September 2026.** How does a self-hosted
box send the reset link? The answer is Resend over HTTPS, with the API key held
as a sealed connection.

**Resend was not among the three options the question offered.** It won on the
same measurement that had chosen SMTP, because it needs no package at all: the
send is one `fetch` POST to `api.resend.com/emails`, so runtime dependencies stay
at two. The provider card also reuses the key method that OpenRouter, Voyage,
Claude and Linear already use, where an SMTP card needs a four-field shape for
host, port, username and password that no provider here has. Resend speaks SMTP
too, at `smtp.resend.com`, so nothing is foreclosed.

**The measurement that had chosen SMTP moved under it.** The original comment
measured nodemailer 9.1.1 at 617 KB. Version 10.0.12 unpacks to 1506 KB,
measured against the npm registry on 30 September. The `resend` package is
281 KB with two dependencies, and this ruling takes neither.

**The sender domain is `sukkal.app`**, registered on 30 September 2026 and
already on Cloudflare nameservers with no A record yet. Resend needs SPF and
DKIM on it before it delivers. The `.app` TLD is HSTS preloaded, confirmed
against `hstspreload.org`, so a browser refuses plain HTTP on it and KPA-147 now
has the HTTPS address it was waiting for.

**What was built.** A tenth provider in `apps/web/lib/providers.ts` reusing the
`apiKey` method, `deliver()` behind `mailSender` in `src/auth/reset.ts`, and a
probe in `src/connections/verify.ts` so the hourly recheck covers the key.
Fourteen mutations, each on a line that runs, each caught.

**`deliver` never throws, and that is the fourth criterion rather than a style
choice.** A refused key, a vendor that is down, sealed bytes that will not open,
and a credential removed between the two reads are each a log line. The route
logs it and answers `ASKED` on every path, exactly as before.

**A box with no Resend connection behaves as it always did.** `deliver` returns
`ok` on that path and logs the command line, so `ok` reads true rather than
false there. That is the second criterion, and reading it as a failure would
break it.

**Resend outranks Gmail and Outlook**, through
`ORDER BY (c.provider <> 'resend'), c.created_at, c.id`. Ranking by `created_at`
alone lets a box holding both pick the Gmail card, which cannot send: a Gmail or
Graph send needs the OAuth mail scopes KPA-103 and KPA-105 carry, and neither has
landed. Revisit when a second sender can actually send.

**The connection's `name` is the from address.** The dialog posts no extra field,
so rather than add a field, a route parameter and a column, the name carries it.
`recheck.ts` already compares `whoami` against `connection.name`, so a card is
already named after the account it acts as. The hint says to name it
`no-reply@sukkal.app` and `check-connections.ts` asserts the hint still says so.

**What is left before a reset mail actually arrives.** Three things, none of them
code. SPF and DKIM on `sukkal.app` in Cloudflare. A Resend API key typed into the
Connections screen, which never reaches a file or a transcript. And a card named
after the sending address.

**The card asks for a send-only key, and the refusal is what proves it works.**
Shane ruled on 30 September 2026: Sukkal calls one Resend endpoint ever,
`POST /emails`, which `sending_access` permits, so a key scoped to sending does
everything the product needs. The first version asked for `full_access` so the
probe could list the keys, which bought a health indicator with the blast radius
of the whole account.

A send-only key cannot list the keys, so `GET /api-keys` refuses it, and that
refusal is the proof: Resend answers 401 `restricted_api_key`, "This API key is
restricted to only send emails", and a key has to authenticate to earn that
sentence. `Probe.alive` in `src/connections/verify.ts` carries the status, the
name and what the verdict says, and `verify` reads the answer's `name` only for a
probe that sets it. The other four never read a body, because a body is one more
thing to fail on.

**The status has to match as well as the name, and this is the trap.** Resend
documents `restricted_api_key` twice: at 401 for a send-only key, and at 403 for
"API key is not active". Matching on the identifier alone would read a
deactivated key as live. Read
`https://resend.com/docs/api-reference/errors`, which was checked directly rather
than taken from the research that found it.

**A body that cannot be read leaves a refusal a refusal.** `named` returns null
for an empty body, a body that is not JSON, one holding no `name`, and one whose
`name` is not a string. That is the safe direction: the function can only ever
turn a dead credential into a live-looking one by returning a name, so it returns
one only when it read one. Four mutations prove each half, and the one that
ignores the status is caught by the 403 test.

**What Resend answers for a key that was deleted is undocumented**, so it is
treated as dead. The errors page carries no entry for an invalid, deleted or
never-issued key.

**The key is in, and the real API agrees.** The hourly recheck ran against it on
1 October 2026 and wrote `verified_ok = t` with
"api.resend.com holds a live send-only key, which is all Sukkal needs". A
least-privilege key reads as healthy, which is the whole point of reading the
refusal.

## The address is its own field, since KPA-158

**KPA-143 made the connection's name do two jobs and it broke on first use.**
Shane added the Resend card and named it "Sukkal Resend", because the Name box's
placeholder read `BHP Resend` and its help text read "What tells this account
from the next one on the same provider", while the method's hint said to use the
sending address. He followed the nearer instruction, which is the right thing to
do when a form contradicts itself. A send would have put "Sukkal Resend" in
`from` and Resend would have refused it, silently, because `deliver` never
throws.

**So the address has `connections.send_from`**, added by
`migrations/032_connection_send_from.sql`, nullable, with a check that it is
shaped like an address. Nullable and unbackfilled on purpose: `sukkal_local`
already held a Resend row with no address, so a constraining migration would have
failed on real data, and writing `no-reply@sukkal.app` into a migration would
bake one installation's domain into the schema.

**The route is the boundary**, not the browser.
`apps/web/app/(app)/api/connections/route.ts` refuses a non-string address, one
that is not an email, and an empty one on a provider that sends. `needsSendFrom`
reads that rule off the catalogue, so the handler names no provider and a second
sender gains the rule with the field.

**The name is public now and the form says so.** It appears beside the address
in the mail recipients read: `Sukkal Resend <no-reply@sukkal.app>`.

**`fromHeader` checks the raw name, not the trimmed one, and the order is the
point.** `trim` removes a leading separator, so checking afterwards dropped the
separator and kept the rest of what was crafted: a name of CRLF then
`Bcc: them@example.com` became that text, quoted, as a display name. Nothing
unsafe reached the header, because a quoted string injects nothing, and the
residue still contradicted the function's own promise that nothing crafted
survives.

**`CONTROL` names `Zl` and `Zp` beside `Cc`, and that is tidiness rather than
safety.** Keep the distinction straight. A header ends at CR or LF, which are
`Cc`, so `Cc` alone closes header injection. U+2028 and U+2029 encode as three
UTF-8 bytes that are neither and could never end a header. They are line
separators to other readers though, including a JavaScript parser, so a display
name is no place for them.

Both were found by throwing 24 hostile names at the function rather than by
reading it, after it was written and its own tests passed. Both are
mutation-tested: reverting either fails the same named test.

**A missing address and a missing name are different.** No address means nothing
can go in `from`, so `deliver` logs and returns `ok: false` before it opens the
key. No usable name means the mail sends from the bare address and returns
`ok: true`.

**Both gaps are closed, and two counts in this file were wrong.**
[KPA-160](https://koinon.atlassian.net/browse/KPA-160) added `send_from` to
`listConnections`, so the detail dialog reads the sending address back. The read
now answers **twelve** fields, not eleven: `SEEN` in
`apps/web/scripts/check-connections.ts` and in `test/connections-read.test.ts`
held eleven names under a comment saying "ten", and KPA-160 added the twelfth
while carrying the off-by-one forward to "eleven". Counted from the arrays on
1 October 2026 and corrected in both.

[KPA-161](https://koinon.atlassian.net/browse/KPA-161) closed the log. This file
said three log lines interpolate the name raw. The true count was **four**. All
four now route through `forLog` in `src/auth/reset.ts`, which replaces each
control character, line separator and paragraph separator with a space, using
`CONTROL.source` so its set can never drift from the header's. A space rather
than a drop, because the name is the only thing in the line that says which card
it is about.

## The sending domain is set up and verified

`sukkal.app` was registered on 30 September 2026 and verified in Resend on
1 October. Read from public DNS rather than from the dashboard:

| Record | Name | Value |
|---|---|---|
| DKIM | `resend._domainkey.sukkal.app` | `p=MIGfMA0GCSqGSIb3...` |
| SPF | `send.sukkal.app` | `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36 ip4:199.249.231.0/24 ~all` |
| Return path | `send.sukkal.app` | CNAME to `send.forge.rmta.net`, MX `feedback.forge.rmta.net` |
| DMARC | `_dmarc.sukkal.app` | `v=DMARC1; p=none; rua=mailto:...@dmarc-reports.cloudflare.net` |

**The DKIM key is at the root, so the sending domain is `sukkal.app`** and
`no-reply@sukkal.app` is the right address. `send.sukkal.app` is the return path
Resend adds for SPF alignment, not a second sending domain, and it needs no DMARC
record of its own: DMARC applies to the domain in the From header.

**DMARC reports go to Cloudflare, not to a mailbox.** Cloudflare DMARC
Management is free on every plan, hosts the `rua` address, and parses the XML
into sending sources and pass counts. Pointing `rua` at a person's mailbox
delivers raw gzipped XML nobody reads. Cloudflare's own docs never publish the
address pattern, so the live record is better evidence than the documentation.

**Three things about it worth not rediscovering.** It is apex-only. Its SPF
*editing* feature does not work on this zone, because that is unsupported when a
CNAME points to an external domain and `send.sukkal.app` is exactly that, which
costs nothing because Resend owns that record. And the first report can take 24
hours, with 30 days of graph.

**The SPF record costs zero DNS lookups**, three `ip4` mechanisms and nothing
else, against a limit of ten. **`p=none` is the thing to come back to.** Leave it
a week or two, read what Cloudflare shows, then tighten to `quarantine` and later
`reject`. Going straight to `reject` on a domain that has never sent risks
binning the first real mail.

**The reset link still points at `http://localhost:3000`**, because `SUKKAL_URL`
says so and the root of `sukkal.app` carries no A record. That is fine for one
laptop. KPA-147 is the story that changes it, and the `.app` TLD is HSTS
preloaded, so it will have to be HTTPS.

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

**Three Google connections in `sukkal_local`, all re-granted, and only one
checked since.** Read from `connection_credentials` on 13 October 2026:

| Account | Last check |
|---|---|
| `shane@koinon.com.au` | Verified OK on 1 October. Re-granted by Shane on 19 September |
| `shanevdolley@gmail.com` | Reconnected on 1 October. Never checked since, so unknown |
| `shane.dolley@collibra.com` | Reconnected on 1 October. Never checked since, so unknown |

No recheck has run since 1 October, because the recheck lives in the worker and
nothing starts the worker on this Mac. Start `npm run worker` against
`sukkal_local` to learn whether the two reconnected grants survived.

The rest of this section is the record from 19 September to 1 October.

**The seven-day limit was the suspected cause, and it does not explain this.**
Both dead tokens were issued on 12 September and failed seven days later, which
fitted Google's rule that a refresh token expires after seven days for a client
whose consent screen is in Testing. The prediction was that the Koinon token
would die on 26 September.

**It did not. It still worked on 30 September, eleven days after its grant.**
Measured by running the worker once against `sukkal_local`: it rechecked all
three connections at 11:09 and wrote three rows. `shane@koinon.com.au` verified
OK. The other two still answer `invalid_grant`. The worker had last run on
25 September, so the token also survived five days with nobody using it.

**Since KPA-159 the two dead cards can be fixed without losing them.** Open
either one on `/connections` and press Reconnect. It starts a grant for that
provider, and the callback's `connectionNamed` plus `setCredential` replace the
credential in place. Proved against the real route over HTTP on 1 October 2026,
on a throwaway row in `sukkal_local`: two PATCH calls, the id and `created_at`
unchanged across both, one credential row rather than two, and the sealed bytes
different each time. The row was removed afterwards and Shane's four
connections were untouched.

**Signing in as a different account still makes a second connection.** The match
is on the account the provider reports, not on the card that was opened, so the
dialog says so in as many words.

So something else killed the two from 12 September, and the seven-day rule is not
it. Reading the publishing status in Google Cloud project
`personal-assistant-506014`, under APIs & Services, OAuth consent screen, is
still the cheapest next step, and it is now a question about the two dead tokens
rather than a countdown on the live one.

**KPA-103 has one criterion left, and it is closer than it looks.** "Three
accounts produce three distinct connections" was proved on 19 September: a second
grant of the Koinon account kept row 2, its id and its `created_at`, and replaced
its credential. "A refresh runs before expiry and rewrites the date" now has its
evidence: the 30 September recheck renewed the Koinon grant and wrote
`verified_at`. What is missing is a run that spans an expiry deliberately rather
than by accident.

**KPA-107 rechecks every connection hourly.** `src/connections/recheck.ts` renews
a Google grant and asks `whoami` whose token came back. It runs a free key probe
for a key connection, and skips a metered one. It writes `verified_ok`,
`verified_at`, `verified_on` and `verdict`, and never removes a connection.
`docs/runbooks/worker.md` says how to read it.

**The screen shows it.** A failing card, meaning a dead check or no credential,
has a 2px red ring, an error icon and the verdict. The Connections item shows a
green dot when every connection works, a yellow warning when some fail, and a
red error when all fail. An unchecked connection is unknown, not failing. Seen in
Chrome in all three states and on the collapsed rail, with the rows set by hand
and then restored. `apps/web/lib/connection-health.ts` holds the one rule both
read.

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
twenty-five scripts under plain node, counted on 13 October 2026.

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
| `sukkal` on amaterasu | The migration. Production. Eleven migrations behind |
| `sukkal_dev` on amaterasu | Every test that points at the env file |
| `sukkal_dev` on this Mac | Every test that points at loopback, which is what CI does |
| `sukkal_local` | The running application. No test names it. 32 migrations, all of them, on 13 October 2026, and it holds the live Resend card |
| `sukkal_verify` | `scripts/verify-migration.sh`, which drops and recreates it on every run |

**Two different databases are called `sukkal_dev`, one per host.** KPA-154 renamed
amaterasu's `kpa_dev` on 30 September 2026, and the Mac's was already called that.
Nothing breaks, because a connection names a host as well as a database, and
`refuseProduction` asks the server which database it reached rather than reading
the string. Know which one a command reaches before you read its result: the env
file means amaterasu, and an explicit `DATABASE_URL_TEST` naming `localhost` means
the Mac.

**One name means production now.** `PRODUCTION` in `src/db/connect.ts` holds
`sukkal` alone since KPA-154. The migration runner refuses it, and every test calls
`refuseProduction` after it connects.

Watched rather than assumed, on 30 September 2026:

```
npm run migrate      -> up: sukkal, read from DATABASE_URL
                        refusing to migrate "sukkal": it holds the facts.
DATABASE_URL_TEST    -> sukkal_dev as sukkal, ssl=true -> allowed
DATABASE_URL         -> sukkal     as sukkal, ssl=true -> REFUSED
```

`sukkal_local` exists because the suite ends on `down()`. On 10 September 2026 a
test run destroyed three Google OAuth connections that had taken three consent
screens to create, and the tokens survived at Google where nothing could reach
them to revoke. Start the dev server like this:

```
cd apps/web && DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_local" npm run dev
```

**Production `sukkal` holds 21 migrations and stops at `022_issue_cache.sql`.**
023 through 033 are pending, so production is eleven behind. Read again on
13 October 2026: 21 rows, `001_core_schema.sql` to `022_issue_cache.sql`. First read from
`schema_migrations` on amaterasu on 30 September 2026, before the rename and again
after it. There is no `002` in either place, which is why 21 rows reach 022.

This corrects the earlier note, which said 001 to 024 and five behind. Both
numbers were wrong: production never held 023 or 024, and the repository has
gained 030 and 031 since. KPA-154's own acceptance criteria repeat the wrong
figure, and the ticket carries a comment saying so.

It was migrated by accident on 3 September 2026 and Shane chose to leave it. The
command names the database before it acts and refuses `sukkal` outright;
`SUKKAL_ALLOW_PRODUCTION=1 npm run migrate` migrates it deliberately.

## Environment

`~/.config/sukkal/env`, mode 0600, outside the repository.
`docs/runbooks/secrets.md` says what each value is for.

| Variable | For |
|---|---|
| `DATABASE_URL` | Production `sukkal` on amaterasu. The migration reads this and nothing else |
| `DATABASE_URL_TEST` | `sukkal_dev` on amaterasu. Override it with a local URL for a fast run |
| `SUKKAL_SECRET_KEY` | Seals every connection credential |
| `GOOGLE_OAUTH_CLIENT_ID` | Identifies Sukkal to Google |
| `GOOGLE_OAUTH_CLIENT_SECRET` | The callback exchanges a code with it |
| `SUKKAL_URL` | Where this installation answers. `http://localhost:3000` today |

Six variables, not eight. `VOYAGE_API_KEY` and `VOYAGE_PROJECT_ID` were removed on
30 September 2026: no code had read either since KPA-104 moved the vendor key into
a connection. A backup of the file before that sits at
`~/.config/sukkal/env.bak-20260930`. A second backup, taken before KPA-154
rewrote the two database URLs, sits at `~/.config/sukkal/env.bak-kpa-154`. Both
are mode 0600.

`scripts/decision-register.ts` reads three more variables, and this file holds
none of them. `KOINON_JIRA_SITE` and `KOINON_JIRA_EMAIL` live in
`~/.config/secrets.env`, which `~/.zshenv` sources. `KOINON_JIRA_TOKEN` no
longer does: measured on 13 October 2026, the token moved to the Keychain item
`kothar-jira-agent`, which belongs to the Claude Agent account. So
`npm run decisions` fails until the token is supplied, and *Traps* says how.
`docs/runbooks/secrets.md` says why these sit in a different file.

**One OAuth client serves Sukkal and workspace-mcp**, in Google Cloud project
`personal-assistant-506014`. Google holds exactly two redirect URIs, and both
are needed:

```
http://localhost:8000/oauth2callback     workspace-mcp. No slash before callback
http://localhost:3000/oauth2/callback    Sukkal. With the slash
```

## Traps

**A box that answers can look dead from inside the wrong terminal app.** On
13 October 2026 a session inside Orca got `No route to host` from every LAN
address except the router, `192.168.20.1`, while amaterasu was up. The same
commands from a session in cmux reached it at once. macOS grants Local Network
access to the GUI app at the top of the process chain, so `ssh`, `ping`, `psql`
and `node` all inherit that app's setting. It cost an hour and a false report
that the box was down. Before calling amaterasu down, ping another LAN host such
as `192.168.20.10`: if only the router answers, the cause is the permission.

**`npm run decisions` fails without `KOINON_JIRA_TOKEN`, and the token is no
longer in the environment.** It answers `KOINON_JIRA_SITE, KOINON_JIRA_EMAIL and
KOINON_JIRA_TOKEN must be set`. Supply the agent account's token and its email
together, because the token and the email must name the same account:

```
KOINON_JIRA_EMAIL=claude@koinon.com.au KOINON_JIRA_TOKEN="$(security find-generic-password -s kothar-jira-agent -w)" npm run decisions
```

Found on 13 October 2026. The lasting fix is a fallback to the Keychain inside
`scripts/decision-register.ts`, and no story carries it yet.

**A CI run that fails in three seconds tested nothing.** GitHub refuses to start
a job when the account's billing fails, and the run reads as red like any other.
Run `gh run view <id>` and read the annotation. Found on 13 October 2026, run
38357016519.

**The ticket guard refuses a `kj` path built from a variable.** A loop writing
`"/rest/api/3/issue/KPA-$k?fields=..."` was denied. Write each path as a
single-quoted literal, one call per issue. Cost two calls on 13 October 2026.

`CLAUDE.md` carries the traps this repository has paid for more than once:
`noclobber` on `>`, a test run piped into `tail` reporting the wrong exit code,
`--test-concurrency=1` on a bare `node --test`, and the stale
`apps/web/.next/dev/types` that fails a build after a page is removed. What
follows is new, and each cost time between 9 September and 1 October 2026.

**Two decisions on one ticket register as one.**
`scripts/decision-register.ts` writes `question = questionIn(body) ?? question`
while walking a ticket's comments, so a later `DECISION NEEDED` panel overwrites
an earlier one, and the same line does the same to the recommendation.
`docs/decisions.md` then shows the last question only. Measured on
1 October 2026 on KPA-108, which carries two: `npm run decisions` reported
"10 decided, 1 waiting" and the file held only the expiry window, not the fifth
kind. Both questions are on the ticket itself.
[KPA-163](https://koinon.atlassian.net/browse/KPA-163) fixed it the same day.
The register now writes one row per question, and
`npm run decisions` counts questions rather than issues: it reads
"10 questions decided, 2 questions waiting".

**A ruling names its question by restating it, since KPA-165.** A ruling
comment repeats the question verbatim in its own `DECISION NEEDED` panel and
then carries the decision block. `entriesForIssue` matches that text against the
open entries and pairs the ruling with it, whatever else is open. That is the
convention Shane's two KPA-108 rulings follow and the only link the data
supports. **Posting the first two rulings is what found the gap**: before
KPA-165 the register answered "12 questions decided, 4 waiting" with six KPA-108
rows, and four of those read as waiting while every one was answered. It now
reads two rows, both decided.

**A ruling that names no question still cannot be paired, and the register
still does not guess.** A `decisionItem` carries no fixed reference. KPA-80's ruling
comment has a `parentId` naming its question comment and KPA-96's has none, on
the same one-question shape, and `/rest/api/3/search/jql` with
`fields: ['comment']`, which the script calls, drops `parentId` altogether while
`/rest/api/3/issue/<key>/comment` returns it. All three checked on
1 October 2026. So a ticket with one open question pairs, and a ticket with two
records the ruling on its own row saying which question it answers is not
recorded. **Restate the question when a ticket carries two.** A ruling that names none,
on a ticket with two open, is still recorded on a row of its own saying so.

**A credential item closes only when the credential is healthy on both counts,
and that is not a flicker.** The KPA-108 agent flagged a suspected one-cycle
flicker: an item closing while the expiry is still inside the window. It cannot
happen. The close statement in `src/connections/needs-you.ts` requires
`verified_ok IS TRUE` **and** the expiry outside the window, so a healthy
connection with a near expiry is never closed. Proved on 1 October 2026 by
running `reconcileCredentialItems` three times against a connection with
`verified_ok` true and an expiry ten days out: the item stayed open on all
three. Do not re-investigate this.

**`schedules the nightly review at 03:30 Sydney` was flaky and KPA-164 fixed it
on 1 October 2026. The cause is worth knowing, because the shape repeats.** The
test polled for the review's own effect, a `needs_you` row, and then read
`pgboss.job` once. Those are two effects of one handler in that order:
`nightly.ts` writes the row inside `sweep()` and then still runs
`problems(vault)` and `advisories(client)` before it returns, and pg-boss marks
a job completed only once the handler returns. The single read could land in
that gap.

**It was proved by widening the race rather than by watching it.** Dropping the
`needs_you` poll interval from 250ms to 1ms makes the original code fail 5 runs
of 5, and the fixed code pass 5 of 5 under the identical change. Ten ordinary
runs of the fixed file were clean, and the agent that built it ran twenty.

**The rule it leaves:** when a test polls for one effect of a handler and then
asserts a second, poll for the second too. Asserting it once assumes an order
the handler does not promise.

**Port 3000 is often already held, and `next dev` refuses rather than sharing
it.** On 1 October 2026 a dev server was already running there, started outside
this session, against `sukkal_local`. A second `npm run dev` took port 3001,
printed "Another next dev server is already running", and exited 1. Turbopack
watches the files, so the server already running serves your edits: use it
rather than stopping it. A server you did not start belongs to somebody else.

**To see a screen you need a session, and minting one beats setting a
password.** `scripts/reset-password.sh` changes the owner's real password, which
is Shane's. Instead insert a row in `sessions`: the id is the SHA-256 of a token
you make, which `fingerprint` in `src/auth/session.ts:87` computes, and the
cookie is `__Host-sukkal_session`. Chrome accepts a `Secure` cookie on
`http://localhost`. Delete the row when you are done.

**`psql -tAc` on an `INSERT ... RETURNING` prints the command tag as well.** The
output is the id, then `INSERT 0 1`, so a variable capturing it holds both and
the next statement fails on a syntax error naming `INSERT`. Pipe through
`head -1`. Cost one cycle on 1 October 2026.

**`connect()` returns an unconnected client, and forgetting that looks exactly
like amaterasu being down.** It is not `async`: it hands back a `pg.Client` and
never calls `.connect()`. A query on that client queues forever, so the process
exits with "unsettled top-level await" after 25 seconds of nothing, which reads
as the documented hang. On 30 September 2026 that was reported as the box being
unreachable when `psql` had opened the same database a minute earlier. Call
`await client.connect()` first.

**A grep over server markup proves nothing about a client-rendered screen.** The
Connections screen receives its provider catalogue and its rows through
JavaScript, so fetching `/connections` and searching the HTML finds neither. On
1 October 2026 that reported nine of ten providers missing and all three Google
connections absent, all of them present. Read `/api/connections` for the rows and
the `/_next/static/*.js` chunks for the catalogue, or render it headlessly.

**The Write tool turns ` ` in a regex literal into a real line separator**,
which breaks the file that holds it. The same happens to `\u0085`. Build a
separator from `String.fromCharCode` instead, which is why `test/reset.test.ts`
spells them that way.

**A shell heredoc mangles backslash escapes in a regex passed to `node -e`.**
Two attempts at an inline probe died on `Invalid regular expression` before the
code moved into a file. Write the probe with the Write tool and run the file.

**`scripts/provision-amaterasu.sh` rotates production's password every run.** It
generates a fresh 32 characters, applies them with an unguarded `ALTER ROLE`, and
rewrites both URLs in `~/.config/sukkal/env`. It is self-consistent, so nothing
breaks, and it is not a way to test idempotency. KPA-154's criterion about the
`pg_hba` block was proved from the `grep -q '^# SUKKAL'` guard and the box's
single marker line instead.

**Resend documents `restricted_api_key` twice, with two meanings.** 401 is
"restricted to only send emails" and means the key authenticated. 403 is "API key
is not active" and means it did not. Anything matching on the identifier alone
reads a deactivated key as live.

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

**zsh does not split an unquoted variable into words.** `for k in $keys` over
a newline-separated list runs once, with every key in one string, so a loop of
Jira calls on 13 September 2026 read nothing and reported an empty result as if
it were the answer. Pipe the list into `while read -r k`. A separate loop over
`/search/jql` with `-G` and a page token ran past two minutes and was stopped;
the To Do stories fit on one page, so read each story from `/issue/<key>`
instead.

**The worker is what makes the recheck run, and nothing starts it on this Mac.**
Start it against the app's database, because `npm run worker` reads
`DATABASE_URL` and the env file names production there:

```
DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_local" npm run worker
```

The env file does not override a variable already set, which is what keeps
production out of reach. A reboot stops it.

**A reboot empties the scratchpad under `/private/tmp`.** A start script kept
there was gone after Shane rebooted on 19 September 2026. The dev server needs
the Google client from `~/.config/sukkal/env` as well as `sukkal_local`:

```
set -a; . ~/.config/sukkal/env; set +a
export DATABASE_URL="postgresql://$(whoami)@localhost:5432/sukkal_local"
cd apps/web && npm run dev
```

**The dev server logs Google's one-time code.** `next dev` prints the whole
callback URL, code included, to its log. The code is spent the moment the
callback exchanges it, so the risk is small, and the log lives only as long as
the process writes it. Found on 19 September 2026.

**A sign-in from before 13 September no longer works.** KPA-156 renamed the
cookie to `__Host-sukkal_session`, and the browser still holds the old one, so
Shane had to sign in again on 19 September. The session rows were still valid;
nothing reads their old cookie name.

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
[KPA-157]: https://koinon.atlassian.net/browse/KPA-157
