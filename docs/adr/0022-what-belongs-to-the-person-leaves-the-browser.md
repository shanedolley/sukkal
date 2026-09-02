# What belongs to the person leaves the browser

Eight of the nineteen browser keys move to the server and eleven stay. Decided
by Shane on 3 September 2026.

Slice four builds the application data schema, and every story in it assumes an
answer to this. Without the answer the display keys get migrated by reflex and
the schema gains columns nobody reads.

## The test

**Does this belong to the person, or to the device they happen to be on?**

That question settles almost every key. The obvious alternative asks whether a
value is data or a preference, and it argues forever: a chosen accent colour is
plainly a preference and it should still follow Shane to his phone, while the
resolved token blob is plainly data and it should stay on the machine that
resolved it. The data question sorts by what a value looks like. The person
question sorts by who it belongs to, which is what a second device actually
tests.

## The nineteen keys

Eighteen carry the `kpa.` prefix. The nineteenth is `theme`, which
`next-themes` writes under its own default key.

| Key | File and line | Verdict | Why |
|---|---|---|---|
| `kpa.account` | `apps/web/lib/account.ts:32` | Server | ADR-0009 makes the installation own its account, and KPA-76 hashes a password with no row to put it in |
| `kpa.connections` | `apps/web/lib/connections.ts:43` | Server | KPA-101 puts the credential on the server, and a connection whose secret is server-side and whose identity is browser-side has two masters |
| `kpa.project.settings` | `apps/web/lib/project-settings.ts:41` | Server | Contract dates arrive from Salesforce through Certinia. That is data from outside, not a preference |
| `kpa.workspace.fields` | `apps/web/lib/workspace-fields.ts:28` | Server | A mapping to Jira field ids describes an external system rather than this browser |
| `kpa.accent` | `apps/web/lib/appearance.ts:186` | Server | A chosen accent is a person's taste, and it should follow them to a second device |
| `kpa.charts` | `apps/web/lib/appearance.ts:187` | Server | The same choice, made over the chart ramp instead of the menu |
| `kpa.accent.hex` | `apps/web/lib/appearance.ts:195` | Server | The colour behind the custom preset. It is one half of the same choice and cannot travel without it |
| `kpa.charts.hex` | `apps/web/lib/appearance.ts:196` | Server | The same, for the chart ramp |
| `kpa.appearance` | `apps/web/lib/appearance.ts:193` | Browser | The resolved pre-paint cache. `components/appearance-bootstrap.tsx:28` reads it before React runs, and a network read there flashes |
| `kpa.space` | `apps/web/lib/space-context.tsx:24` | Browser | A filter is a view, and this one defaults to `all` |
| `kpa.issues.group` | `apps/web/components/issues/issue-list.tsx:1046` | Browser | Table furniture. Which field the rows group by |
| `kpa.issues.subgroup` | `apps/web/components/issues/issue-list.tsx:1051` | Browser | Table furniture. The second grouping field |
| `kpa.issues.grouporder` | `apps/web/components/issues/issue-list.tsx:1066` | Browser | Table furniture. Whether groups sit in their own order or one somebody dragged |
| `kpa.issues.groupsort` | `apps/web/components/issues/issue-list.tsx:1087` | Browser | Table furniture. Which key orders the groups |
| `kpa.issues.arranged` | `apps/web/components/issues/issue-list.tsx:1102` | Browser | Table furniture. The dragged order itself |
| `kpa.issues.sort` | `apps/web/components/issues/issue-list.tsx:1115` | Browser | Table furniture. Which key orders the rows |
| `kpa.issues.tree` | `apps/web/components/issues/issue-list.tsx:1176` | Browser | Table furniture. Whether children nest under parents |
| `kpa.issues.hidden` | `apps/web/components/issues/issue-list.tsx:1220` | Browser | Table furniture. Which columns are hidden |
| `theme` | `apps/web/components/providers.tsx:13` | Browser | Light or dark should follow the room somebody sits in, not the person |

Two rows need a note on where to look.

`theme` is never written as a string in the provider. `providers.tsx:13` mounts
`ThemeProvider` and passes no `storageKey`, and `next-themes` 0.4.6 defaults
that to `theme`. The one place the repository writes the name is
`components/appearance-bootstrap.tsx:30`, where the pre-paint script reads it.

Every `kpa.issues` key is declared in `issue-list.tsx` and nowhere else. No
other component holds one. Only `kpa.issues.arranged` appears again in the same
file, at lines 1141 and 1157.

## The eight that move

