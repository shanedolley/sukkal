# Koinon Personal Assistant: project brief

**Status:** draft, in active discovery. Sections marked *Open* hold questions
not yet answered.

**Jira project:** KPA, `koinon.atlassian.net`. Empty as of 23 August 2026. It
becomes the source of work once this brief settles.

**Last updated:** 1 September 2026, for the interface built under KPA-35

---

## What we are building

A hosted web application that acts as Shane Dolley's personal assistant. It runs
on a machine he owns, connects to every mailbox and chat account he uses, ingests
meeting transcripts from nabium, and maintains a memory that learns and corrects
itself.

He works with it daily. That is the test the product has to pass: not whether it
demonstrates well, but whether he opens it every morning by choice.

**It also ships to other people.** Somebody else runs it on a server of their
own, or in a container, and it belongs to them from the first boot. One
installation still serves one owner: the change is which owner, not how many.
That decision is what took identity out of Cloudflare Access and into the
application. ADR-0009.

## The problem

Shane works across two organisations with a hard wall between them. Collibra
employs him and its customer material is confidential. Koinon Engineering is his
own company with its own clients and commercial figures. A third stream is
personal. Today the context for all three lives in his head, in three mailboxes,
in meeting recordings nobody rewatches, and in a small markdown vault.

Three failures follow.

**Context evaporates.** A decision made in a meeting in March is unavailable in
August unless he happens to remember it. The recording exists and nobody will
watch it again.

**Recall costs attention.** Finding what a customer agreed to means searching
three mailboxes by hand, and searching well enough to trust the answer takes
longer than the answer is worth.

**Facts rot silently.** A contact leaves, a contract term changes, a system gets
retired. Nothing announces it, so stale knowledge is indistinguishable from
current knowledge until it causes a mistake in front of a customer.

## What it does

Five jobs. The first four were confirmed on 23 August 2026. The fifth arrived
through the interface, which is recorded under *Running the work* below.

**Triage and draft mail.** File by customer and project across every account,
flag what needs a human, draft replies in Shane's voice ready to edit and send.

**Turn meetings into memory.** Take nabium's transcripts, extract decisions,
commitments and action items, attach them to the right customer and engagement,
and surface what was agreed.

**Answer from everything at once.** One question, searched across three
mailboxes, every transcript and the whole fact graph, answered with citations
that open.

**Chase and remind.** Track what Shane owes people and what people owe him,
notice when a promised reply never came, and prompt before a deadline lands
rather than after.

**Run the work.** Hold the workspaces, projects, sprints and issues Shane
delivers against, across both Jira sites, and let him work them from here rather
than from two browser tabs.

### Running the work

The fifth job was not in the brief on 23 August 2026. It arrived between
27 August and 1 September, when the interface grew a project and issue tracker
beside the assistant. This section records it, because the code shipped ahead of
the brief and the brief is meant to lead.

**What the interface now carries.** A workspace and project tree in the
navigation. A sprint view. An issue board with grouping, filtering, ordering,
inline editing, a bulk bar and a create dialog. An issue detail page. A
connections screen for every external account. Per-workspace custom fields, and
per-project labels and contract dates.

**Why it belongs here.** The assistant chases what Shane owes people. Most of
what he owes people is issues on two Jira boards. An assistant that reports on
work it cannot see reports on half his day.

**What it costs.** Three decisions already carry the weight, and each is an ADR.
The tracker owns the issue text and KPA caches it, so no second master exists.
The editor is TipTap, because ProseMirror sits one rename from Jira's ADF. The
cache refreshes by polling on a schedule and pushes to the browser over SSE,
because Jira refuses a webhook to an API token.

**Two halves, one seam.** The assistant half and the tracker half share almost
nothing. No issue points at a fact, and no fact points at an issue. They meet in
two places only: the space filter cuts both, and the sidebar renders the memory's
counts beside the tracker's navigation. That split runs all the way down to the
data, and *Two stores, not one* under *Architecture* says what it means.

**One integration this adds.** The project screens read contract dates and
booked hours from Salesforce, where Certinia PSA holds them. The catalogue lists
no Salesforce card yet, so two screens depend on a system the application cannot
reach. *Every connection the product offers* under *Accounts* puts it in scope
with the other eight.

### The screen he opens

A briefing dashboard, generated. What happened overnight, what needs him, what
is decaying, what the system proposes. Chat sits one click away for digging in.

```
┌─ Tuesday 25 Aug ────────────────┐
│ Needs you (3)                   │
│  • BHP Meridian: retention Q    │
│  • Maybank SOW unsigned         │
│ Proposed facts (4)   [y][n]     │
│ Meetings today (2)              │
│ Stale facts (2)                 │
└─────────────────────────────────┘
```

### How much it does alone

Autonomous within policy. It acts on its own inside rules Shane sets, logs
everything, and he audits after the fact.

This is a deliberate departure from the markdown system, whose governing
principle is that the default is to write nothing. Two consequences follow and
the design has to carry them.

The policy layer becomes load bearing. It is the only thing standing between an
autonomous agent and Shane's sent-mail folder, so it needs to be explicit,
inspectable and testable rather than a set of prompt instructions.

The audit log becomes the safety net. If nobody approves an action beforehand,
the record of what happened has to be good enough to catch a mistake afterwards,
and it has to be somewhere Shane actually looks.

### The policy

Four rules, and the first two are absolute.

