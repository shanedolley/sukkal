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

Measured on 13 September 2026, when a session stopped because nothing left could
be both built and proved without Shane: the board paged in full, every To Do
story's `Blocks` links read one by one from `/rest/api/3/issue/<key>`, amaterasu
tested with `nc -z -w 3 192.168.20.110 5432`, and CI read with
`gh run list --limit 1`.

**[KPA-13](https://koinon.atlassian.net/browse/KPA-13),
[KPA-131](https://koinon.atlassian.net/browse/KPA-131) and
[KPA-74](https://koinon.atlassian.net/browse/KPA-74) shipped** that day. Slice one
has one story left, [KPA-12](https://koinon.atlassian.net/browse/KPA-12), and it
spends metered money.

**Ten To Do stories have no open blocker, and each waits on something only Shane
supplies.** Read this before claiming, and re-measure it: a ruling or a grant can
free any of them.

| Story | What it waits on |
|---|---|
| [KPA-50](https://koinon.atlassian.net/browse/KPA-50) | A live Jira round trip, which its fifth criterion and its done-when both name, and an estimate. It carries no estimate label and adds TipTap. Nothing in the app reads or writes Jira descriptions yet |
| [KPA-12](https://koinon.atlassian.net/browse/KPA-12) | Metered Voyage spend |
| [KPA-86](https://koinon.atlassian.net/browse/KPA-86) | Metered model spend |
| [KPA-71](https://koinon.atlassian.net/browse/KPA-71) | Somebody at both ends of the nabium push |
| [KPA-84](https://koinon.atlassian.net/browse/KPA-84) | Acting on Shane's real mailboxes |
| [KPA-49](https://koinon.atlassian.net/browse/KPA-49) | Live trackers to poll |
| [KPA-105](https://koinon.atlassian.net/browse/KPA-105) | A Jira site connected by token or by a grant |
| [KPA-103](https://koinon.atlassian.net/browse/KPA-103) | A consent screen for one of its two remaining criteria. The other, a refresh before expiry, is buildable and would leave the story open |
| [KPA-147](https://koinon.atlassian.net/browse/KPA-147) | An HTTPS address, which needs the deployment story nobody has raised |
| [KPA-154](https://koinon.atlassian.net/browse/KPA-154) | A reachable amaterasu. It refused port 5432 five times on 13 September 2026 |

Every other To Do story has an open blocker in Jira. KPA-89 waits on KPA-88 and
retrieval; KPA-107 waits on KPA-103, KPA-105 and KPA-106; KPA-108 waits on
KPA-107.

**What would free the most, in order:**

1. **A ruling on KPA-50.** Build the editor, the slash menu and the ADF adapter
   against fixtures now, with the live Jira proof left to Shane, or wait for the
   issue sync. It is the one story a session could mostly build.
2. **A reachable amaterasu**, which frees KPA-154 and closes epic KPA-152.
3. **Raising the deployment story.** It frees KPA-147 and owns
   `upgrade-insecure-requests`, which KPA-148 left out on purpose.
4. **One Google consent screen**, which lets KPA-103 close and starts the chain
   through KPA-107 and KPA-108.

**Two stories read as unblocked before, and Jira blocks both.**
[KPA-92](https://koinon.atlassian.net/browse/KPA-92) waits on KPA-87, which is
retrieval. [KPA-129](https://koinon.atlassian.net/browse/KPA-129) waits on
KPA-123, KPA-124 and KPA-125, and it names "all twelve checks" where the web tier
runs twenty-three, so rewrite its criteria once those land.

**Two steps wait on Shane, and neither is a ticket.** Unfreezing the vault
restarts three launchd jobs, and nothing in the repository needs the freeze any
longer. Loading the vault into production needs amaterasu and a person.

**Nothing waits on a ruling from Shane** beyond
[KPA-143](https://koinon.atlassian.net/browse/KPA-143), still in the decision
queue.

Thirty-four stories are open: 33 To Do and one Decision required, against 122
stories and 29 In Review.
