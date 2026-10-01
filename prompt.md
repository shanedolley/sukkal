# Continue Sukkal

Paste this into a fresh session from
`~/Development/koinonau/personal-assistant`.

---

Read `./handover.md` first. It holds where the work is, what runs, and the
traps that each cost real time to find. Then read `CLAUDE.md` for the golden
rule, the commands and the database split, and `docs/project-brief.md` for the
architecture and the risks accepted.

Read `apps/web/AGENTS.md` before writing any web-tier code. The Next.js here is
not the one you know, and it has already changed three designs.

Do not rediscover what those record.

## How to work

**Commit straight to `main`.** No branches, no pull requests, unless asked.
`CLAUDE.md` names the override the hook wants. One commit per story, files
staged by name, never `git add -A`.

**Verify in both directions, which is this project's golden rule.** A finding
is unverified until you have run something that proves it, whoever produced it.
Before reporting your own finding, run the thing that would fail if you were
wrong. Choose the check that only the new behaviour passes: a grep for a string
the old code also produced proves nothing.

**Run the lint, the build and the tests before reporting anything finished**,
then watch the run with `gh run list --limit 1`.

**Point the running application at `sukkal_local`.** The suite drops every table in
`sukkal_dev`, and it has already destroyed a person's work once.

**Ask the source rather than a summary.** Open the file, run the statement,
call the API. A subagent that contradicts you has been right before.

**Write long text through a file, not a heredoc.** `CLAUDE.md` says why. Check
`git ls-files <path>` before writing a file you believe is new, because the Write
tool overwrote a tracked one on 13 September 2026 without refusing.

## The loop, per story

1. Read the story in Jira, in full. It carries its own acceptance criteria, the
   files it touches, and the test it wants.
2. Read every file it names, and grep for every caller of anything you will
   change.
3. Build it. Prefer the smallest thing that meets the criteria and leaves one
   runnable check behind.
4. Run both packages' lint, build and tests, and the web tier's `npm run check`.
5. Update `docs/schema.md` when the schema moved, and `CLAUDE.md` when you
   found a trap that will bite again.
6. Commit with a message that says what changed and why, ending with the
   `Claude-Session` line. Push. Watch CI.
7. Comment on the ticket with what was built, how each criterion is met, and
   what was proved rather than assumed. Move it to In Review.

## Prove every claim

Say what you ran and what it answered. A number nobody measured is a guess
wearing a number's clothes.

Two examples from this project. A handover reported "62 of 100 stories" because
a Jira query read one page of 100 and called it the project. A verification
reported that Google had accepted a redirect because a pipeline's exit status
came from `grep` rather than from the `curl` that had already failed.

When a criterion cannot be proved locally, say which one and why, rather than
reporting the story done.

## Moving a story

Every KPA story takes the same transition ids, read from
`/rest/api/3/issue/KPA-146/transitions` on 13 September 2026.

| Id | Moves it to |
|---|---|
| 2 | Decision required |
| 11 | To Do |
| 21 | In Progress |
| 31 | In Review |
| 41 | Done |

## When a decision needs a person

Stop the story, move it to the `Decision required` status, and post a Jira
comment carrying:

- The question, in a warning panel whose first line is exactly
  `DECISION NEEDED`.
- The options, each with what it costs and what it buys.
- A paragraph starting `MY RECOMMENDATION`, with the reason.
- What happens when Shane answers.

`scripts/decision-register.ts` reads those two strings and nothing else. Run
`npm run decisions` afterwards and read the count it prints. Filter 10047 is
the queue Shane works from.

Measure before recommending, wherever a number is available. Shane answers with
a Jira decision block, often just "option A". Rewrite that block to carry the
whole ruling and its reason before acting on it, then run `npm run decisions`.

## Architecture decisions

Write the ADR to `docs/adr/` before carrying the decision into code, when all
three tests hold: hard to reverse, surprising without context, and the result
of a real trade-off. Miss one and skip it. Invoke the
`architecture-decisions` skill.

## What not to touch alone

- **KPA-12 and KPA-86** spend metered money.
- **KPA-71** needs somebody at both ends of the nabium push.
- **KPA-22** needs amaterasu, which answered on 1 October 2026 and has often
  been unreachable from the Mac. Check before you plan around it.
- **Production `sukkal` on amaterasu.** KPA-154 renamed it from `kpa` on
  30 September 2026. It holds 21 migrations and stops at `022_issue_cache.sql`
  deliberately, so it is ten behind the repository's 032. The command names the
  database before it acts and refuses it without `SUKKAL_ALLOW_PRODUCTION=1`.
- **A live OAuth grant.** The consent screen is Shane's to press. Build the
  whole path, prove every part that needs no vendor, and hand him the button.
- **The Resend key and the sending domain.** Both are configured and working, so
  do not reconfigure either. The card is `Sukkal Resend` with `send_from` set to
  `no-reply@sukkal.app`, the key is send-only, and DKIM, SPF and DMARC are live
  on `sukkal.app`. **A real send costs a real email** against 3,000 a month, so
  drive Resend through the injected fetcher in tests and never from a test run.

## In chat

Link every Jira ID as a clickable markdown link.

Say what you dispatched to a subagent and what came back, and verify it before
repeating it as fact.

## Start here

Measured on 1 October 2026 at source: the board paged to the end, 130 stories,
and CI read with `gh run list --limit 1`. amaterasu answers.

**The last session shipped seven stories**, KPA-157 and KPA-159 to KPA-164.
Opening a connection card now shows what the connection is and offers the one
fix its method allows; a key card can be renamed and a grant card cannot; the
sending address reads back; a connection name cannot split a log line; the
worker sweeps what has expired; the decision register carries every question;
and the one flaky test is fixed. `handover.md` carries what each proved.

**Nothing is left that you can build alone.** Every unblocked story in To Do
waits on Shane, and the two questions he holds are the next thing that moves
this project.

**Two questions wait on him**, both on
[KPA-108](https://koinon.atlassian.net/browse/KPA-108), which sits in
`Decision required`. Whether `needs_you` gains a fifth kind for a credential,
and how many days before expiry the briefing starts asking. Each carries its
options, what each costs and buys, and a recommendation measured rather than
guessed. **Build KPA-108 the moment he rules**: KPA-107 already writes the
result it would raise an item from, so nothing technical blocks it. Read both
questions in `docs/decisions.md` or on the ticket.

**The eight other unblocked stories, and what each waits on:**

- **KPA-12** and **KPA-86** spend metered money, on Voyage and on a real model.
- **KPA-49** and **KPA-105** need a live tracker to poll.
- **KPA-50** needs a ruling and a live Jira ticket.
- **KPA-71** needs somebody at both ends of the nabium push.
- **KPA-84** needs real mailboxes.
- **KPA-147** has a domain in `sukkal.app` and still has no address, because
  the root carries no A record.

**KPA-103's last criterion needs a consent screen**, which is Shane's to press.
It is the one story In Progress.

**If you arrive and everything is blocked, read across the stories rather than
within one.** Every defect found on 1 October was found that way: KPA-157's two
unreachable sweeps, the four connection gaps, the register's lost question, and
a flaky test that three separate agents each passed over. Each story was honest
on its own and the gap sat between them. Ten stories sit In Review and none has
been read.

Thirty stories are open: 29 To Do and one In Progress, KPA-103, against 130
stories and ten In Review. One sits in Decision required.
