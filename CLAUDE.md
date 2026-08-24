# KPA conventions

Read `docs/project-brief.md` first. It carries the architecture, the decisions,
the policy the assistant operates under, and the risks accepted. `docs/adr/`
holds the decisions that were hard to reverse.

Work is tracked in Jira project KPA on `koinon.atlassian.net`.

## Committing: push straight to main

**This project accepts direct commits to `main`.** Shane decided this on
24 August 2026. Do not cut a branch, and do not open a pull request, unless he
asks for one.

This overrides the global rule in `~/.claude/CLAUDE.md`, which requires a branch
and a pull request. That rule still applies to every other project.

**It is temporary.** The repository holds documents, runbooks and setup scripts,
and one person writes all of them. Review by pull request costs more than it
returns while that stays true. Expect this section to be withdrawn once the
application code lands and a second reader has something to review.

`hooks/guard-commit-on-main.py` still denies a commit on `main`, because it
reads no project file. Prefix each command with the override the guard itself
names:

```
KOTHAR_ALLOW_MAIN=1 git commit -m "..."
KOTHAR_ALLOW_MAIN=1 git push
```

That prefix records the decision at the moment it is used, which is the point of
it. Do not disable the hook: it protects every other repository on this machine.

Every other rule in the global `CLAUDE.md` still holds. Absolute paths for every
delete. No destructive git without `KOTHAR_ALLOW_DESTRUCTIVE=1`. Commits credit
Shane and never Claude Code, and end with the `Claude-Session` line.

## The rest of these conventions

KPA-17 writes them: the build, test and migrate commands, the directory layout,
and how to reach the database. They are absent here because no code exists yet,
and a convention invented before the thing it governs is a convention nobody
follows.