**It never sends mail unprompted.** It may draft anything and queue it. A
message leaves the box only after Shane clicks. This is the highest blast radius
action available to it and the hardest to walk back.

**It never deletes or destructively edits.** No deleting mail, no deleting facts,
no overwriting history. It retires and supersedes instead, so anything wrong
stays recoverable.

**It never marks its own facts verified.** The markdown system's rule carries
forward. It writes facts autonomously, and everything it asserts stays on the
review queue until Shane confirms it. The queue is work, and that work is what
keeps the memory trustworthy.

**It keeps Collibra and Koinon apart as a guideline.** Retrieval filters by space
by default and the system flags any answer drawing across the two, but nothing in
the database prevents it. See *Risks accepted*.

## Accounts

Three Google Workspace accounts, all already authorised through the `google` MCP
server, `workspace-mcp`, at user scope. Gmail, Calendar and Drive on each. The
OAuth client lives in Google Cloud project `personal-assistant-506014`, owned by
the Koinon account, with refresh tokens in `~/.google_workspace_mcp/credentials`.

| Account | Serves | Note |
|---|---|---|
| `shane@koinon.com.au` | Koinon Engineering | Also receives mail sent to `shane@thekoinon.com` |
| `shane.dolley@collibra.com` | Collibra | Authorised 20 August 2026 with no admin block. The tenant can revoke it. |
| `shanevdolley@gmail.com` | Personal | |

The OAuth work is done and KPA inherits it rather than repeating it. The Collibra
grant is the fragile one: it exists because nobody blocked it, not because
anybody approved it.

**Initial ingestion reaches back six months.**

### Scope per service

| Service | Access | Notes |
|---|---|---|
| Gmail | Read and draft | Drafts queue for Shane. Sending is never automatic. |
| Calendar | Read and write | It links meetings to engagements, spots conflicts, holds time, and can accept invitations. |
| Drive | Read and write | It creates, edits and reorganises documents on direction. It never deletes. Google's own revision history is the recovery mechanism, which is what keeps the destructive-edit rule intact. |

### Every connection the product offers

Nine providers, and all nine are in scope. Seven sit in the catalogue at
`apps/web/lib/providers.ts` today. Two are missing, and two screens already
depend on one of them.

| Provider | How it signs in | What it serves | State |
|---|---|---|---|
| Google | OAuth | Gmail, Calendar, Meet, Drive, Keep | In the catalogue. Three accounts already authorised |
| Microsoft | OAuth | Outlook, Teams, To Do, SharePoint, OneDrive | In the catalogue. See the note below |
| Zoom | OAuth | Meetings, recordings, transcripts | In the catalogue |
| Jira | OAuth 3LO, or a site with an email and an API token | Issues, sprints and boards, one site per connection | In the catalogue. Two sites |
| Linear | OAuth, or an API key | Issues and cycles | In the catalogue. No screen reads it yet |
| OpenRouter | API key | The metered inference path | In the catalogue |
| Claude | Subscription, or an API key | The subscription inference path | In the catalogue |
| Salesforce | OAuth | Contract dates, a project search, and Certinia PSA | Missing. Two screens depend on it |
| Voyage AI | API key | Embeddings, `voyage-4` at 1024 | Missing. The decisions name it and the screen does not offer it |

**Certinia PSA needs no connection of its own.** It is a managed package inside
Salesforce, which is why every object it owns carries the `pse__` prefix. One
Salesforce grant reaches `pse__Proj__c`, `pse__Assignment__c` and
`pse__Scheduled_Hours__c` alike.

**Nabium is not a connection.** It reaches KPA through a read-only database role
and a push over the LAN, which *Decisions settled* records. No screen configures
it, and none should.

**Microsoft reopens a settled decision.** *Microsoft, Teams and customer
tenants* below says Graph access to a customer tenant is unobtainable and that
KPA will not pursue it. The connections screen offers Microsoft anyway. Either
the card serves a tenant Shane owns rather than a customer's, or the decision
changes. *Open.*

**No credential reaches the browser.** The screen collects one and the server
holds it. Today the screen collects one and drops it, which is honest about
storing nothing and useless for connecting.

**Every credential expires, so the store holds the date.** An OAuth grant
carries a refresh token the provider revokes at will, and an API key carries a
term the vendor sets. Atlassian now issues API tokens with an expiry, so the
Jira card's claim that "a token is a password that never expires" is wrong and
the copy needs correcting. Each credential row therefore holds five things
beside the secret: the provider, the date it was issued, the date it expires,
the date it was last verified, and what that verification said.

**An expiring credential is a Needs you item.** The product already owns the
right place to put it. A grant that lapses next week belongs on the briefing,
beside everything else waiting on Shane, rather than on a settings screen he
opens twice a year. A credential that has already lapsed belongs there too, and
so does every job that failed because of it.

**An unknown expiry is a date the product goes and finds.** Where a vendor
publishes one, the verification reads it. Where no vendor publishes one, the
row holds the term the owner typed, because a credential nobody can date is a
credential nobody renews.

### Microsoft, Teams and customer tenants

The stated goal names Outlook and Teams. All three mailboxes are Google, so the
Microsoft surface is customer tenants where Shane is a guest: BHP, TfNSW, Sydney
Water and others.

**Graph access to those tenants is not obtainable and KPA will not pursue it.** A
third-party application reading Teams messages needs an application registration
and admin consent inside the resource tenant. A guest user cannot self-consent,
and enterprises of that size block third-party consent by default. Asking is a
conversation with a customer's IT department that ends in a refusal.

