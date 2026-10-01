# The schema

Twenty-nine tables and fourteen enums. `migrations/001_core_schema.sql` created
the first ten, and migrations 003 to 010 changed what follows. Migrations 011
to 014, 017 and 026 add no table: 011 creates the schema the job queue lives
in, 012 seeds one policy row, 013 adds one column to `facts`, 014 adds one
column and one enum value to `audit`, 017 adds four columns to `users`, and 026
adds two more to `users` and a second policy row. Migration 016 adds a
connection and its sealed secret, 018 adds the workspace and project tree, 021
adds the fields a workspace carries, and 022 caches the issues a tracker owns.
023 adds no table and says a connection may hold no credential, 024 carries a
proved sign-in, 025 carries an outstanding password reset, 027 holds the
sprints a tracker runs and the reference 022 left for it, 028 holds a write the
tracker has not accepted, and 029 adds the last one, which holds a grant that
has left for a provider and has not come back. The vault's own `CLAUDE.md` is
the authority for every enum the vault writes.

Two rules shape all of it. **Nothing is ever deleted**: retiring a fact sets
`valid_to`. And **a machine never marks its own work verified**, which is a
check constraint here rather than an instruction in a prompt.

## The tables

| Table | Holds |
|---|---|
| `nodes` | Every endpoint an edge can point at. `facts`, `sources` and `entities` take their `id` from here, so `edges` can carry real foreign keys |
| `users` | One row, holding the owner and the account it signs in with. Every `owner_id` defaults to it |
| `sources` | Raw material, verbatim, never edited. Carries the kind, title, date, author and space the drawer shows |
| `source_chunks` | What gets embedded, with the byte range in `sources.body` a citation opens at |
| `facts` | One row per note in a space, whatever its `type`, with the dates that retire it, the state it starts in, and the entity it concerns |
| `edges` | Typed, directional links between two nodes. A `derived_from` edge may name the chunk as well as the source |
| `entities` | People, organisations and the like. Created now, populated by a later slice |
| `tasks` | An inline `- [ ]` from a note, with its due, start and done dates and the original line |
| `rejections` | A candidate that did not become a fact, and why, so a later run does not raise it again |
| `policies` | The rules a policy engine consults before every outbound action |
| `audit` | One entry per attempt, allowed or denied alike. Append only |
| `needs_you` | The four kinds of item waiting on Shane. A row closes rather than disappears |
| `meetings` | A calendar event, never the transcript it produces |
| `conversations` | A chat, with the answers and citations below |
| `answers` | One question and its answer, read back in the order asked |
| `citations` | The source and the passage an answer's chip opens |
| `inbound_deliveries` | A webhook body, verbatim, waiting for a worker |
| `issues` | A cache of the issues a tracker owns, keyed by workspace and key, carrying the tracker's own `updated` stamp |
| `issue_blocks` | One blocking link, stored once from the blocker |
| `issue_writes` | A write the tracker has not accepted, with the stamp it expected and, on a conflict, the one it found |
| `connections` | One account on one provider. Provider, name, method, the services it may be reached for, and the address it sends mail from |
| `connection_credentials` | The sealed secret for one connection, with the dates the provider named, the last verdict, and whether it worked |
| `workspaces` | One Jira tracker and the space it belongs to. The id is stable, the name is not, and nothing files anything under the name |
| `projects` | One piece of work inside a workspace, and the one rule that matches its issues: a Jira label, or a Jira key prefix |
| `workspace_fields` | The custom fields a workspace carries, and the Jira field each one writes |
| `sessions` | One proved sign-in. The id is a SHA-256 of the token and never the token |
| `password_resets` | One outstanding reset. The id is a SHA-256 of the token, one row per owner, and using it deletes the row |
| `oauth_grants` | A grant in flight. The id is a SHA-256 of the state, and the PKCE verifier waits beside it for ten minutes |
| `sprints` | The sprints a tracker runs, cached. One active per workspace, and `issues.sprint_id` points here |

## The enums

| Type | Values |
|---|---|
| `node_kind` | `fact`, `source`, `entity`, `url`, `unresolved` |
| `fact_type` | `person`, `customer`, `engagement`, `system`, `policy`, `decision`, `preference`, `reference`, `source` |
| `space` | `collibra`, `koinon`, `personal`, `shared` |
| `fact_state` | `candidate`, `proposed`, `rejected` |
| `edge_kind` | `derived_from`, `links_to`, `supersedes` |
| `source_kind` | `meeting`, `mail`, `document`, `chat` |
| `audit_outcome` | `allowed`, `denied`, `attempted` |
| `needs_you_kind` | `draft`, `question`, `denied-action`, `deadline` |
| `contract_date_source` | `typed`, `salesforce` |
| `issue_status` | `backlog`, `todo`, `in-progress`, `in-review`, `done`, `cancelled` |
| `issue_kind` | `epic`, `story`, `subtask` |
| `issue_priority` | `none`, `low`, `medium`, `high`, `urgent` |
| `sprint_state` | `active`, `future`, `closed` |
| `issue_write_state` | `queued`, `sent`, `conflict`, `failed` |

`edge_kind` is enumerated in one place so no call site invents a sixth.
`derived_from` comes from a `sources:` entry, `links_to` from a `[[wikilink]]`
in the body, and `supersedes` from a replacement to the fact it retires.

**A `derived_from` edge keeps its entry in `edges.citation`, verbatim.** A
citation is a sentence, such as "Shane, answers in [[index]], 23 August 2026",
and the target keeps only the name in brackets. Before KPA-131 the author, the
place and the date went with the rest of the sentence: eight of the frozen
vault's 33 entries lost them, seven naming `[[index]]` and one naming a real
source. The target still resolves exactly as before, and the constraint
`edges_citation_is_derived_from` keeps the column null on every other kind.

`edges_unique` is `(from_id, to_id, kind)`, so a fact citing one target in two
different sentences keeps the first and drops the second. No fact in the frozen
vault does. Widen the constraint to include `citation` when one does.

`node_kind` has no value for a root page. The vault's `index.md`, `log.md`,
`CLAUDE.md` and `README.md` belong to none of the memory's three layers, so a
wikilink naming one resolves `unresolved`. ADR-0019 decided that and measures
what it costs: not the nine citations anyone would count, but two orphan
advisories, raised by links running the other way.

## A fact's state: three stored, three derived

The interface shows a fact in one of six states. `facts.state` stores three,
because each is a judgement somebody made. The other three read columns the
row already carries, so nothing holds one truth twice.

| State | Reads |
|---|---|
| `verified` | `verified IS NOT NULL` |
| `stale` | `verified IS NOT NULL AND stale_after < today AND valid_to IS NULL` |
| `retired` | `valid_to IS NOT NULL` |

`src/memory/state.ts` builds it from a row and a day. The day is an argument,
never a call to `now()` inside the function, because a fact goes stale when a
date passes and a test has to hold that day still.

Retirement settles the question first. A retired fact reads `retired` whatever
`stale_after` says, because `valid_to` is the later and more deliberate word.

## How long one confirmation lasts

