# Koinon Personal Assistant

A hosted web application that acts as Shane Dolley's personal assistant. It
connects to three Google Workspace accounts, ingests meeting transcripts from
nabium, and maintains a memory that learns and corrects itself.

It runs on `amaterasu`, a Mac mini running Ubuntu, and is reached through
Cloudflare Access.

## Where things are

| Path | Holds |
|---|---|
| `docs/project-brief.md` | what we are building, why, and every decision made so far |
| `docs/adr/` | the decisions that were hard to reverse, with the options they beat |

**Read the brief first.** It carries the architecture, the sequence diagrams, the
policy the assistant operates under, the risks accepted, and the questions still
open.

## Work

Tracked in Jira project **KPA** on `koinon.atlassian.net`.

Stories carry their own specification: acceptance criteria, the files they touch,
the test that proves them, and a definition of done an agent can check without
asking. They derive from the brief. Where the two disagree, the brief gets fixed
rather than the story rewritten to match the code.

## Related repositories

**nabium**, at `~/Development/personal/nabium`. Captures and transcribes meetings
on macOS. KPA reads its database through a read-only role and it pushes a session
id over the LAN when one is ready. See ADR-0003.

**personal-assistant**, at `~/Development/personal/personal-assistant`, and the
**Memory vault** at `~/Development/obsidian_vaults/Memory`. The markdown system
KPA replaces. Its principles carry forward and the brief records which.