Nabium already solves this without asking anyone. It captures meetings from the
desktop on any platform, because it records what Shane can already see and hear,
and ADR-0003 extends the same approach to Teams messages. **All customer-tenant
material reaches KPA through nabium.**

## Prior art: the markdown system

A working system already exists across two repositories, and it earned its design
through use. The new product inherits its principles rather than replacing them.

`~/Development/personal/personal-assistant` holds the machinery: a journal
rendered from Claude Code transcripts, three scheduled jobs under launchd, Gmail
filter rules, and the reports those jobs produce.

`~/Development/obsidian_vaults/Memory` holds the knowledge: 17 compiled facts
across four spaces, and 32 raw sources they were compiled from.

### What carries forward

**Three layers, each with one job.** Sources hold raw material and are never
edited. Facts are compiled out of sources, one fact per record. Conventions
govern both. Nothing writes into two layers.

**Four gates decide whether a candidate becomes a fact.**

1. It will still be true in a month.
2. It appeared on two separate days, or Shane stated it once as a preference, a
   correction, or a decision.
3. Nothing already records it.
4. It contradicts nothing, or it retires what it contradicts.

**Reconcile before appending.** Pull the entities out of new material, open every
record naming one of them, rewrite what the new material contradicts, and only
then consider what is genuinely new. Appending first leaves two answers standing
and a reader cannot tell which one is current.

**A machine never marks its own work verified.** `generated_by` records who wrote
a fact and `verified_by` records who confirmed it. They stay separate, and
scheduled jobs never set the second. Anything a machine asserted stays on the
review queue until Shane clears it.

**Staleness is an absolute date, not a duration.** Every fact with a natural
review point carries one, picked from the fact rather than from the day it was
written. A batch given the same horizon on the same afternoon all falls due
together, and a queue that arrives at once is one nobody works through.

**Fix what can be proven wrong, propose everything else.** A broken link has one
right answer. A restructure does not, and a job told weekly to find something to
improve will find something forever. A refusal is recorded on the record it
concerned, with the reason, so a later run does not raise it again.

**Uncertainty is recorded, never guessed away.** An empty field asks a question.
A plausible invented answer closes it wrongly and survives for years.

**Never store a secret.** No keys, tokens or connection strings in any layer.
History is permanent, and a record that carried a key once carries it forever.

### What the markdown system cannot do

It has no interface beyond Obsidian and a terminal. It ingests mail only when a
scheduled job runs. It has no path to Outlook or Teams. It cannot handle meeting
recordings at all. Its search is grep, so it cannot answer a question phrased
differently from how the fact was written. And it holds 17 facts, which is a
corpus a person can still hold in their head.

## Nabium

Shane's own macOS meeting recorder, at `~/Development/personal/nabium`. It is
further along than a prototype: three ADRs, runbooks, a whisper model benchmark,
brand assets, and a migrated Postgres schema.

It captures system audio without joining meetings as a bot, takes screenshots
when content is shared, diarises speakers against a persistent voice library,
**transcribes on-device**, and writes engagement-aware markdown summaries into an
Obsidian vault. Per ADR-0003 it also ingests messages from iMessage, Slack,
Teams, Google Chat and Webex.

Its schema already holds `sessions`, `transcripts`, `transcript_segments`,
`transcript_chunks`, `speakers`, `session_attendees`, `people`, `engagements`,
`action_items`, `glossary`, `summaries`, `screenshots` and `pipeline_events`,
with pgvector HNSW indexes.

**Status:** a personal tool. It may become a product later, and that is not
driving decisions today.

### How KPA and nabium meet

Nabium owns capture, transcription, speakers and sessions. KPA owns mail, memory,
the briefing and the agents.

Nabium pushes an event over the LAN when a session is ready. KPA then reads the
detail from nabium's Postgres through a read-only role. Push is the trigger, the
read-only connection is the source.

The cost of reading another system's tables directly is that KPA breaks whenever
nabium migrates its schema. Two things reduce that: KPA reads through database
views it defines rather than through nabium's base tables, and nabium's migration
runbook gains a step that names KPA as a consumer.

### Where the two projects disagree

Nabium's build spec names data sovereignty as its first reason for existing:
transcripts of BHP Ironclad and Meridian workshops should not leave the device.
It transcribes locally on purpose and gates cloud summarisation behind a
per-engagement `allow_cloud_summarisation` flag.

**KPA ignores that flag.** Decided 23 August 2026. Content from every engagement
reaches Claude or OpenRouter regardless of what nabium recorded about it.

The consequence is that the sovereignty guarantee ends at KPA's boundary rather
than continuing through it. Nabium's local transcription still earns its keep,
since it is already built and costs nothing to run, but it no longer protects the
engagements it was written to protect once KPA ingests them. See *Risks
accepted*.

## Decisions settled

Each of these is recorded as an ADR in `docs/adr/`.