`facts.review_interval` holds it, in days, and migration 013 added it.
Re-confirming a stale fact sets `stale_after` to today plus that number and
changes the number itself not at all, so a fact judged to hold for 41 days
holds for 41 days every time. A null means the fact has no review point and
never goes stale, which is what a null `stale_after` means. A check constraint
floors the column at one day, so no writer has to floor it.

The interval used to be read back out of `stale_after` minus `generated`. The
re-confirm write moves `stale_after`, so each confirmation measured the span
the last one created: 41 days granted, then 285, then 571, then 1143. ADR-0017
records the measurement and the amendment, and KPA-133 removed the derivation.

The two columns divide one judgement. `stale_after` says when the next review
falls, and `review_interval` says how long one confirmation lasts. So a hand
edit to `stale_after` moves the next review and nothing else. Changing how long
every later confirmation lasts means editing `review_interval`.

Every writer of `stale_after` writes `review_interval` in the same statement.
A row carrying a horizon and no interval goes stale and re-confirms to nothing,
because nobody said how long a confirmation of it lasts and the store will not
guess.

This replaced `fact_status`, whose `draft`, `stable` and `deprecated` described
how finished a vault note was. ADR-0010 says why, and it leaves the vault's
three values for KPA-5 to translate on the way in.

## What a citation opens

A citation names a passage, so `edges` carries a nullable `chunk_id` beside the
source a `derived_from` edge already named. Without it a citation opens the top
of a file and leaves the reader to find the line.

`source_chunks` stores a byte range into `sources.body` rather than a second
copy of the text, because a source is verbatim and two copies drift.
`src/memory/source.ts` reads that range back through a `Buffer`, since the
offsets count bytes and `String.prototype.slice` counts UTF-16 code units. The
two disagree from the first character outside ASCII.

`chunkForFact` joins the chunk back to the source its edge points at, so a
`chunk_id` left by a data error resolves to nothing rather than to the wrong
passage.

The five columns `sources` gained are all nullable, and nothing fills them yet.
`src/migrate/load.ts` is the only writer of `sources`, measured on
13 September 2026, and it stores a vault source's body verbatim with the five
left null: `src/vault-mapping.ts` says a source has no schema to fit. A
`NOT NULL` column with no default would reject every one of those rows.

**The drawer cuts the passage out of the body.** `apps/web/lib/sources.ts`
reads the source and its chunks and calls `chunkText`, which is the one place
the byte range is resolved. `String.prototype.slice` counts UTF-16 code units
and agrees with a byte offset only while every character is ASCII, so one
accented character moves every passage after it by one position.

The five columns migration 004 added are nullable and nothing fills them yet.
A source missing any of them opens nothing, and the drawer says so, rather
than drawing a heading with no kind and no date.

## Policy and audit

The brief calls the policy layer load bearing and the audit log the safety net.
Nothing approves an action before it runs, so these two tables carry that
weight alone. ADR-0005 says why a table rather than a paragraph in a prompt.

`policies` holds one row per rule: what it governs, what it allows or denies,
and whether it is on. `absolute` marks a rule Shane may not turn off, and
`src/policy/engine.ts` denies on an absolute rule whether `enabled` is true or
false. Migration 005 seeds the four rules the brief names. Migration 012 adds
`deny-by-default`, which is the engine's own behaviour rather than a fifth rule
about what Sukkal may do. ADR-0021.

| Key | Absolute | Seeded by |
|---|---|---|
| `mail.send.never-unprompted` | yes | 005 |
| `never-delete-or-destructively-edit` | yes | 005 |
| `fact.verify.never-by-agent` | no | 005 |
| `space.collibra-koinon-separation` | no | 005 |
| `deny-by-default` | yes | 012 |

`deny-by-default` exists because two failures name no other rule: an action the
engine's allowlist does not describe, and any action proposed while the table
is empty, unreadable or malformed. Both must deny, and
`audit_denial_names_a_rule` refuses a denial that names no rule. So the engine
either names a rule that did not fire, returns a denial the log cannot record,
or names this one.

`audit` holds one row per attempt and a second per outcome. Every row carries
the four fields the brief requires: `intent`, `before`, `result`, and `reverse`. A denial names the rule
by `rule`, a foreign key into `policies.key` rather than a copy of its prose,
so a rule can be reworded without rewriting every entry that ever cited it.
`audit_denial_names_a_rule` holds a denial to that promise, and lets an allowed
entry name none.

**An attempt and its outcome are two rows.** ADR-0015 decided that and
migration 014 carries it. An allowed action writes an `attempted` row before
the call and an `allowed` row after it, and `attempt` on the second names the
first by its id. `attempt` is null on the attempt row itself and null on a
denial, which is whole on its own because nothing ran, and
`audit_only_an_outcome_names_an_attempt` holds it to that. A process that dies
between the two leaves an attempt nothing closes, which says the one thing
worth saying: something was tried and nobody knows how it ended.

`audit_every_field_says_something` refuses an empty `intent`, `before`,
`result` or `reverse`. NOT NULL lets an empty string through, and an attempt
row is why that matters now: its `result` is written before the answer exists.

`audit_attempt` indexes `attempt` where it is set, which is the one question
both the pairing read and the orphan sweep ask.

**Append only, and enforced.** This table is what catches a mistake after the
fact, so two triggers guard it rather than a convention. `audit_append_only`
raises on every `UPDATE` and `DELETE`, in the same style as
`nodes_must_be_claimed`. `audit_never_truncated` raises on `TRUNCATE`, which
fires no row-level trigger and would otherwise empty the whole log in one
statement and leave nothing saying it happened. Neither stops `DROP TABLE`,
which belongs to role permissions once the worker owns a database user.

`audit_outcome_at` indexes `(outcome, at DESC)`, so the screen's two questions,
just the denials and newest first, come from one index.

## The needs-you queue

Three writers fill this table and one of them closes a row. The sweep in
`src/memory/sweep.ts` opens a `deadline` row per stale fact, and it is the only
thing that closes one, when the fact has stopped being stale. `raiseFailure` in
`src/worker/nightly.ts` opens a `question` row when the nightly run breaks.
`src/policy/act.ts` opens a `denied-action` row when the policy refuses an
action Shane has to decide about. Nothing else closes a row: ADR-0017's
re-confirm write moves `stale_after` and leaves the item open, and
`apps/web/lib/needs-you.ts` reads only the open ones.

`raised_for` records the `stale_after` a `deadline` row was raised for, and
the sweep opens nothing for a staleness a row already names, open or closed.
So one staleness raises one item, and the next raises a fresh one the night it
arrives. Closing an item without re-confirming the fact settles that review:
the fact returns when its `stale_after` moves, which is what re-confirming or
a hand edit does. The fact still reads stale on the review screen meanwhile,
because `factState` derives that from the dates and reads no item. Every kind
but `deadline` holds null here, and
`needs_you_raised_for_is_a_deadline` keeps it there.

Migration 015 replaced a thirty day snooze with this column. The snooze made a
fact reviewed more often than monthly wait out the difference before it could
raise again.

