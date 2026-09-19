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
- **KPA-22** needs amaterasu, which is often unreachable from the Mac.
- **Production `kpa`.** It holds migrations 001 to 024 deliberately, and the
  command refuses it without `SUKKAL_ALLOW_PRODUCTION=1`.
- **A live OAuth grant.** The consent screen is Shane's to press. Build the
  whole path, prove every part that needs no vendor, and hand him the button.

## In chat

Link every Jira ID as a clickable markdown link.

Say what you dispatched to a subagent and what came back, and verify it before
repeating it as fact.

## Start here

Measured on 19 September 2026: the board paged in full, and CI read with
`gh run list --limit 1`. Shane is abroad, and amaterasu answers only on the
internal network in Australia.

**[KPA-107](https://koinon.atlassian.net/browse/KPA-107) shipped.** Every
connection is rechecked hourly by the worker, a failing card is outlined in red,
and the Connections item marks the set. Two of the three Google connections are
dead, and `handover.md` says why that is probably Google's seven-day limit.

1. **Finish [KPA-103](https://koinon.atlassian.net/browse/KPA-103).** It is In
   Progress with one criterion left, a refresh before expiry. That waits on
   Shane reading the consent screen's publishing status. Under Testing no
   refresh outlives seven days, so build nothing until he answers.
2. **Reconnect Gmail and Collibra** once the publishing status is settled.
   That is two consent screens, and they are Shane's to press.
3. **[KPA-108](https://koinon.atlassian.net/browse/KPA-108)** is now unblocked
   in substance: KPA-107 writes the result it would raise a Needs you item from.
   It carries two decisions, a fifth `needs_you` kind or a deadline, and the
   expiry window, so post them before building.
4. **[KPA-154](https://koinon.atlassian.net/browse/KPA-154) and the production
   load** wait on amaterasu, which means Shane back on the internal network.

**The rest still waits on Shane**, as the table in the last version of this
section said: KPA-50 on a ruling and a live Jira ticket, KPA-12 and KPA-86 on
metered spend, KPA-71 on nabium, KPA-84 on real mailboxes, KPA-49 and KPA-105 on
live trackers, and KPA-147 on an HTTPS address.

**Nothing waits on a ruling from Shane** beyond
[KPA-143](https://koinon.atlassian.net/browse/KPA-143), still in the decision
queue, and the publishing status above.

Thirty-three stories are open: 31 To Do, one In Progress and one Decision
required, against 122 stories and 30 In Review.