| Decision | Choice | Why |
|---|---|---|
| Memory store | PostgreSQL with typed edges and pgvector | The data is a graph, but the queries are neighbourhood queries rather than open traversal. Postgres does those in milliseconds at this scale, and row-level security enforces the Collibra and Koinon separation in the database rather than in application code. Neo4j Community has no role-based access control, so that boundary would live in application code where one missed filter leaks employer customer material. |
| Inference | Claude subscription through the headless CLI, with OpenRouter as the metered path | Reuses the pattern the launchd jobs already prove. No marginal cost on the scheduled work. |
| Local models | None | Rejected 23 August 2026. The hardware holds 7.6 GB of RAM and has no CUDA device, which caps local generation at a 3B model at roughly 10 tokens per second. |
| Deployment | Bare metal on Ubuntu, systemd units, on Shane's box | Matches how the existing services on the box run, and spends no RAM on container overhead where RAM is the binding constraint. That reasoning is about `amaterasu` and does not travel: anybody else gets a container. |
| Runtime | Node | Stated requirement. Framework choice is open. |
| Distribution | A container, and a first boot that asks who you are | The install has to work on a machine that holds nothing but Docker. Everything the assistant needs beyond that is asked for on screen rather than assumed from the environment. ADR-0009. |
| Autonomy | Autonomous within policy | Acts inside rules Shane sets, logs everything, audited after. |
| Nabium integration | Read-only database role, triggered by a LAN push | Cheapest to build, no API to design and maintain across two personal projects. |
| Nabium cloud flag | Ignored by KPA | Shane's call, 23 August 2026. |
| Entity ownership | KPA is canonical, nabium feeds it | KPA sees mail as well as meetings, which is a far wider source of people. Nabium's entities merge in on ingest. |
| Memory vault | KPA replaces it | The 17 facts and 32 sources migrate into Postgres. The vault and its three launchd jobs retire. One system, no sync problem. |
| Collibra and Koinon separation | A guideline, not a database constraint | Decided 23 August 2026. Retrieval filters by space and crossing answers get flagged. Nothing structurally prevents a leak. |
| Remote access | Cloudflare Tunnel with Access in front, on Shane's box | Works on any device without installing a client. Traffic transits Cloudflare. Another installation reaches itself however its owner chooses, and the application no longer depends on the answer. ADR-0009. |
| Ingestion depth | Six months | Covers current engagements at a bounded one-off cost. |
| Embeddings | Voyage AI, `voyage-4` at 1024 dimensions | Anthropic's own recommendation. This row named `voyage-3` until 27 August 2026, when KPA-26 read Voyage's model list and found it listed as legacy. `voyage-4` over `voyage-4-large` because a corpus of 17 facts and 32 sources cannot show the larger model's quality. Both default to 1024, so moving up later changes a model name and not the schema. Adds a vendor and a key. |
| Time model | Facts carry `valid_from` and `valid_to` | Retirement becomes a date rather than a delete, so the system answers what was true in March and fact decay stays visible. |
| Microsoft Graph | Not pursued | Customer-tenant consent is unobtainable. Nabium's desktop capture covers the same material. |
| Application shape | Next.js for the web tier, a separate worker process for everything long-running | Agent runs and ingestion must never sit in a request handler. The split is load bearing. |
| Job queue | pg-boss, backed by the same Postgres | No Redis, so no second store and no extra RAM on a box where RAM is the constraint. |
| Issue text | The tracker owns it, KPA caches and adapts at the boundary | Jira's ADF is a ProseMirror schema, so the round trip costs a node rename and a second copy earns nothing. Boards Shane shares with colleagues have other writers, and two masters over one rich-text blob do not merge. ADR-0007. |
| Issue editor | TipTap, whose document model is ProseMirror | Every adapter starts one rename from ADF. Slate and Lexical would need a parser instead. ADR-0007. |
| Tracker freshness | Poll on a pg-boss schedule, push to the browser over SSE | Jira refuses webhook registration to an API token, and the admin route needs a permission Shane lacks on the Collibra site. Polling also keeps Cloudflare Access closed, where a webhook would need a bypass on a public path. ADR-0008. |
| First slice | Migrate the memory | Proves the model before any volume reaches it. |
| Jira stories | Spec carrying | Each story states its acceptance criteria, the files it touches, its test, and a definition of done an agent can verify alone. |
| Repository | Git from the first commit, private on GitHub | Matches nabium and the memory vault. The design carries history from line one. |
| Scope of replacement | KPA replaces the whole markdown system | The vault, `journal/`, the three launchd jobs and the Gmail filter rules. Nothing of it keeps running alongside. |
| Gmail labelling | KPA takes it over | The 15 rules in `gmail-filters/collibra.xml` import as the starting policy rather than being rewritten from nothing. |
| Drafting voice | The `draft-email` skill's rules | Already written, already tuned, already covers all three accounts. KPA implements them rather than learning a voice from sent mail. |
| Retirement | Only a source or a human sets `valid_to` | Time alone never retires a fact. The staleness sweep flags and re-confirms. |
| Offline | Rescan on return | No queueing on the Mac and no catch-up logic. When the box comes back it scans from the last watermark, which is the same path a normal poll takes. |
| Backup | Copy nabium's runbook | `docs/runbooks/database-backup.md` already exists and already covers Postgres on this hardware. |
| Employer policy checklist | Not a gate | Shane is the decision maker and has accepted the risk directly. Recorded, not chased. |
| Mail triage rule | Carries forward unchanged | If a person composed the words it stays in the inbox, and the sending address proves nothing. The rule earned itself through use in `docs/mail-triage-method.md`. |
| Identity | The installation owns its own account, created on the first boot | An installation somebody else runs has no Access in front of it and no WorkOS tenant behind it, so the application authenticates rather than assuming the network already did. Access and WorkOS stay in front of Shane's box as that deployment's own choice. Supersedes the WorkOS decision of 23 August 2026. ADR-0009. |
| Users | One owner per installation | No permission model, no per-user partitioning, no sharing. The memory model assumes one person throughout: one set of facts, one inbox, one voice, one review queue, and a `verified_by` that means the owner. On Shane's box that owner is Shane. |

