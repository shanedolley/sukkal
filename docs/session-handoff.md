# Where the work stands, 3 September 2026

Written to hand one session to the next. It records what is true rather than
what was intended, and every number here was measured rather than quoted.

## The tree

`main` is at `c32922b`, pushed, and CI passed. The working tree is clean and
nothing waits to be pushed. Twenty-three migrations, twenty-five ADRs.

The suite runs 481 tests with the vault and 463 without it. One test skips in
both, and it is meant to: `test/connect.test.ts` skips its TLS case because a
loopback database needs none.

## The board

Sixty-two stories of a hundred have shipped, which is 52% by points. Forty-nine
are Done and thirteen are In Review.

**In Review means shipped.** Each of those thirteen is on `main`, pushed, and
CI green. They wait on Shane reading them and nothing else, so a story blocked
by one is not really blocked.

    KPA-68  KPA-70  KPA-77  KPA-83  KPA-94  KPA-95  KPA-97
    KPA-98  KPA-104 KPA-127 KPA-137 KPA-138 KPA-139

## Every decision is answered

`docs/decisions.md` reads nine decided and none waiting, and
`npm run decisions` rebuilds it from Jira. The queue Shane works from is
filter 10047, "KPA: decisions I need to make", which reads the
`Decision required` status.

A decision reaching him is a Jira comment carrying a warning panel with the
question, the options with their costs, a recommendation, and what happens
next. He answers with a Jira decision block, often just "option A", and the
next session rewrites that block to carry the whole ruling before acting on
it. A letter means nothing once the comment above it scrolls away.

## What to build next

**KPA-128, then KPA-79, then KPA-78.** That order is a recommendation rather
than a rule.

KPA-128 is small and makes the whole sign-in usable end to end: the page posts
to `/api/session`, which KPA-77 built. The Jira board still shows it blocked by
KPA-77, which is In Review rather than Done, so the block is nominal.

KPA-79 matters more than its position suggests. ADR-0023 made the local account
the only gate, so the command line reset on the server is now the only way back
into a box whose password is lost. ADR-0009 named it unbuilt and it still is.

KPA-78 adds the lockout that stops a guessing attack.

## What is still nobody's to touch alone

- **KPA-12 and KPA-86** spend metered money.
- **KPA-103, KPA-105 and KPA-111** need a real OAuth grant or a live tracker.
- **KPA-71** needs somebody at both ends of the nabium push.
- **KPA-22** needs amaterasu, which is often unreachable from the Mac.

## One thing left open on purpose

Production `kpa` holds all twenty-three migrations. An agent applied them by
accident on 3 September 2026 by writing `DATABASE_URL_TEST=... npm run migrate`,
which reads `DATABASE_URL` and so pointed at production rather than away from
it. Nothing was lost: the runner refuses a schema holding tables it did not
create, so a successful run proves the database was empty, and every content
table still is.

Shane chose to leave it. The command now names the database before it acts and
refuses `kpa` outright, and `KPA_ALLOW_PRODUCTION=1` migrates it deliberately.

## Read these before writing code

`CLAUDE.md` carries the golden rule and every trap this project has already
paid for. `docs/project-brief.md` carries the architecture and the risks
accepted. `docs/adr/` holds the decisions that were hard to reverse, and
`docs/decisions.md` holds the lighter rulings.

`apps/web/AGENTS.md` says the Next.js here is not the one you know, and it is
right. KPA-77 found two things in `node_modules/next/dist/docs` that changed
its design: `middleware.ts` is deprecated and renamed to `proxy.ts`, and Proxy
defaults to the Node.js runtime, which is what lets a guard reach the database
rather than merely notice a cookie.