A `denied-action` row guards on the open items alone, which is the sweep's
`NOT EXISTS` shape over a different question. It matches the audit entry the
row names, on the same action and the same intent in the same space, so one
refusal repeating raises one item while the log still records every attempt.
Closing the item settles that refusal, and the next attempt opens a fresh one.
`raised_for` stays null here, as it does on every kind but `deadline`.

`audit` carries no target column, so two attempts on different targets that
share one intent string collapse to one item. The log still records both.
Narrow the guard when a target column arrives.

A denial the policy table failed to load raises nothing. `deny-by-default`
covers four failures, and only one of them, an action no rule describes,
judged the action. The other three ask an operator to repair the table, and an
item raised on one would name a rule that never fired. ADR-0021.

Four kinds wait on Shane: a draft to send, a question to answer, an action the
policy refused, and a deadline coming. The screen reads them as one list in
arrival order, so they share one table and one shape.

A denial names the audit entry that refused it, so the screen can show what the
policy said rather than only that something was stopped. A row may point at the
fact or the source it came from, and may point at neither.

Nothing here disappears. A row closes by setting `closed_at`, which is the same
rule retirement follows for a fact.

`questions` used to hold one of these four kinds and `006_needs_you.sql` drops
it. Every row on the screen shows a space and an entity, and `questions` held
neither. ADR-0012 records why the join that would have supplied them cannot
work.

## Chat history

`conversations`, `answers`, and `citations` hold what the chat screen reads.
Two things stay derived, so the database can never disagree with the code above
it. A conversation's token count reads from its answers rather than a stored
total. An answer crosses spaces when its citations came from more than one, and
`apps/web/lib/space.ts` holds that rule for the interface.

`answers` reads back by `asked_at`, never by `id`. An id only happens to track
the order rows arrived, and nothing makes the two agree.

A citation names a source and a chunk together, through one composite key into
`source_chunks (id, source_id)`. Naming a chunk from another source would open
the wrong text under the right title, which reads as a correct answer and is
not one. `edges` tolerates that mismatch because it predates chunking and
resolves it in code; this table carries no such history.

## What arrives over a webhook

`inbound_deliveries` takes a posted body verbatim and parses it no further.
The sender owns the shape, and a receiver that interprets on the way in loses
whatever it failed to understand. That is the rule `sources` already obeys.

The table is not nabium's. `source` names the sender, so a second sender needs
a value rather than a table. `(source, delivery_id)` is unique, and that pair
is the whole retry story: a sender repeating a delivery writes nothing twice.

`processed_at` is null while the work is owed, so the backlog is one query and
a crash loses nothing. `error` holds what went wrong, and a check refuses a
reason for a failure that has not happened.

ADR-0013 records why nabium sends the payload rather than a trigger, and why a
webhook is acceptable here where ADR-0008 refused one for Jira.

`src/worker/deliveries.ts` reads the backlog and ends each row.
`docs/runbooks/worker.md` says how to see what failed, and how to make the
worker try a delivery again.

## The connection and its credential

`migrations/016_connections_and_credentials.sql` creates two tables where one
would do, and the split is the security boundary. Every screen reads
`connections`. No screen reads `connection_credentials`, and holding the bytes
in their own table means `SELECT * FROM connections` returns no secret,
whoever writes the query. `src/connections/store.ts` keeps the same split in
code: `listConnections` names its columns and reports `hasSecret`, and
`secretFor` is the only function in this repository that returns a plaintext
secret.

**Whether a credential works is `verified_ok`**, added by
`migrations/031_verified_ok.sql` for KPA-107. It is null until the hourly
recheck has run, and null reads as unknown, not broken. `verified_at` holds the
moment of that check, because the recheck skips a credential checked in the
last 50 minutes and a date cannot measure that. A constraint sets the two
together or leaves both null. `setCredential` clears both with the verdict,
because a new secret has not been checked.

`apps/web/app/(app)/api/connections/route.ts` is the only route over these two
tables, and it imports `addConnection`, `listConnections`, `removeConnection`
and `setCredential`. It does not import `secretFor`, and
`test/connections-read.test.ts` reads every file under
`apps/web/app/(app)/api/` to hold that. A secret travels one way: the dialog
posts it, `setCredential` seals it, and no read carries it back.

**The address the mail comes from is `send_from`**, added by
`migrations/032_connection_send_from.sql` for KPA-158. KPA-143 had `name` do
both jobs, and it broke on 1 October 2026: the Name box asks what tells this
account from the next one, so the card was named `Sukkal Resend`, and Resend
refuses that as a `from`. The name is now the display name beside the address,
and the header reads `Sukkal Resend <no-reply@sukkal.app>`.

The column is nullable and carries a format check only. Nine of the ten
providers send no mail, and `sukkal_local` already held a Resend card written
before the column existed, so constraining the existing data would have failed
the migration on the one installation there is. Nothing is backfilled either: a
default of `no-reply@sukkal.app` is one installation's verified domain, not a
product-wide truth. **The check is a floor.** It proves one `@`, something
either side of it, a dot in the domain and no whitespace, and nothing about
whether the mailbox exists or whether a Resend card has an address at all.
`apps/web/app/(app)/api/connections/route.ts` is the trust boundary and refuses
both, because a route is what a request reaches and a browser check is a
convenience.

**A display name reaching a mail header is quoted and escaped, and a control
character drops the name.** `fromHeader` in `src/auth/reset.ts` is the one
place that builds the header. It wraps the name in double quotes and
backslash-escapes a backslash and a double quote, which is RFC 5322's
quoted-string; a comma, a colon and an @ need no escape inside one. A name
holding a carriage return, a line feed or any other control character is
**dropped in favour of the bare address rather than stripped**: stripping
leaves the rest of what somebody crafted in the header, where dropping leaves
no residue and still sends. A name that is empty after trimming is dropped the
same way. A missing name is therefore not a failure and a missing address is:
`deliver` logs and answers `ok: false` when `send_from` is null, because
nothing can go in `from`.

**Nothing is unique on provider alone.** Shane holds a Microsoft account at BHP
and another at Sydney Water. `UNIQUE (provider, name)` is what separates them,
and adding one provider twice is the normal case.

**The key is never in a column.** `src/connections/crypto.ts` seals the secret
with AES-256-GCM before it reaches the database, under a 32-byte key read from
`SUKKAL_SECRET_KEY`. ADR-0020 set the precedent for taking the algorithm from
node's own `crypto`: this repository has two dependencies, neither compiles,
and a credential store is a poor reason to add a third. pgcrypto was the
alternative, and it puts the key in the statement, which lands it in
`pg_stat_statements` and in any query somebody logs.

**Each row is sealed against its own connection id.** GCM refuses a ciphertext
that has been altered, and the id goes in as additional data, so bytes moved
from one row to another fail to open rather than pointing the Sydney Water key
at the BHP account.

`issued_on` and `expires_on` are calendar dates and come back as `YYYY-MM-DD`
text, which is what `src/db/connect.ts` tells the driver. Both are null on an
OAuth grant. `verified_on` and `verdict` are null together, and a check
constraint enforces the pair: a verdict with no date says nothing about now.
Retyping a secret clears both, because a new secret has never been tried.