**A note on the memory store decision.** Row-level security enforcing the
Collibra and Koinon wall was the tiebreaker that chose Postgres over Neo4j. That
wall is now a guideline, so the tiebreaker no longer applies. The decision still
holds on the arguments underneath it: the queries are neighbourhood queries
rather than open traversal, one store beats two, and nabium already runs Postgres
with pgvector so the operational knowledge exists. ADR-001 records this
correction rather than hiding it.

**The embedding model and its width are a migration, not a setting.** A pgvector
column declares a fixed width, so changing either value makes every stored vector
the wrong width and the wrong model's output. `src/embedding.ts` holds both
values in one place for that reason.

## The machine

`amaterasu`, reachable over SSH. A 2018 Mac mini running Ubuntu 24.04.4.

| | |
|---|---|
| CPU | Intel i7-8700B, 6 cores, 12 threads, 3.2 GHz base |
| RAM | 7.6 GB |
| GPU | Intel UHD 630. No CUDA. |
| Disk | 931 GB NVMe, 762 GB free |
| Network | 192.168.20.110 on the LAN |
| Installed | Docker 29.6.1, Compose v5.3.1, ffmpeg 6.1.1, Python 3.12.3, git |
| Absent | Node, PostgreSQL, Claude CLI, Tailscale, a reverse proxy |

**It already works for a living.** It serves NFS, runs NZBGet, and runs a
transcode monitor. Transcoding takes all 12 threads when it fires, and the
assistant has to survive that. A desktop session with Chrome open holds roughly
800 MB.

**RAM is the constraint that will bite first.** Roughly 5 GB is available after
the existing services. PostgreSQL and Node fit inside that today. Years of
ingested mail will not. The machine takes two DDR4-2666 SO-DIMMs to 64 GB and the
upgrade costs a few hundred dollars, which is the cheapest fix available when the
ceiling arrives.

## Architecture

### The shape

```mermaid
flowchart TB
  shane(("Shane"))

  subgraph mac["Shane's Mac"]
    nab["nabium<br/>capture · diarise · transcribe"]
    nabpg[("nabium Postgres<br/>sessions · transcripts · speakers")]
    nab --> nabpg
  end

  subgraph ama["amaterasu · Ubuntu 24.04 · systemd"]
    cfd["cloudflared"]
    web["kpa-web<br/>Next.js :3000"]
    worker["kpa-worker<br/>ingest · agents · schedules<br/>pg-boss"]
    pg[("KPA Postgres + pgvector<br/>sources · facts · edges · audit · issue cache")]
    cfd --> web
    web --> pg
    worker --> pg
  end

  subgraph ext["External"]
    goog["Google Workspace ×3<br/>Gmail · Calendar · Drive"]
    voy["Voyage AI<br/>embeddings"]
    llm["Claude CLI (subscription)<br/>OpenRouter (metered)"]
    jira["Jira ×2<br/>koinon · engineering-collibra"]
  end

  cf["Cloudflare Access<br/>Shane's box only"]
  shane --> cf --> cfd

  nab -- "session ready · LAN push" --> worker
  worker -- "read only" --> nabpg
  worker <--> goog
  worker --> voy
  worker --> llm
  worker -- "poll · write" --> jira
  web -- "SSE" --> shane
  web --> llm
  web --> voy
```

Three services under systemd on amaterasu, one Postgres, no containers. The
worker holds every long-running thing: ingestion, agent runs, the nightly review,
the staleness sweep. The web tier reads and serves.

### The three layers of memory

The markdown system's structure survives the move to Postgres.

| Layer | Table | Written by | Edited |
|---|---|---|---|
| Sources | `sources`, `source_chunks` | ingestion, verbatim | never |
| Facts | `facts`, `edges` | an agent, or Shane | revised and retired, never deleted |
| Policy | `policies`, `rejections` | Shane | evolves |

`facts` carries `valid_from` and `valid_to`, so retiring a fact sets a date
rather than removing a row. Asking what was true in March stays a plain query,
and decay stays visible.

### Two stores, not one

The data divides in two, and the division is the most useful thing to know
before anybody designs a table. **The memory holds what the assistant knows.
The application data holds what the product needs to run.** They are different
in every way that matters.

| | The memory | The application data |
|---|---|---|
| Holds | Sources, facts, edges, entities, the review queue, the audit log, the policy rules | The account, connections, workspaces, projects, sprints, the issue cache, custom fields, preferences |
| Written by | Ingestion and agents, then confirmed by Shane | Shane, and a poller mirroring Jira |
| Deletes | Never. It retires and supersedes | Ordinarily. A removed connection is gone |
| Who owns the truth | KPA. A fact is its own | The tracker. ADR-0007 keeps the text there and caches it here |
| Shape | A graph with time on every node | Plain rows |
| Today | Ten tables in `migrations/001_core_schema.sql` | No tables. Browser storage and fixtures |

**They meet in two places, and neither is a data dependency.** The `space`
filter cuts both, and the sidebar renders the memory's counts beside the
tracker's navigation. No issue points at a fact, and no fact points at an issue.
Either store could sit in its own database, or its own service, without
disturbing the other. One Postgres instance still suits the hardware, so this is
a schema boundary rather than a deployment one.