**`kpa.account`.** ADR-0009 makes the installation authenticate rather than
assume the network did. `account.ts:11` says the browser keeps no password,
which is honest about storing nothing and useless for signing in. KPA-76 is
done and hashes a password that has no row to sit in.

**`kpa.connections`.** KPA-101 puts the credential on the server, encrypted,
with the three dates and the verification result the brief's credential rule
names. A connection whose
secret lives on the server and whose provider, name and services live in the
browser has two masters over one record.

**`kpa.project.settings`.** It holds contract dates, and those arrive from
Salesforce through Certinia PSA. A value the product fetched from another
system is not a preference this browser gets to hold.

**`kpa.workspace.fields`.** It maps custom fields to Jira field ids. It
describes an external system, so two devices cannot legitimately disagree about
it.

**`kpa.accent`, `kpa.accent.hex`, `kpa.charts`, `kpa.charts.hex`.** An accent
is a person's taste. Somebody who picks a colour on the laptop expects the
phone to match, and nothing about the second device makes a different colour
correct.

## The eleven that stay

**The eight `kpa.issues` keys** are table furniture: grouping, ordering, the
dragged arrangement, nesting, and hidden columns. Putting them on a server
means a schema for column layouts, which is exactly the columns nobody reads
that this decision exists to prevent. They also have a real device argument.
A wide screen and a phone want different columns hidden, so syncing them makes
the phone worse.

**`kpa.appearance`** is the resolved token blob the provider writes and the
pre-paint script reads. It is a cache of a decision held elsewhere rather than
the decision itself, so it belongs to the machine that has to paint before it
can ask anything.

**`kpa.space`** stays, and the next section argues it.

**`theme`** should follow the room. Somebody works in daylight at a desk and in
the dark on a couch, and the right answer differs by device rather than by
person. `next-themes` already defaults it to `system`, which tracks the device
by construction.

## `kpa.space`, the one worth arguing

The space filter is the Collibra and Koinon divider, and it is the only key
here where a real argument runs the other way. **It stays in the browser.**

The counter-argument is the brief's. Under *Risks accepted* it says the wall is
unenforced: "It is a guideline the assistant is told to follow, so one prompt
failure puts employer customer material into a Koinon answer or a Koinon
commercial figure into a Collibra one." Nothing in the database prevents a
crossing, and ADR-0018 makes the crossing flag the only guard the wall has. If
one control is all that stands there, an argument exists for the server holding
it rather than a browser anybody can clear.

It was weighed and rejected on two grounds.

**The default is `all`.** `space-context.tsx:22` lists `all`, `collibra`,
`koinon` and `personal`, and line 24 makes `all` the fallback. A cleared
browser therefore shows everything rather than showing the wrong side of the
wall. That is noisy, and noise is not a leak.

**A filter is a view.** It narrows what a screen renders. It never widens what
the wall permits, and moving where the chosen value is stored would enforce
nothing. The mitigation the brief actually names is a row-level security policy
on the `space` column, which guards the rows rather than the filter. That
remains available and this decision neither brings it closer nor pushes it
away.

## The appearance keys split four to one

KPA-93's own acceptance criteria put six appearance keys out of scope, on the
ground that the bootstrap script reads them before paint and a server round
trip reintroduces the flash they exist to prevent. That reason is sound and it
covers two keys, not six.

`components/appearance-bootstrap.tsx` reads exactly two: `kpa.appearance` at
line 28, and `theme` at line 30. It reads neither accent key and neither chart
key, and its own header at line 7 says why. The provider resolves the selection
and writes the finished light and dark token sets to one key, so the script
needs no preset table and no colour maths. The four choice keys were never on
the pre-paint path.

So the pre-paint argument protects `kpa.appearance` and `theme`, and the other
four move. KPA-126 already said so, KPA-93 sketched the opposite, and this
settles it in favour of KPA-126.

## Whether a display preference ever follows the user

**Not today.** The eight `kpa.issues` keys stay in the browser, and no display
preference crosses to the server in slice four.

**If that is ever reversed, it lands as one `jsonb` column and not as eight.**
Three reasons.

They are one arrangement of one list rather than eight independent facts. They
change together, and a reader who regroups a board usually reorders it in the
same minute.

Nothing queries them. No read filters, joins or orders by a hidden column list,
so the columns would buy none of what columns are for.

The list grows. Three of the eight arrived on 31 August 2026 in `4e76947` and
the other five on 1 September in `178a53e`, so the count nearly tripled in a
day. Under eight columns each of those five was a migration. One `jsonb` column
costs none.