**A connection may hold no credential, and migration 023 says so.** Claude by
subscription reaches Anthropic through the headless CLI, and every OAuth grant
reaches its provider without a key, so both write a `connections` row with no
matching row here at all. That absence is the statement: a row holding a null
secret is refused by the `NOT NULL` on `ciphertext`, and an empty one by the
length check. Read `hasSecret` rather than reading the absence as a fault. The
comment exists because a reader meeting `LEFT JOIN connection_credentials` has
no other way to tell a design from an oversight.

**`src/connections/verify.ts` is what fills `verified_on` and `verdict`.** It
names one authenticated call per provider, builds it as data, and takes its
fetcher as an argument, so a test drives every answer a vendor can give without
a network. The key travels in a header and never in a URL, which reaches the
vendor's access log and this project's own. A vendor that is down, a refused
key and a rate limit are three different verdicts, because the row is read by
somebody deciding what to do about it.

Three of the four probes cost nothing: they ask who the key belongs to.
Voyage publishes no such endpoint, so its cheapest authenticated call is an
embedding of one short string, and `Probe.cost` reads `metered` there. A
schedule reads that before it decides to check nightly. KPA-107 is that
schedule.

**Where a vendor publishes no expiry, the form asks for a term.** All four key
methods carry a `Review by` date beside the key, and the dialog refuses a blank
one along with every other empty field. The brief's rule is that a credential
nobody can date is a credential nobody renews.

## The account the installation signs in with

`users` holds the account as well as the owner. Migration 017 adds four
columns to the row `001_core_schema.sql` seeded, rather than a table beside
it, because an `accounts` table would give one person two masters and every
`owner_id` already points here.

| Column | Holds |
|---|---|
| `email` | The address somebody signs in with. Unique without regard to case |
| `assistant_name` | What the assistant is called |
| `password_hash` | What `src/auth/password.ts` wrote, in the PHC string format |
| `created_at` | When the account was made, which is not when the row appeared |
| `appearance` | The accent and chart colours the owner picked. Null until they pick one |

**All four are null, or none of them are.** `users_the_account_is_whole` says
so with `num_nonnulls`. A hash with no email signs nobody in, and an email with
no hash is an account anybody may claim, so the setup wizard writes all four in
one statement. `email IS NULL` is therefore the question "has this installation
been set up", and it is the question the wizard asks before it refuses to run
twice.

**The seeded row is the account, unclaimed.** Four tables default `owner_id` to
id 1, so deleting that row or replacing it would refuse every insert made
before somebody runs the wizard. It keeps its id and gains four nulls instead.

**A row this migration did not seed stops it.** The guard reads `id <> 1`,
which is one condition covering both a second row and a row that is not the
seed, and it raises rather than leave an owner with a null email nobody can
sign in as. Inventing an address is the guess the vault's own rule forbids.

**`password_hash` is `text`, never `varchar(n)`.** An encoded hash is 88
characters at today's cost:

```
$scrypt$ln=17,r=8,p=1$<22 chars of base64>$<43 chars of base64>
```

The length moves with the cost, the salt and the key size, and ADR-0020 records
that raising the cost is expected. A width taken from today's 88 characters
would refuse a hash the same module wrote a year later.
`users_password_is_hashed` checks the shape instead, as four dollar signs. That
is what every PHC string carries, an argon2 hash included, so it refuses a
typed password without pinning the algorithm ADR-0020 leaves room to change.

**The email is unique through an index on `lower(email)`, not through
`citext`.** citext needs `CREATE EXTENSION`, which needs a superuser:
`provision-amaterasu-root.sh` installs pgvector through `su - postgres` for
that reason, so a second extension is a second root step on every installation
somebody else runs. The cost of the index is that every read has to spell
`lower(email)`. A query written as `WHERE email = $1` misses the index, and
misses a row somebody typed in another case.

**The index cannot bind while `users_one_owner_per_installation` holds.** That
constraint is `CHECK (id = 1)`, and one row holds one address. The index is
there for the lookup sign-in makes, and for the day a second owner arrives.

**One owner per installation is ADR-0009's hedge, not a second guess at
"single user".** `users.id` exists so that a second owner costs no migration of
the four tables defaulting `owner_id` to it. The check constraint is what a
second owner does cost: one line, dropped deliberately.

**The first boot asks for the account again.** `kpa.account` in the browser
holds a name, an email, an assistant name and a created date, and no password.
An account carried across would arrive without the one field that signs anybody
in, so the wizard runs regardless. ADR-0022 records that as a consequence of
ADR-0009 rather than a preference.

**The colours the owner picked are one `jsonb` column, not four.** Migration
019 adds `appearance`. ADR-0022 rules that an accent belongs to the person
rather than to the device, so `kpa.accent`, `kpa.accent.hex`, `kpa.charts` and
`kpa.charts.hex` move here. The three reasons the ADR gives for one column all
hold: the four values change together, because the settings screen writes them
from one selection; nothing filters, joins or orders by an accent; and the set
grows with every preset family added later.

**`appearance` joins no whole-account constraint.**
`users_the_account_is_whole` counts four columns and this is not one of them,
so somebody may pick a colour on a box nobody has set up, and an account
written without a colour is whole.

**The column refuses a number, a string and an array.**
`users_appearance_is_an_object` names the three shapes that could never carry
four fields. It stops there rather than naming the fields, because the field
values are preset ids that live in `apps/web/lib/appearance.ts` and change with
the presets. `isSelection` in that file is the check that knows them, and the
route calls it before it writes.

**`kpa.appearance` stays in the browser.** It is the resolved token blob
`apps/web/components/appearance-bootstrap.tsx` reads before React runs.
Measured on 3 September 2026: on a load that holds the blob the accent is
applied 30 to 40 ms before first contentful paint. A device that holds none
paints the stylesheet's own green once and the right colour from the second
load, which is the trade ADR-0022 accepts.

## The workspace and project tree

`migrations/018_workspaces_and_projects.sql` moves the tree out of
`apps/web/lib/workspaces.ts`, a hand-written constant, and out of the React
state the sidebar's plus button writes to and the next page load throws away.
The migration seeds the three workspaces and the six projects that constant
holds, as `005_policy_and_audit.sql` seeds the four policy rules.
`test/workspaces.test.ts` compares the rows against the constant field by
field, so the two cannot drift apart in silence. Every screen still reads the
constant, and slice seven is where the table replaces it.

**The identifier is the slug, and the name is a column beside it.** This
settles the second question KPA-53 left open. The interface files a custom
field under the workspace name today, so renaming `Koinon Engineering` orphans
every field filed under it. `workspaces.id` holds `koinon-engineering`, which
is already the route the sidebar reaches the row at and already what
`isWorkspace` compares. `policies.key` is the precedent for a text primary key
that means something, and a surrogate `bigint` would leave two identifiers to
keep in step. What the choice costs is a rule no constraint can hold: the slug
is derived from the name once, when the row is created, and never again.