### What each store still needs

**The memory was built for the vault, not for the screens.**
`migrations/001_core_schema.sql` models markdown notes, because slice one had to
migrate them. The interface models what Shane reads. Four differences need a
decision.

1. **The fact states disagree.** `fact_status` holds `draft`, `stable`, and
   `deprecated`. The interface runs on six: `candidate`, `proposed`, `verified`,
   `stale`, `retired`, and `rejected`. Every review control rests on the six,
   and the review queue is the product's core loop. *Open.*
2. **`sources` holds four columns:** `path`, `body`, `recorded_at`, and
   `owner_id`. The source drawer shows a kind, a title, a date, an author, and a
   space. None of the five exists.
3. **A citation names a chunk, an edge names a source.** The drawer highlights
   the exact passage a fact came from, and nothing records which chunk that was.
4. **The policy table and the audit table are missing.** This document calls the
   policy layer load bearing and the audit log the safety net. The interface
   ships a screen for each, and the migration creates neither.

Six things the interface shows have nowhere to live: needs-you items, meetings,
chat answers, conversations, audit entries, and citations.

**The application data has no schema at all.** Every issue, sprint, workspace,
project, custom field and connection sits in `apps/web/lib/fixtures.ts` or in
`localStorage`. Eleven browser keys hold state that belongs on a server, and one
of them holds the account. Nothing survives a second device, and nothing
survives a cleared browser.

**The `space` enum already carries a fourth value.** The database offers
`shared`, and the interface knows three. Whichever wins, the other changes.

### What sets `valid_to`

**Only a source or a human. Time alone never does.**

A **contradicting source** sets it to the date the change took effect according
to that source, not the date KPA learned of it. An email saying Nigel left in
June retires the fact as of June. Where the source gives no date, `valid_to`
takes the source's own date and the fact records that the date was inferred
rather than stated, because recording the uncertainty is what the vault's
never-guess rule requires.

A **superseding fact** sets it to the replacement's `valid_from`, with a
`supersedes` edge between them. One answer stands at any date.

**Shane** sets it to whatever date he gives.

**The staleness sweep never sets it.** A stale fact is due for review, not false.
The vault's own rule already says so: a stale fact is a fact doing its job rather
than a defect. The sweep flags and re-confirms; it never retires.

One consequence of choosing `valid_from` and `valid_to` over full bitemporal:
KPA answers what was true in March, but not what it believed in March. A
backdated retirement rewrites the answer to the first question with no record
that the answer used to differ. Adding a `recorded_at` column later upgrades this
without a rewrite.

Entity resolution is KPA's job. Nabium's `people` and `engagements` feed in and
merge against KPA's own, because KPA sees mail as well as meetings and mail is
the wider source of people.

### One user, with one hedge

KPA is single user. No permission model, no per-user partitioning, no sharing.
Building any of that now would be building a different product.

Single user means one owner per installation. The first boot asks who that is
and writes the account, so an installation somebody else runs belongs to them
rather than to Shane. Nothing above this line changes: one owner, one set of
facts, one voice.

The one concession to "for now" is an `owner_id` column on `sources`, `facts` and
`tasks`, defaulted to a single row in `users`. It costs one column and one
default today. Adding it later means migrating every table that holds anything
personal, which is all of them. This is a hedge against a stated uncertainty
rather than a speculative feature, and nothing else in the design may assume more
than one user exists.

### A fact's life

```mermaid
stateDiagram-v2
  [*] --> Candidate: extracted from a source
  Candidate --> Rejected: fails a gate
  Candidate --> Proposed: passes all four gates
  Proposed --> Verified: Shane confirms
  Proposed --> Rejected: Shane declines
  Verified --> Stale: past stale_after
  Stale --> Verified: re-confirmed
  Verified --> Retired: contradicted · valid_to set
  Stale --> Retired: contradicted · valid_to set
  Rejected --> [*]: reason recorded on the entity
  Retired --> [*]: row kept, queryable by date
```

A rejection records its reason against the entity it concerned, so a later run
reads it and does not raise the same candidate again. Nothing is deleted at any
point.

### Ingesting a meeting

```mermaid
sequenceDiagram
  autonumber
  participant N as nabium (Mac)
  participant W as kpa-worker
  participant NP as nabium PG (read only)
  participant L as Claude
  participant V as Voyage
  participant P as KPA PG

  N->>W: POST /ingest/session {session_id}
  W->>NP: read transcript, attendees, engagement
  NP-->>W: segments, speakers, metadata
  W->>P: INSERT source (verbatim, never edited)
  W->>L: extract entities, decisions, commitments
  L-->>W: candidates
  W->>P: resolve entities against KPA's people and engagements
  loop each candidate
    W->>W: apply the four gates
    alt passes
      W->>P: INSERT fact (generated_by=agent, verified NULL)
      W->>P: INSERT edges
    else fails
      W->>P: record rejection and reason
    end
  end
  W->>V: embed source chunks and new facts
  V-->>W: vectors
  W->>P: store embeddings
  W->>P: queue proposals for the briefing
```

Nabium pushes the trigger and KPA pulls the detail. The push carries an id, not a
payload, so a missed push is recoverable by replaying from nabium's database.

### Triaging mail