## The account moves before its row exists

KPA-94 adds an email, an assistant name, a password hash and a created date to
`users`. Something then has to decide what happens to a browser that already
holds an account.

**The first boot asks again, and it is ADR-0009 that says so rather than a
preference.** `kpa.account` holds a name, an email, an assistant name and a
created date. It holds no password and never did, and `account.ts:11` states
that as a rule rather than as an omission. KPA-94 requires a password hash. A
carried-across account would therefore arrive without the one field that lets
anybody sign in, so the wizard has to run regardless. ADR-0009 already makes
the wizard the only writer of the account and requires it to refuse a second
run.

**One smaller question is genuinely Shane's and this ADR does not answer it.**
The wizard could read `kpa.account` and pre-fill the name, the email and the
assistant name, saving three fields of typing once. It changes nothing about
correctness and costs little either way. KPA-126 removes the browser store, so
whoever writes that story should be told which behaviour to build.

## The count was quoted three times and measured once

The ruling's headline says seven keys move and twelve stay. Its own enumeration
names eight that move and eleven that stay, and the enumeration is authoritative
because every one of the nineteen appears in it. Eight and eleven is nineteen,
and so is seven and twelve, which is why the error survived being read. **This
ADR states eight and eleven.**

That is the third wrong count on this question. The epic said eleven keys, and
the project brief still says eleven at line 580. KPA-93 said thirteen
non-appearance keys. The ruling said seven and twelve. Each was quoted from the
one before it, and one `grep` settles it:

```
cd apps/web && grep -rnoE "['\"]kpa\.[a-zA-Z.]+['\"]" lib components app hooks | sort -t: -k3
```

Eighteen distinct keys, plus `theme`. The pattern is worth recording because
the golden rule in `CLAUDE.md` names it: a count nobody ran is a count nobody
knows.

## Considered Options

1. **Move everything that is not read before paint** - one rule, no argument
   per key, and every device agrees about everything. Rejected because it puts
   a schema for column layouts on the server, which is the outcome KPA-93 was
   written to prevent. It also makes the phone worse, since the columns worth
   hiding on a phone are not the columns worth hiding on a monitor.
2. **Move nothing until a second device is a real requirement** - no migration
   and no schema at all. Rejected because two keys already have server halves
   waiting on them. KPA-76 is done and hashes a password with no row, and
   KPA-101 puts a connection's secret on the server while its identity stays in
   the browser.
3. **Sort by whether a value is data or a preference** - the framing KPA-93
   reached for. Rejected because it splits the appearance keys wrongly. The
   accent is a preference and should move; the resolved blob is data and should
   stay. The rule gives the wrong answer on both.
4. **Ask of each key whether it belongs to the person or the device** - chosen.

## Consequences

- **KPA-126** loses one acceptance criterion. It currently says the space
  filter follows the user, so it is the same on a second device. That
  criterion contradicts this decision and goes. Its other three stand: the
  account reads the server row, the four accent and chart keys move, and the
  resolved appearance blob stays as the pre-paint cache.
- **KPA-94** creates the row `kpa.account` moves into, and gains one line: the
  first boot asks for the account again rather than carrying the browser copy
  across, because no password exists to carry.
- **KPA-95** comes before two of the eight can move. `kpa.workspace.fields` is
  keyed by workspace and `kpa.project.settings` by project, so both need the
  stable identifiers KPA-95 creates before either has a foreign key to point
  at.
- **KPA-101** owns `kpa.connections` whole. This decision removes the option of
  leaving the provider, name and services in the browser beside a server-side
  secret.
- The appearance settings screen gains a write to the server and keeps its
  write to `kpa.appearance`. The resolved blob is now a cache of a server value
  rather than of a local one, so a second device paints its own default once
  and the right colour from the second load. That single wrong paint is the
  price of never flashing, and it is the same trade the bootstrap script
  already makes.
- Eleven keys keep working with no server at all. A browser that cannot reach
  the box still groups, sorts, hides and paints, which is worth having on a box
  that goes down.
- Nothing here changes `local-store.ts`. The keys that stay keep using it, and
  the keys that move stop having a local store rather than getting a different
  one.
- Three of the movers read their key a second time without the store, so a
  story that changes only the store leaves a live local read behind.
  `connections.ts:60`, `project-settings.ts:82` and `workspace-fields.ts:48`
  each call `window.localStorage.getItem` directly to read the whole blob,
  merge one entry into it and write it back. That read-modify-write becomes a
  server round trip, and missing one of the three is silent.
