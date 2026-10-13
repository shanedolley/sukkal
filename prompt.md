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

**The project manager refuses a move to AI Review or Done without a pull request
whose checks pass**, read from its status map on 14 October 2026. KPA has none,
so until Shane answers comment 11788 on KPA-167, park a shipped story in HIL
Review with that question rather than dispatching a move to AI Review.

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
`npm run decisions` afterwards and read the count it prints. It reads the agent
token from the Keychain itself, since KPA-167.

**Label the ticket `question` in the same step**, with an issue edit:
`{"update":{"labels":[{"add":"question"}]}}`. Shane asked on 14 October 2026 for
every ticket that waits on his answer to carry it, whether the question is a
decision, an approval or anything else. Remove the label once he answers.

The `Decision required` status no longer exists. Park the story by dispatching
`kothar:project-manager` to move it to HIL Review, then take the next one.

Measure before recommending, wherever a number is available. Shane answers with
a Jira decision block, or a plain comment such as "option A". Rewrite the ruling
on the ticket to carry the whole ruling and its reason before acting on it,
remove the `question` label, then run `npm run decisions`.

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

Measured on 14 October 2026 at source: the board paged to the end, 133 stories,
91 Done. Every open story's blockers were read from its links. CI is green, and
no branch or pull request is open. The documentation was swept for stale
references the same day.

**Read Shane's answers first.** Two stories wait in HIL Review with the
`question` label, both parked on 14 October 2026:

- [KPA-167](https://koinon.atlassian.net/browse/KPA-167) shipped, green, in
  commit `71f3a82`. Comment 11788 asks how a KPA story reaches AI Review and Done
  when the project manager's gate wants a pull request and KPA commits to `main`.
  The answer may change *Commit straight to `main`* above and in `CLAUDE.md`, so
  settle it before building anything else.
- [KPA-166](https://koinon.atlassian.net/browse/KPA-166) asks Docker or Node 22
  under systemd, in comment 11790. Once answered, write the ADR, then the compose
  file or the units, then `docs/runbooks/deploy.md`, then deploy. It still needs
  Shane's separate approval to migrate production. It blocks KPA-147.

**Ten stories wait on a review, and none needs code.** KPA-108 and KPA-157 to
KPA-165 sit in AI Review and need a reviewer's verdict from an agent that did
not build them.

**Seven more stories have no open blocker. Each waits on Shane for one thing:**

| Story | What it waits on |
|---|---|
| [KPA-12](https://koinon.atlassian.net/browse/KPA-12) | A Voyage key in the Connections screen. Spend is approved. Unblocks KPA-87 and KPA-114, the road to retrieval |
| [KPA-86](https://koinon.atlassian.net/browse/KPA-86) | A Claude key in the Connections screen. Spend is approved. ADR-0016 says build both paths: the CLI for scheduled work, the API for chat. Unblocks KPA-88, KPA-90 and KPA-115 |
| [KPA-103](https://koinon.atlassian.net/browse/KPA-103) | A consent screen. In Progress. Unblocks KPA-106, KPA-111 and KPA-113 |
| [KPA-105](https://koinon.atlassian.net/browse/KPA-105) | A Jira site to connect, by token or grant. Unblocks KPA-142 and, with KPA-124, KPA-50 |
| [KPA-49](https://koinon.atlassian.net/browse/KPA-49) | A live tracker to poll. Unblocks KPA-124 |
| [KPA-71](https://koinon.atlassian.net/browse/KPA-71) | Somebody at both ends of the nabium push |
| [KPA-84](https://koinon.atlassian.net/browse/KPA-84) | Real mailboxes |

Neither key had arrived on 14 October 2026: `sukkal_local` held the three Google
connections and `Sukkal Resend`, nothing else. **Start KPA-12 or KPA-86 the
moment one lands**, because the two together open the retrieval and chat epic,
KPA-57, which stands at 0 of 7. Both stories carry stale text: KPA-12 names
`migrations/004_vector_indexes.sql`, but the HNSW indexes are already in
`migrations/001_core_schema.sql` and `src/embedding.ts` pins the model. It also
says 17 facts where the vault holds 19.

**KPA-50 waits for the issue sync**, by Shane's ruling of 14 October 2026.
KPA-124 and KPA-105 block it. **KPA-147 waits for KPA-166.**

**One subtask is open under a Done story.**
[KPA-22](https://koinon.atlassian.net/browse/KPA-22), the backup drill under
KPA-2, sits in To Do. Its one blocker, KPA-5, is Done, read on 14 October 2026.
The drill proves nothing until the vault is loaded into production `sukkal`, and
that load needs Shane, as *What not to touch alone* says.

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