```mermaid
sequenceDiagram
  autonumber
  participant S as pg-boss schedule
  participant W as kpa-worker
  participant G as Gmail ×3
  participant L as Claude
  participant P as KPA PG
  participant U as Shane

  S->>W: mail.poll
  W->>G: list messages since watermark
  G-->>W: threads
  W->>P: INSERT source per message
  W->>L: classify by customer, project, needs-human
  L-->>W: labels and verdict
  W->>G: apply labels (autonomous, reversible)
  alt a reply is owed
    W->>L: draft in Shane's voice
    L-->>W: draft
    W->>G: create a Gmail DRAFT
    W->>P: queue it for the briefing
  end
  U->>G: reviews, edits, sends
  Note over W,G: nothing sends without Shane
```

Labelling runs autonomously because a label is reversible. Sending does not,
because it is not.

### Answering a question

```mermaid
sequenceDiagram
  autonumber
  participant U as Shane
  participant Web as kpa-web
  participant V as Voyage
  participant P as KPA PG
  participant L as Claude

  U->>Web: question
  Web->>V: embed the question
  V-->>Web: vector
  Web->>P: hybrid retrieve: vector + keyword + graph neighbourhood
  P-->>Web: facts, sources, edges (space filtered by default)
  Web->>L: question and retrieved context
  L-->>Web: answer with citation ids
  Web-->>U: answer, citations open to the source
  alt the answer drew on both Collibra and Koinon
    Web-->>U: flag the crossing
  end
  Web->>P: file the answer as a candidate fact
```

Retrieval is hybrid on purpose. Vector search finds things phrased differently,
keyword search finds exact names and identifiers that embeddings blur, and the
graph pulls in the neighbours that neither would rank.

Filing a good answer back as a candidate is what stops the same analysis being
paid for twice.

### Acting alone

```mermaid
sequenceDiagram
  autonumber
  participant A as kpa-worker (agent)
  participant Pol as Policy engine
  participant P as KPA PG (audit)
  participant X as External service

  A->>Pol: propose {action, target, payload}
  Pol->>Pol: evaluate rules
  alt forbidden
    Pol-->>A: DENY (rule named)
    A->>P: audit: denied, rule, payload
    A->>P: queue for Shane's decision
  else allowed
    Pol-->>A: ALLOW
    A->>P: audit: intent, before state
    A->>X: execute
    X-->>A: result
    A->>P: audit: outcome and how to reverse it
  end
```

The policy engine is a table of rules the worker consults, not a paragraph in a
prompt. It is inspectable and testable, and it is the only thing standing between
an autonomous agent and Shane's sent-mail folder.

Every action writes its intent before acting and its outcome after, along with
how to reverse it. Without an approval step in front, the audit log is the safety
net, so it has to be good enough to catch a mistake after the fact and it has to
surface on the briefing.

## Risks accepted

**Client transcripts reach the cloud.** KPA ignores nabium's per-engagement
sovereignty flag, so BHP Ironclad and Meridian material reaches Claude or
OpenRouter along with everything else. Accepted 23 August 2026.

**Employer data on personal infrastructure.** Collibra customer data reaches a
personal system on personal hardware and a third-party model vendor. Nabium
carries an unsigned checklist covering exactly this, at
`docs/employer-policy-checklist.md`. Shane has decided it is not a gate: he is
the decision maker and accepts the exposure directly. Recorded, not chased.

**OpenRouter routes to whichever upstream wins the bid.** Retention guarantees
vary by provider and the payload reaches a broker as well as a model vendor. For
the most sensitive material, a single named provider is the safer path.

**The Claude subscription is not a service backend.** Claude Code is sold as a
coding tool. A few scheduled jobs a day is ordinary use. An always-on application
calling the CLI on every request is not, and it will meet rate limits. The
Anthropic API is the escape hatch, and the design should keep the inference call
behind an interface so switching costs an afternoon.

**The Collibra and Koinon wall is unenforced.** It is a guideline the assistant
is told to follow, so one prompt failure puts employer customer material into a
Koinon answer or a Koinon commercial figure into a Collibra one. The markdown
system treated this as its hardest rule. Accepted 23 August 2026. The mitigation
available later is a row-level security policy on the space column, which makes
the leak structurally impossible rather than merely discouraged.

**The application faces the public internet.** Cloudflare Tunnel with Access in
front handles authentication properly, but the system now holds employer customer
data, operates autonomously, and is reachable from anywhere rather than from the
LAN. Every layer has to hold, not just the tunnel.

**Somebody else's installation has no tunnel in front of it.** The application
is the only gate there, so its own login carries weight that Access used to
carry on Shane's box. That is why the password rules are strict and why the
reset path needs a command line escape hatch on the server. ADR-0009.

**The Collibra OAuth grant is revocable.** It works because no administrator
blocked it. A tenant policy change removes KPA's access to that mailbox without
warning, and the design should degrade rather than break when it happens.

**Schema coupling to nabium.** KPA reads another project's tables. Nabium's
migrations can break KPA silently.

**One machine, no redundancy.** A consumer desktop with a single NVMe. Backups
are not yet designed. Nabium has a database backup runbook worth copying.

## Delivery

Work is tracked in Jira project KPA on `koinon.atlassian.net`. Stories carry
their own specification: acceptance criteria, the files they touch, the test that
proves them, and a definition of done an agent can check without asking. The cost
is that stories take longer to write. The return is that an agent picks one up
with no other context and cannot quietly decide it is finished.

This document and the ADRs beside it are the source those stories derive from. If
the two disagree, the brief is wrong and gets fixed, rather than the story being
rewritten to match the code.

