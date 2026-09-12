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

**Point the running application at `kpa_local`.** The suite drops every table in
`kpa_dev`, and it has already destroyed a person's work once.

**Ask the source rather than a summary.** Open the file, run the statement,
call the API. A subagent that contradicts you has been right before.

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

## When a decision needs a person

Stop the story, move it to the `Decision required` status with transition id 2,
and post a Jira comment carrying:

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
  command refuses it without `KPA_ALLOW_PRODUCTION=1`.
- **A live OAuth grant.** The consent screen is Shane's to press. Build the
  whole path, prove every part that needs no vendor, and hand him the button.

## In chat

Link every Jira ID as a clickable markdown link.

Say what you dispatched to a subagent and what came back, and verify it before
repeating it as fact.

## Start here

**Shane asked for [KPA-149](https://koinon.atlassian.net/browse/KPA-149) next,
on 12 September 2026.** The assistant takes the name Sukkal. Two stories sit
under that epic and the first blocks the second.

1. **[KPA-150](https://koinon.atlassian.net/browse/KPA-150)**, three points.
   Carry the name through every document and the one screen that shows it. Wide
   rather than deep, and the risk is renaming a machine identifier by accident.
   The ticket names the six that stay and why.
2. **[KPA-151](https://koinon.atlassian.net/browse/KPA-151)**, five points.
   Draw Isimud, Enki's two-faced sukkal, slightly animated, and still under
   `prefers-reduced-motion`. The ticket names the artefact to work from and the
   risk it carries: two faces at 16px may not survive, and it says what to give
   up if they do not.

Read the epic before either story. It holds what a sukkal was, three who held
the office, why the name fits a policy engine, and why a role rather than a
person's name leaves the instance its own.

**Three things Shane may want a ruling on**, and none blocks the work:

- Whether any of the six machine identifiers should move too. KPA-150 asks.
- The colour. The avatar takes the accent colour today, so Preferences changes
  it. Any colour fixed for Isimud's sake is a decision worth naming rather than
  an accident.
- Whether the name reaches the Jira project. It does not, and 558 story keys
  are why.

## After that

1. **[KPA-146](https://koinon.atlassian.net/browse/KPA-146)**, one point.
   `X-Content-Type-Options` and a frame policy. The `headers()` function and
   `apps/web/scripts/check-headers.ts` already exist, so each is a line and an
   assertion.
2. **Close out [KPA-103](https://koinon.atlassian.net/browse/KPA-103).** Two
   criteria remain, and `handover.md` says which.
3. **Raise the deployment story.** Nothing serves the web tier, no tunnel
   exists, and `KPA_URL` names localhost because there is no other address.
   [KPA-147](https://koinon.atlassian.net/browse/KPA-147) waits on it and no
   ticket anywhere on the board creates it.

Most of what is left needs something only Shane can supply. Forty stories are
open and five of them are unblocked: KPA-50, KPA-146, KPA-148, KPA-150 and
KPA-151. The other thirty-five wait on one OAuth grant, a metered key, a live
Jira site, a deployment, or him at both ends of nabium. Measured on
12 September 2026. Read the blockers before picking, and prefer what unblocks
the most.
