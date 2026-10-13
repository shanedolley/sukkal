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
6. Commit with a message that says what changed and why. Push. Watch CI.
7. Comment on the ticket with what was built, how each criterion is met, and
   what was proved rather than assumed. Dispatch `kothar:project-manager` to
   move it to AI Review.

**While CI cannot run, say so on the ticket.** GitHub has refused every job
since 13 October 2026 over the account's billing. Run the checks locally, quote
the counts, and name the refused run.

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

Only `kothar:project-manager` moves a ticket. Dispatch it unnamed, with the
issue, the target status and the evidence. The guard refuses every other route.

The workflow changed on 3 October 2026. A story runs Backlog, To Do, In
Progress, AI Review, HIL Review, Done. The transition ids now differ by the
status a story is in, so read `/rest/api/3/issue/<key>/transitions` rather than
any table. Only a person moves a story out of HIL Review.

A move to AI Review needs a reviewer's
`Review verdict: PASS (reviewer <agent>, builder <agent>)` comment before the
story can leave it, and the builder cannot be the reviewer.

## When a decision needs a person

Stop the story and post a Jira comment carrying:

- The question, in a warning panel whose first line is exactly
  `DECISION NEEDED`.
- The options, each with what it costs and what it buys.
- A paragraph starting `MY RECOMMENDATION`, with the reason.
- What happens when Shane answers.

`scripts/decision-register.ts` reads those two strings and nothing else. Run
`npm run decisions` afterwards and read the count it prints. It needs the agent
token from the Keychain; the *Traps* section of `handover.md` gives the command.

The `Decision required` status no longer exists. Park the story by dispatching
`kothar:project-manager` to move it to HIL Review, then take the next one.

Measure before recommending, wherever a number is available. Shane answers with
a Jira decision block, or a plain comment such as "option A". Rewrite the ruling
on the ticket to carry the whole ruling and its reason before acting on it, then
run `npm run decisions`.

## Architecture decisions

Write the ADR to `docs/adr/` before carrying the decision into code, when all
three tests hold: hard to reverse, surprising without context, and the result
of a real trade-off. Miss one and skip it. Invoke the
`architecture-decisions` skill.

## What not to touch alone

- **KPA-12 and KPA-86 spend metered money.** Shane approved the spend for
  testing on 13 October 2026. The suite must still run offline on recorded
  answers; only a deliberate live proof spends. Neither has its key yet:
  `sukkal_local` holds no Voyage and no Claude connection. Shane types each key
  into the Connections screen, never into a file or a transcript.
- **KPA-71** needs somebody at both ends of the nabium push.
- **amaterasu answers**, measured on 13 October 2026. When it seems not to,
  read the Local Network trap in `handover.md` before planning around it.
- **Production `sukkal` on amaterasu.** It holds 21 migrations and stops at
  `022_issue_cache.sql` deliberately, so it is eleven behind the repository's
  `033`, measured on 13 October 2026. The command names the database before it
  acts and refuses it without `SUKKAL_ALLOW_PRODUCTION=1`.
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

Measured on 13 October 2026 at source: the board paged to the end, 131 stories,
90 Done. Every open story's blockers were read from its links. CI cannot run
until Shane fixes the GitHub billing.

**Twelve stories wait on a review, and none needs code.** KPA-108 and KPA-157 to
KPA-165 sit in AI Review and need a reviewer's verdict from an agent that did
not build them. KPA-154 sits in HIL Review and passes all seven criteria; only
Shane moves it.

**Nine stories have no open blocker. Each waits on Shane for one thing:**

| Story | What it waits on |
|---|---|
| [KPA-12](https://koinon.atlassian.net/browse/KPA-12) | A Voyage key in the Connections screen. Spend is approved. Unblocks KPA-87 and KPA-114, the road to retrieval |
| [KPA-86](https://koinon.atlassian.net/browse/KPA-86) | A Claude key in the Connections screen. Spend is approved. ADR-0016 says build both paths: the CLI for scheduled work, the API for chat. Unblocks KPA-88, KPA-90 and KPA-115 |
| [KPA-50](https://koinon.atlassian.net/browse/KPA-50) | The ruling in comment 11776. Build at once on Option A |
| [KPA-103](https://koinon.atlassian.net/browse/KPA-103) | A consent screen. In Progress. Unblocks KPA-106, KPA-111 and KPA-113 |
| [KPA-105](https://koinon.atlassian.net/browse/KPA-105) | A Jira site to connect, by token or grant |
| [KPA-49](https://koinon.atlassian.net/browse/KPA-49) | A live tracker to poll. Unblocks KPA-124 |
| [KPA-71](https://koinon.atlassian.net/browse/KPA-71) | Somebody at both ends of the nabium push |
| [KPA-84](https://koinon.atlassian.net/browse/KPA-84) | Real mailboxes |
| [KPA-147](https://koinon.atlassian.net/browse/KPA-147) | An HTTPS address. `sukkal.app` still has no A record, read on 13 October 2026 |

**Start with KPA-12 or KPA-86 the moment a key lands**, because the two together
open the retrieval and chat epic, KPA-57, which stands at 0 of 7. Both stories
carry stale text: KPA-12 names `migrations/004_vector_indexes.sql`, but the HNSW
indexes are already in `migrations/001_core_schema.sql` and `src/embedding.ts`
pins the model. It also says 17 facts where the vault holds 19.

**One small job needs no person:** teach `scripts/decision-register.ts` to fall
back to the Keychain for its token. Raise it as a story first.

**If you arrive and everything is blocked, read across the stories rather than
within one.** Every defect found on 1 October was found that way: two sweeps
nothing called, four gaps around the connection card, a question the register
dropped, a wrong pairing it would have invented, a flaky test three agents each
passed over, and an ISO date in a brand-new string on a screen whose dates had
just been changed. Each story was honest on its own and the gap sat between
them.

**Check what an agent reports before you repeat it.** On 1 October a report
named a flicker that its own SQL ruled out, another carried a miscount forward
from a comment that had been wrong for weeks, and a third blamed a flake on a
file move that predated it by a day. All three were settled by running
something, and `handover.md` records what.