### The slices

Seven slices reach a working application. The first two are built. The order
runs down the page, and each slice states what it unblocks.

| Slice | What it delivers | State |
|---|---|---|
| 1. Migrate the memory | The memory model, proved on 17 facts | In progress. KPA-1 |
| 2. Draw the interface | Every screen, on fixtures | In progress. KPA-35 |
| 3. Finish the memory schema | The tables and columns the screens need, on top of slice one | Not started |
| 4. Build the application data schema | The account, connections, workspaces, projects, sprints, the issue cache, custom fields | Not started |
| 5. Connect the accounts | Credentials held on the server, and a real OAuth grant | Not started |
| 6. Fill the stores | Ingestion into the memory, and a Jira poller into the cache | Not started |
| 7. Join the halves | Replace every fixture with a real read and a real write | Not started |

**Slices three and four are separate on purpose.** *Two stores, not one* says
why. One extends a schema that exists and settles four disagreements with the
interface. The other creates a schema from nothing, for data no table has ever
held. They share no row, they can run in either order, and one person can build
them in parallel with no merge conflict worth the name.

**Slice five comes before slice six, and the order is load bearing.** Nothing
ingests a mailbox it cannot reach. The connections screen already draws the
shape, and it stores no credential.

**Slice seven carries the integration risk the others defer.** Take one region
end to end before the rest. Needs you reads and writes nothing, so it proves the
whole path with the least to undo.

Two capabilities sit outside this order, because each is a product in itself:
the agent that acts within policy and writes the audit log, and the retrieval
path that answers a question with citations. Both need slice three underneath
them, and neither has a slice yet. *Open.*

### Slice one: migrate the memory

Move the 17 facts and 32 sources out of the Obsidian vault into Postgres, with
the gates, the staleness sweep, and `valid_from` and `valid_to` working.

It ships no user interface and ingests no mail. It proves the memory model is
right before any volume reaches it, which is the cheapest moment to find out it
is wrong. Every later slice writes into this schema, so a mistake here is a
migration for everything built afterwards.

**Done when** every fact from the vault exists in Postgres with its provenance
intact, the four gates run as testable code rather than prompt instructions, the
staleness sweep reports the same notes the vault's `check.py` reports today, and
retiring a fact sets `valid_to` rather than deleting a row.

#### What the migration involves

Moving 17 facts is trivial. The work is the schema they land in, and the slice
should be judged on that rather than on whether 17 rows arrived.

1. **Design the schema.** `sources`, `source_chunks`, `facts`, `edges`,
   `entities`, `tasks`, `questions`, `rejections`, `policies`, `audit`. Every
   frontmatter field in the vault becomes a column or an edge, and anything that
   does not fit is a schema gap found now rather than after ingestion starts.
2. **Parse and validate.** A reader for each markdown file that checks
   frontmatter against the schema and **fails loudly** on anything unexpected.
   Silence here means a fact arrives subtly wrong and is read as true for months.
3. **Turn links into edges.** Every `[[wikilink]]` becomes a typed edge.
   Backlinks come free once the edges exist, which is what Obsidian was giving
   and Postgres has to replace.
4. **Turn inline tasks into rows.** The `- [ ]` items with their due, start and
   done signifiers attach to the fact they sit on, never to a standalone list.
5. **Create the tables the two `index.md` tables need, and migrate nothing.**
   The open questions and the Decisions table are workflow rather than prose, so
   `questions` and `rejections` exist in the schema. Both tables on `index.md`
   carry headers and no rows as of 24 August 2026, so there is nothing to move.
   A later brainstorm rescopes the parser that would read them.
6. **Write the four gates as code.** Each gate gets its own test. This is the
   part that must stop being a prompt instruction.
7. **Port `check.py`.** The staleness sweep and the advisory checks: orphans,
   cross-space links, uncompiled source ratio, review pile-up.
8. **Chunk and embed** the 32 sources through Voyage.

**How it is verified.** Run the vault's `check.py` against the vault, run the new
equivalent against Postgres, and diff the two reports. They must agree. That is a
real test rather than an inspection, and it is available only because the old
system still exists at migration time. It stops being available the moment the
vault retires, which is an argument for building it now.

#### The journal crosses a machine boundary

KPA replaces `journal/` along with the rest of the markdown system, and
`journal.py` renders that journal from Claude Code's transcripts in
`~/.claude/projects/`. Those live on Shane's Mac. KPA runs on amaterasu.

So the journal needs the same treatment as nabium: something on the Mac ships the
transcripts across. The cheapest version reuses the pattern already chosen, a
push over the LAN, rather than inventing a second mechanism.

## Open questions

1. Which second factor does WorkOS enforce on Shane's box? The recommendation is
   a hardware key or TOTP rather than an emailed one-time code. A second factor
   for the application's own login is a separate question, and it is unanswered.
2. Are nabium's Teams and chat collectors built, and what do they produce? The
   only route to customer-tenant material. Deferred by Shane, to be decided
   later.
3. Push notification: agreed in principle, deferred. The channel is undecided,
   and an iMessage integration already exists.
4. Which fact-state vocabulary wins, the database's three or the interface's
   six? See *What each store still needs*. The review queue rests on the six.
5. Does the Microsoft card serve a tenant Shane owns? *Every connection the
   product offers* names the contradiction: the catalogue offers Microsoft and
   the brief rules out customer-tenant Graph access.