**A project matches one way, never neither and never both.** Collibra runs
every engagement through one Jira project, so `match_label` says which
engagement an issue belongs to. Koinon Engineering gives each project a Jira
project of its own, so `match_key_prefix` says it instead. `ProjectMatch` in
`apps/web/lib/workspaces.ts` is a union of the two, and
`num_nonnulls(match_label, match_key_prefix) = 1` is that union written as a
constraint. A prefix is upper case because a Jira key is, and a lower case one
would match no issue and report nothing.

**No workspace sits in `shared`.** The `space` enum has held four values since
migration 001, and ADR-0018 gave the fourth to the interface, so `Space` and
`SPACE_LABELS` know it now. It still names no world a Jira tracker belongs to.
`shared` is the space the wall does not divide, and a workspace filed there
would show its issues on both sides of the one wall the brief asks for. A
workspace the plus button adds names no space at all, and the column defaults
to `personal`, which is the answer `spaceOf` already gives for a workspace
nobody has heard of.

Both ids are slugs, in the shape `slug()` writes in `nav-projects.tsx`: lower
case, digits, and single hyphens between them. The id is the route, so a space
or a slash in it breaks the address and a check refuses both. A project id is
unique across every workspace rather than within one, because `/projects/mp`
carries no workspace in the path.

**The contract sits on the project row, and each of its two dates says where
it came from.** `migrations/020_project_contract.sql` adds a description, a
`contract_start`, a `contract_end`, and a `contract_date_source` beside each
date. Salesforce holds the contract through Certinia PSA, and a sync writes
over the dates it wrote before and leaves the dates Shane typed. One column
covering the pair cannot say that, because a start Shane typed beside an end
the sync read is the ordinary case. Two columns make the rule a `WHERE` clause
rather than a convention:

```sql
UPDATE projects
   SET contract_start = $2, contract_start_source = 'salesforce'
 WHERE id = $1 AND contract_start_source IS DISTINCT FROM 'typed';
```

`IS DISTINCT FROM` carries the third answer, which is a date nobody has set. It
names no source, and the sync fills it. A date and its source are null together
or set together, on the terms migration 016 gives a credential's `verdict` and
its `verified_on`, and a check refuses an end before a start.

**No column default starts a label as the project key.** KPA-96 asks for one
and PostgreSQL refuses it. A default cannot name another column, so `id` cannot
be one, and a constant default breaks every project matched by a key prefix,
because `projects_match_one_way` allows one rule per row. Migration 018 answers
the same question a second way: it requires the rule at insert, and the seed
gives every label-matched project a `match_label` equal to its `id`. `readProjects`
in `apps/web/lib/tree.ts` applies the same rule to a row whose `match_label` is
null, so the browser's guess became the server's. The settings form still
offers a label box on every project, and `writeProject` drops what it holds on
a project matched by its key prefix, because `projects_match_one_way` would
refuse the row.

## A workspace's custom fields

`migrations/021_workspace_fields.sql` holds the fields a workspace carries and
the Jira field each one writes. `apps/web/lib/workspace-fields.ts` kept the
list in `localStorage` under the workspace name, so a rename orphaned it. Each
field now files under `workspaces.id`, which migration 018 made stable for
this.

**Two identifiers, and neither derives the other.** `id` is the slug an issue
files its value under, and `jira_id` is what a write to the tracker names. The
Collibra site offers two custom fields called `Customer`, so a name chooses
between them by luck and the losing choice writes to a field nobody reads.
`fieldId()` lower-cased a name into an id, nothing called it, and KPA-97
deleted it. `workspace_fields_jira_id_is_a_custom_field` refuses a slug in the
column that has to hold the tracker's id, which is the one typo that would
otherwise be silent. Two slugs pointing at one Jira field are refused as well:
the second write would win and no screen would show which lost.

**Required is a column, so the rule is a query.** `missingFields` filters a
list the browser holds, and `issue-dialog.tsx` refuses to file an issue while
it returns anything. The column answers the same question in SQL:

```sql
SELECT id FROM workspace_fields
 WHERE workspace = $1 AND required
   AND coalesce(btrim($2::jsonb ->> id), '') = '';
```

An absent key and a blank string both count as unfilled, which is what the
browser's `.trim()` means. The interface still filters the list in
`missingFields`, and it now filters a list it read from this table. The query
above is the same rule, and it is what a caller with no browser will ask.

**The seed is the fixture, and its two Jira ids are real.**
`WORKSPACE_FIELDS` in `apps/web/lib/fixtures.ts` gives Collibra two fields and
the other two workspaces none, and migration 018 seeded its tree on the same
reasoning. The fixture carries no Jira id, so both were read from the Collibra
site's own field list. A workspace with no row carries no fields.

`apps/web/app/(app)/api/workspace-fields/route.ts` refuses a field whose
`jiraId` is not `customfield_NNNNN`, so a catalogue entry with no tracker id
cannot be saved. `JIRA_FIELDS` in `apps/web/lib/fixtures.ts` carries no tracker
id on any of its eleven entries, so only the two seeded fields can be edited
today. The scan that fills the catalogue is the worker's.

The reference removes the fields when the workspace goes, where `projects` has
no `ON DELETE` clause at all. A project is work in its own right, so a
workspace still holding one cannot be removed. A field list is a property of
the workspace and means nothing without it.

**A project route edits its workspace's list.** KPA-140 ruled it on
3 September 2026, and `apps/web/lib/route-workspace.ts` is the rule.
`/projects/bhp-meridian/settings` resolves `bhp-meridian` to `collibra` and
edits the two rows above. A project carries no field list of its own, so this
table needs no project column and no rule for a field defined twice.

The screen names the workspace it edits, in the heading and again in the lede,
because a shared list edited from a page named after one project is what the
ruling designs out. Before it, the screen passed the project's display name the
whole way down: `workspaceNamed` answered nothing, the name passed through as
the key, and the screen showed an empty list and wrote where nobody reads.

## The issues a tracker owns

`migrations/022_issue_cache.sql` caches the issues the interface reads from
`ISSUES` in `apps/web/lib/fixtures.ts` today. A row is keyed by the workspace
and the tracker's own key, so two sites may both hold an `MP-1`. The workspace
is `workspaces.id`, the slug migration 018 made stable, and never the name.

**The table is a cache and never a master.** ADR-0007 leaves the text with the
tracker and converts at the boundary. The comment on the table says so, and
`issues.updated` is what makes it true: a write reads that stamp, refuses when
it has moved, and hands the conflict back to a person. Drop the stamp and the
cache becomes the second master ADR-0007 exists to prevent.

**Three stamps, and each answers its own question.** `updated` is what the
tracker last changed. `fetched_at` is when this cache last read the issue.
`seen_at` is when a listing last named the key. `updated` is a moment rather
than a calendar date, because a stamp resolved to the day refuses no write made
later the same day, and ADR-0008 already polls in minutes. `start` and `due`
stay `date`.

**A deleted issue needs `seen_at`.** ADR-0008 polls on `updated >= the last
run`, and a deleted issue appears in no such answer. `fetched_at` finds it no
better: nobody edits a quiet issue, so no poll fetches it, and an old
`fetched_at` says the issue is quiet rather than gone. A second sweep lists
every key the tracker still holds and stamps each row it names:

```sql
UPDATE issues SET seen_at = now()
 WHERE workspace = $1 AND key = ANY($2::text[]);
DELETE FROM issues WHERE workspace = $1 AND seen_at < $2;
```

The second `$2` is the moment the sweep started. A row the listing skipped
keeps the older stamp, and the `DELETE` removes it. A run that fails before the
second statement deletes nothing, so the listing may page.

**The parent rule is a foreign key, because a check reads one row.** An epic
has no parent, which `issues_an_epic_has_no_parent` holds. A sub-task's parent
is a story, which reads the parent row, and a `CHECK` reaches no second row.
`parent_kind` is generated from `kind` and holds what the parent must be, which
is `PARENT_KIND` in `apps/web/lib/types.ts` written as a column. The reference
names `(workspace, parent, parent_kind)` against `(workspace, key, kind)`, so
the parent exists and is of the one kind the rule allows. An epic generates
null, which leaves the reference unchecked, and the check refuses its parent
instead. A trigger was the other answer and it takes two: one on the child, and
a second refusing a parent whose kind changes under it.

The reference is deferrable, so one poll writes a batch in the tracker's own
order inside one transaction. What it costs is a child whose parent the cache
does not hold: that row is refused outright, so a workspace fills whole before
the poll asks for changes.

**A link is stored once, from the blocker.** `Issue.blocks` holds the keys an
issue blocks, and "blocked by" is a read of the other column. Two rows per link
invite the pair to disagree, and no reader could then say which half was right.
Jira puts the truth at the inward end of its own link. A check refuses a
self-link, and both ends reference `issues`, so removing an issue takes its
links.

**The description is stored as the tracker sent it.** ADR-0007 rejects markdown
as lossy, so the column is `jsonb`: Jira sends ADF, which is JSON, and Linear
sends markdown, which `jsonb` holds as a JSON string. `Issue.description` is
the plain string the editor binds to, and the adapter converts between the two.

**A cache may not refuse what the tracker accepts.** Jira takes a due date
before its own start date, so no check compares the pair, where migration 020
compares the contract's two dates. Three rules are the exceptions, and each
refuses a row Sukkal wrote wrong rather than a row Jira holds: the key is upper
case in the shape `projects.match_key_prefix` compares, the title says
something, and `fields` is a JSON object rather than an array.

## A write the tracker has not accepted

`migrations/028_issue_write_queue.sql` holds it. ADR-0007 asks for it in as
many words: Postgres gains no issues table anything treats as true, but a cache
carrying the tracker's own stamp and a queue for writes the tracker has not yet
accepted.

**Why a queue at all.** Every field on the issue detail page lands as it is
made, with no save button, and the bulk bar writes many rows at once. A dropped
connection with no queue loses the edit in silence, and the screen then shows a
value Jira never received.

**A conflict keeps both stamps.** ADR-0007 leaves the merge to a person,
because Sukkal cannot guess how two descriptions combine, and a person deciding
needs to see what the write expected and what the tracker actually had. One
number says a write was refused; two say why.
`issue_writes_a_conflict_names_both_stamps` refuses the first without the
second, and `issue_writes_only_a_conflict_observed_a_stamp` refuses the second
without a conflict.

**A successful write moves to `sent` rather than being deleted.** The row is
the record that Sukkal changed somebody else's issue, and a queue that empties
itself on success can only ever show failures. Old rows are prunable, which is
where this differs from `audit`.

**A comment never comes through here.** ADR-0007 writes one straight through,
because a comment is append-only in practice: nothing about it can conflict, so
nothing about it needs a stamp. `issue_writes_carry_no_comment` refuses a patch
naming one rather than leaving that to whoever writes the next caller.

**One issue may hold several queued writes**, in the order they were made,
which is what the identity key gives. A unique row per issue would drop the
second edit of the same field.

**A trap the sender owns, and the schema cannot close.** Three edits made from
one screen all carry the stamp that screen read. The first succeeds and the
tracker's stamp moves, so the other two now expect a stamp that has passed and
both conflict, against a change Sukkal itself made. Whatever sends these has to
carry the new stamp forward to the issue's remaining queued rows. A constraint
cannot: it would have to know which writes were the same person's, and a
conflict is exactly the case where guessing is what ADR-0007 refuses.

## The sprints a tracker runs

`migrations/027_sprints.sql` holds them, and the reference migration 022 left
for it. That migration cached an issue's `sprint_id` and said "no reference,
because no table holds a sprint yet".

**It is a cache, like `issues`, and never a master.** ADR-0007 leaves the
tracker owning its own data, so `state` is the word Jira uses rather than
something derived from the dates. A sprint closed early keeps a future end
date, and one nobody has started keeps a past start date. Deriving the state
would overrule the tracker on its own sprint.

**A sprint is unique inside its workspace and nowhere else**, which is the rule
`issues` already keeps for a key. Two Jira sites both number a sprint 41, and
the fixture has all three workspaces running all three sprints for that reason.

**One active sprint per workspace, held by a partial unique index.**
`CURRENT_SPRINT` in `apps/web/lib/fixtures.ts` found the active one with
`Array.find`, and KPA-99 asks that the same answer come from a query. A query
returning two rows has nothing to give the screen, so the index is what makes
the single row a fact rather than a hope:

    CREATE UNIQUE INDEX sprints_one_active_per_workspace
      ON sprints (workspace) WHERE state = 'active';

Every other state repeats as often as the tracker likes, because a board holds
many closed sprints and several planned ones.

**Null is the backlog, and MATCH SIMPLE is what keeps it so.** The reference
names two columns, and the default match rule satisfies a composite reference
whose parts are not all set. `issues.workspace` is NOT NULL and `sprint_id` is
not, so an issue in no sprint is checked against nothing. That behaviour is
stated by the absence of MATCH FULL rather than by a second constraint.

**The reference defers**, for the reason the parent reference in 022 already
does. A poll returns issues and sprints in the tracker's own order, so one
transaction writes both in any order and the check runs at COMMIT. Without it,
whichever arrived second would decide whether the batch was refused.

**`ON DELETE SET NULL` names its column.** A sprint that leaves the tracker
returns its issues to the backlog rather than taking them with it, and a bare
`SET NULL` would try `workspace` too, which is NOT NULL.

**An end before a start is refused, and the same day is not.** A one-day sprint
is a real thing, and refusing it would refuse a row the tracker holds.

## What carries a proved sign-in

`migrations/024_sessions.sql` holds one row per sign-in. ADR-0023 makes the
application the only gate on every installation, so this row is the whole of
what stands between somebody and three mailboxes holding employer customer
material.

**The token is not in the table.** `id` holds a SHA-256 of the token the
browser carries, so a copy of this table signs nobody in. That is the rule
`docs/runbooks/secrets.md` keeps for every other secret, and KPA-79 states it
again for a reset token.

