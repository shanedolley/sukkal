# Where the work stands, 3 September 2026

Written to hand one session to the next. It records what is true rather than
what was intended, and every number here was measured rather than quoted.

## The tree

`main` is at `a744f90`, pushed, and CI passed on all three commits. The working
tree is clean. Twenty-six migrations, twenty-six ADRs.

The suite runs 517 tests with the vault and 499 without it. One test skips in
both, and it is meant to: `test/connect.test.ts` skips its TLS case because a
loopback database needs none.

## The board, and a correction to the last handoff

**113 stories. 75 have shipped, which is 66%, and 60% by points.** Fifty-nine
are Done and sixteen are In Review.

The previous handoff read 62 of 100 and 52% by points, and both numbers were
wrong for one reason: `/rest/api/3/search/jql` returns 100 issues a page and
answers with a `nextPageToken` rather than an error. A query that ignores the
token reads one page and reports it as the whole project. **Page it.** The
project has never had exactly a hundred stories, and a round number that
matches a page size is the shape of this mistake.

**In Review means shipped.** Each of those sixteen is on `main`, pushed, and CI
green. They wait on Shane reading them and nothing else, so a story blocked by
one is not really blocked.

    KPA-68  KPA-70  KPA-77  KPA-78  KPA-79  KPA-83  KPA-94  KPA-95
    KPA-97  KPA-98  KPA-104 KPA-127 KPA-128 KPA-137 KPA-138 KPA-139

## Sign-in works, end to end

KPA-128, KPA-79 and KPA-78 shipped this session, in that order. Between them
the door now opens, closes, and answers a forgotten password.

- **KPA-128.** The sign-in form posts to `/api/session`. The sign-up page is
  gone, because one installation holds one owner and the wizard writes that
  row. Sign Out in the sidebar calls `DELETE /api/session`, which it never did.
- **KPA-79.** `migrations/025` holds one outstanding reset. Using a token
  deletes the row, so it works once. `scripts/reset-password.sh` sets a
  password on the box, and `--link` prints an address that sets one.
- **KPA-78.** A run of failed sign-ins buys a growing wait capped at eight
  seconds, and never a lock. Every attempt reaches the audit log. ADR-0024
  carries the measurement that set the ceiling.

**`POST /api/account` was a way past the gate**, and KPA-128 closed it. The
route is public so the wizard can write the first account, and it overwrote the
owner's name, email and password hash without asking who was calling. One
unauthenticated request took the installation. It now refuses once an account
exists unless the caller holds a session, which is what ADR-0009 asked the
wizard to do and nothing was enforcing.

## One decision waiting

`docs/decisions.md` reads nine decided and one waiting. **[KPA-143] is the open
question**, and it is in filter 10047: how does a self-hosted box send the
reset link?

**The register only sees a comment written in its own shape**, and this one was
not, first time. `scripts/decision-register.ts` looks for a warning panel whose
first line is exactly `DECISION NEEDED` with the question under it, and a
paragraph starting `MY RECOMMENDATION`. A comment that says the same things in
other words reads as no decision at all, and `npm run decisions` then reports
nothing waiting while something is. Run it after posting one, and read the
count.
KPA-79 mints the token and names which connection would carry it, and nothing
carries it, so the shell is the only way to a link. The comment weighs an OAuth
mail connection, an SMTP provider card, and no mail at all, and recommends
SMTP with the measurement behind it: nodemailer 9.1.1 declares no dependencies
and unpacks to 617 KB, against a root that runs two.

KPA-144 also came out of this session: the sidebar user menu names Shane Dolley
and his address in code, which is wrong on anybody else's installation, and
four of its items go nowhere.

## What to build next

Nothing is blocked on the decision above. The auth epic is finished apart from
sending the mail.

## What is still nobody's to touch alone

- **KPA-12 and KPA-86** spend metered money.
- **KPA-103, KPA-105 and KPA-111** need a real OAuth grant or a live tracker.
  KPA-143 depends on the first two if option A wins.
- **KPA-71** needs somebody at both ends of the nabium push.
- **KPA-22** needs amaterasu, which is often unreachable from the Mac.

## Two things left open on purpose

Production `kpa` holds every migration up to 024. An agent applied them by
accident on 3 September 2026 by writing `DATABASE_URL_TEST=... npm run migrate`,
which reads `DATABASE_URL` and so pointed at production rather than away from
it. Nothing was lost, and Shane chose to leave it. The command now names the
database before it acts and refuses `kpa` outright, and
`KPA_ALLOW_PRODUCTION=1` migrates it deliberately. **025 and 026 are not there**,
so production is two behind the repository.

`GET /api/account` now answers a stranger the way a fresh box does. That means
a signed-out visitor to `/setup` on a configured box sees the wizard's
questions rather than its "already set up" card, and meets the refusal at the
end instead. It is a worse screen for a stranger and the right answer to one.

## Read these before writing code

`CLAUDE.md` carries the golden rule and every trap this project has already
paid for. `docs/project-brief.md` carries the architecture and the risks
accepted. `docs/adr/` holds the decisions that were hard to reverse, and
`docs/decisions.md` holds the lighter rulings.

`apps/web/AGENTS.md` says the Next.js here is not the one you know, and it is
right twice over. KPA-77 found that `middleware.ts` is deprecated and renamed
to `proxy.ts`, and that Proxy defaults to the Node.js runtime, which is what
lets a guard reach the database. KPA-128 found the next one: a static page
calling `useSearchParams` fails the production build without a Suspense
boundary, so `/sign-in` and `/reset` read the parameter on the server and hand
it down.

[KPA-143]: https://koinon.atlassian.net/browse/KPA-143