**SHA-256 rather than scrypt, and the reason is not speed.** ADR-0020 chose
scrypt at 128 MiB for a password, because a person picks one and picks badly,
so an attacker holding the hash runs a dictionary. A session token is 32 bytes
from `randomBytes`. There is no dictionary, and no work factor makes 256 bits
easier or harder to guess. Hashing defends the stolen-database case, which is
the only case there is.

**The lifetime is absolute and it does not slide.** `LIFETIME_DAYS` in
`src/auth/session.ts` is fourteen, and KPA-77 required that number to be chosen
rather than defaulted. Nothing moves `expires_at` after the row is written,
because a sliding window renews a session on use and use is exactly what a
thief does. A fortnight is long enough that nobody types a password often, and
short enough that a stolen cookie dies inside one.

**Revocation is a delete.** Signing out removes the row, so a browser that
keeps the cookie finds nothing behind it. There is no `revoked_at`, because a
row that must be read to be known dead is a row somebody forgets to read.
`endAll` removes every session an owner holds, which is what a password reset
calls: KPA-79 is a thing somebody does after losing control of the account, and
leaving the thief's session open would make it theatre.

**`sessions.owner_id` carries no default, where four other tables do.** ADR-0009's
hedge defaults `owner_id` on `facts`, `meetings`, `sources` and `tasks`,
because those rows belong to the one owner and the default saves every writer
naming them. A session is created by one sign-in for one person, so `issue`
always names whose it is. A default there would let a bug write somebody else's
session as the owner's.

**`apps/web/proxy.ts` is the gate, and it denies by default.**
`lib/public-paths.ts` names what a request reaches without a session, and every
path absent from that list is refused, so a route added next month is guarded
by having been added. `test/routes-are-guarded.test.ts` walks the routes on
disk against that rule and fails on one that is neither guarded nor listed.
Next.js 16 renamed the convention from `middleware.ts`, and Proxy defaults to
the Node.js runtime, which is what lets the gate ask the database rather than
merely notice a cookie.

**The gate is not the only check.** Next's own documentation warns that a
matcher change or a moved Server Function can silently remove Proxy coverage,
and says to verify inside the handler. `requireOwner` in `lib/session.ts` is
that second check. Two gates, and neither assumes the other held, which is the
shape ADR-0023 chose for Access and for the same reason.

## A grant that has left and not come back

`migrations/029_oauth_grants.sql` holds it. KPA-103 runs one grant for every
provider that offers one, from a record in `src/connections/oauth.ts` holding
the urls and the scopes, so a fourth provider is a record rather than a route.
Two values have to survive on the server between the moment the browser leaves
and the moment the provider redirects it back.

**Neither may wait in the browser.** The state proves the answer belongs to the
request that asked, and a state the browser holds is a state an attacker can
plant. The verifier is worse: PKCE exists because the authorization code alone
can be stolen, so a verifier stored beside the code protects nothing.

**The state is not in the table.** `id` holds a SHA-256 of it, the rule
`sessions` and `password_resets` already keep. A copy of this table completes
no grant, because the reader learns a hash and the provider redirects with the
value.

**The verifier is stored as it is**, because the token request has to send it
and nothing recovers it from a hash. It is safe beside a hashed state: whoever
reads this table cannot produce the state, so the verifier reaches no exchange.
The row also dies in ten minutes.

**Single use is a delete.** `claim` runs `DELETE ... RETURNING`, so two
callbacks carrying one state race for a row only one of them gets. A replayed
callback is exactly what the state exists to refuse.

**Two secrets meet here and they live apart.** `GOOGLE_OAUTH_CLIENT_ID` and
`GOOGLE_OAUTH_CLIENT_SECRET` identify Sukkal to Google and sit in the environment,
because the callback needs them before any connection row exists. What the
grant returns belongs to one account, so it goes through
`src/connections/crypto.ts` into `connection_credentials`.
`docs/runbooks/secrets.md` records the split.

**Microsoft has no record, and the brief is why.** All three mailboxes are
Google, so the Microsoft surface is customer tenants where Shane is a guest,
and the brief rules that access out. A record for a grant nobody may run is a
button that fails on press.

## What carries a forgotten password back

`migrations/025_password_resets.sql` holds one outstanding reset. ADR-0023
makes the application the only gate, so no second gate can let anybody back in,
and ADR-0009 named the harder half: a fresh installation has no mail relay, so
a link has nowhere to go.

**The token is not in the table**, for the reason `sessions` gives above. A
token readable in the database is a password readable in the database, and the
reset flow exists because the password was lost.

**Single use is a delete, and the delete is the claim.** `spend` in
`src/auth/reset.ts` runs `DELETE ... RETURNING`, so two requests carrying one
token race for a row only one of them gets. A `used_at` column would have to be
read to be known spent, and a read somebody forgets is a token that works
twice.

**One live token per owner**, held by `password_resets_one_per_owner` rather
than by remembering to delete first. Asking twice replaces the key rather than
leaving two under the mat, so a stranger asking repeatedly leaves one row and
never more. That is also why there is no sweep and no index: the next request
replaces what expired, and `spend` refuses it in the meantime.

**An hour**, which is what `forgot-password-form.tsx` has promised since
KPA-37. `LIFETIME_MINUTES` in `src/auth/reset.ts` holds the number. It is short
because the account is already in a state where control is in question.

**Spending one ends every session.** `setPassword` calls `endAll`, so a reset
closes the browser somebody else was signed in on. `POST /api/account` calls it
too when the wizard writes a password again.

**The way in on a box with no mail is `scripts/reset-password.sh`.** It sets a
password directly, or `--link` mints a token and prints the address that spends
it. Being at that shell is the proof: somebody who can run it can already read
this database and the key that opens every stored credential.

**Resend sends the mail, since KPA-143.** `mailSender` names which configured
connection would carry it and `deliver` carries it, which is what KPA-79 asks
for: a relay read out of the environment is a credential nobody can see on the
Connections screen, nobody dates, and `src/connections/verify.ts` cannot check.
The Resend key is a sealed credential like every other, so the screen shows it,
the row dates it, and the hourly recheck verifies it.

**The key is scoped to sending only, and its refusal is what verifies it.** Sukkal
calls one Resend endpoint ever, `POST /emails`, so nothing needs a key that can
list, create or delete a Resend resource. Such a key cannot answer the probe's
`GET /api-keys`, and Resend refuses it with 401 `restricted_api_key`, "This API
key is restricted to only send emails". A key has to authenticate to earn that
sentence, so `verified_ok` reads true on it.

`Probe.alive` in `src/connections/verify.ts` is what carries that rule, and it
matches on the status as well as the name. Resend documents
`restricted_api_key` twice, at 401 for a send-only key and at 403 for "API key is
not active", so the name alone would write `verified_ok = true` for a deactivated
key. Only Resend sets `alive`, so the other four probes never read a body.

**A box with no Resend connection behaves exactly as it did.** `deliver` returns
`ok` when no sender is configured and logs the command line instead, so the
screen answers what it always answered. That is the second criterion on KPA-143
and it is why `ok` reads true rather than false on that path.

**Resend outranks Gmail and Outlook in the query**, through
`ORDER BY (c.provider <> 'resend'), c.created_at, c.id`. Ranking by
`created_at` alone would let a box holding both pick the Gmail card, which
cannot send: a Gmail or Graph send needs the OAuth mail scopes KPA-103 and
KPA-105 carry and neither has landed. Revisit the ranking when a second sender
can actually send.

**The mail carries the link and nothing else.** No address, no name, no token in
any log line. A reset mail that named the owner would confirm the address to
whoever received it.

## What a guessing attack costs

`migrations/026_sign_in_attempts.sql` adds `users.sign_in_failures` and
`users.sign_in_failed_at`, and one row to `policies`.

**A delay, never a lock.** ADR-0024 decided it. KPA-78 names the hazard
running both ways: an
attacker needs one password, and a lockout on the only account is a denial of
service against the only person who can use the system, with nobody to lift it.
So a run of failures buys a wait in front of the next attempt, the wait grows
to a ceiling of eight seconds, and a correct password works at every point in
the run. Nobody is ever shut out, so nothing has to expire before Shane can get
in: the run is forgotten fifteen minutes after the last failure, which is a
tidy-up rather than a release.

**Why eight seconds is enough, measured rather than assumed.** One `verify`
costs 171 ms at ADR-0020's cost, and eight in parallel take 378 ms because
node's scrypt runs on a four-thread pool. The door already answers about six
guesses a second and never runs more than four hashes at once. Against
`lib/password.ts`'s rules, sixteen characters with a capital, a number and two
marks, no online rate is a threat. The wait keeps a flood off that pool and
puts every attempt in the log; it does not make a strong password stronger.

**One counter for the installation, whatever address was typed.** An
installation has one account, so a failure against an address nobody holds is a
failure at this door. Counting only the known address would leave the throttle
behind a name an attacker can simply not type, and it would tell them which
name that is.

**Two columns rather than a table.** KPA-78's file list guessed at a table, and
a table keyed by `owner_id` as its primary key is a second row that exists
whenever the first does, reached through a join and inserted before it can be
updated. `sessions` and `password_resets` earn their own tables because there
are many of each. There is exactly one counter.

**The pair moves together.** `users_a_failure_run_carries_its_moment` makes the
count and the moment both set or both null, because a count with no moment
cannot be forgotten and would slow every sign-in for good.

**Every sign-in reaches the audit log.** KPA-78 asks for it and gives the
reason: a sign-in is the highest-value event on the box. `audit` refuses a
denial that names no rule, so authentication gets a row in `policies`, the way
the engine's own default did in migration 012. `auth.sign-in` is a sixth row
and not a sixth rule: the four the brief names describe what Sukkal may do, and
`src/policy/engine.ts` never reads this one, because `decide` matches a
proposal and nothing proposes a sign-in.

**The log may name what the answer may not.** A refused sign-in says one
sentence to the browser, and the row says whether the address existed and how
long the run is. The typed address is kept, trimmed to 200 characters, because
an address nobody holds tried a hundred times is the shape of an attack, and
the log is where that shape shows.

**`src/auth/attempts.ts` writes those rows, and `src/policy/act.ts` names it.**
`act` is the one path to an *outbound* action, and a sign-in reaches nothing
outbound, so it needs no Permit and no verdict.

## The queue lives in its own schema

Migration 011 creates the schema `pgboss` and nothing inside it. pg-boss owns
every table there: it creates them the first time the worker starts, and it
migrates them between its own versions.

The worker is built with `createSchema: false`, so the schema has one owner.
A worker started against a database nobody migrated stops with a missing
schema rather than installing one no ledger records, which is the answer the
migration runner already gives when it finds a database it did not create.

Reversing migration 011 drops the schema and every queued job with it. That is
deliberate, and it happens only on the way to an empty database.

## The entity a fact concerns

`facts.entity` and `needs_you.entity` are both nullable text, and neither is a
foreign key into `entities`. ADR-0014 records why.

`entities` exists and holds no rows. The vault's frontmatter carries no entity
field at all: a note's type, title and tags only imply who it concerns, and
resolving that is reserved for the slice that ingests a second source of
people. Eight callers insert a fact today and none names an entity, so a
`NOT NULL` column would reject every one of them.

**`needs_you.entity` had to follow, and that is the half worth knowing about.**
It was `NOT NULL` when the queue was built. The sweep reads `facts.entity`
straight into it, so one due fact naming no entity failed the whole insert and
the run raised nothing at all. Not a row lost, every row lost, on a job that
exists so Shane sees what is waiting. A constraint no writer can satisfy is a
constraint against the product.

Reversing migration 010 leaves `needs_you.entity` nullable rather than
restoring the constraint, because rows the sweep already raised would violate
it, and the only ways round that are to invent a value or to delete a review
item.

## The frontmatter mapping

`src/vault-mapping.ts` holds it, and `test/schema.test.ts` fails on any key a
note in a space carries and the mapping does not. That test runs against the
real vault, so a schema gap is found before ingestion rather than after.

Notes under `sources/` are excluded. They store verbatim in `sources.body` and
keep whatever frontmatter they arrived with, so they have no schema to fit.

## Three decisions a reader would otherwise question

**`facts.path` is not in the PRD's column list.** It is here because a wikilink
resolves against a note's file name, and `title` is prose. Without `path`
nothing can turn `[[a-note]]` back into a row. This is a schema gap the mapping
work found, recorded rather than quietly added.

**`facts.description` carries no length constraint**, though the vault's
convention says under 200 characters. `check.py` reports an over-length
description and migrates the note anyway. A constraint here would reject where
the old system continues, and KPA-13 verifies the migration by diffing the two
reports, so they have to agree.

**`entities.kind` is `text`, not an enum.** Nothing populates the table this
slice. An enum invented before there is a row to put in it is a guess, and this
schema is meant to record what is known.

The same reasoning leaves `verified` set without `verified_by` unconstrained.
`check.py` raises it as a problem and continues, and KPA-11 ports that message
unchanged. A constraint would turn a report into a failure.

## The registry, and what it enforces

`docs/adr/0007-a-node-registry-for-edges.md` carries the reasoning. In short,
three constraints hold the invariant and they cover different directions.

1. Each child table's `node_kind` column is fixed to its own value by a check,
   so `facts` can only claim a node of kind `fact`.
2. A composite foreign key into `nodes (id, kind)` stops one id being claimed by
   two child tables.
3. A deferred constraint trigger, `nodes_must_be_claimed`, rejects at commit a
   `nodes` row of kind `fact`, `source` or `entity` with no child row. Deferred,
   so the two inserts may run in either order inside one transaction.

## The embedding width

`src/embedding.ts` names the model and the dimension, and both vector columns
declare that width. **Changing either is a migration**, not a configuration
change: the existing vectors are the wrong width and the wrong model's output,
so they have to be rebuilt. A test asserts the schema and that file agree.

Today: `voyage-4` at 1024 dimensions.

## Applying it

```
npm run migrate          # applies to DATABASE_URL
npm run migrate down     # reverses it, leaving the database empty
```

The down migration removes children before the registry, and leaves the
`vector` extension alone, because `scripts/provision-amaterasu.sh` installed it
and this migration did not.
