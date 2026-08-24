# Freezing the memory vault

The migration is checked by running the vault's `scripts/check.py` against the
vault, running KPA's checks against Postgres, and diffing the two reports. That
comparison is only worth anything if the vault holds still.

Three launchd jobs write to it. This runbook stops them, records the commit the
migration was checked against, and restores everything afterwards.

**The vault stops being maintained while it is frozen.** The nightly review stops
re-confirming stale facts and the weekly review stops proposing. That is the
price of a stable comparison, and it is why the freeze happens as late as it can.

## When to freeze

**Freeze before KPA-5.** That is the first story that reads the vault. Everything
before it stands up the database and the repository and never opens a note, so
freezing earlier only lengthens the outage for no gain.

**Unfreeze after KPA-13.** That is the story that runs the diff. Restoring
earlier lets a job write between two runs of the comparison.

## The three jobs

| Label | Script |
|---|---|
| `com.koinon.daily-memory-review` | `personal-assistant/scripts/daily-memory-review.sh` |
| `com.koinon.gmail-filter-review` | `personal-assistant/scripts/monthly-filter-review.sh` |
| `com.koinon.weekly-vault-review` | `personal-assistant/scripts/weekly-vault-review.sh` |

They are user agents in `~/Library/LaunchAgents`, so none of this needs `sudo`.

## Freeze

Run `scripts/vault-freeze.sh freeze`. It does the two things below and refuses to
continue when the vault has uncommitted changes, because an unrecorded edit
cannot be compared against later.

**Stop each job.** `bootout` unloads it now and `disable` keeps it unloaded
across a reboot. Unloading alone does not survive one, and this slice has no end
date.

```
launchctl bootout  gui/$(id -u)/com.koinon.daily-memory-review
launchctl disable  gui/$(id -u)/com.koinon.daily-memory-review
```

**Record the commit.** The vault is a git repository, so its `HEAD` is a precise
statement of what the migration was checked against.

```
git -C ~/Development/obsidian_vaults/Memory rev-parse HEAD > docs/vault-freeze.txt
```

## Check for drift

Run `scripts/vault-freeze.sh check`. It compares the vault's current `HEAD`
against the recorded one and exits non-zero when they differ.

The verification in KPA-13 runs this first. Without it, a stray write reads as a
migration defect, and the two are indistinguishable in a diff.

Pausing the jobs stops the writers that are known. The recorded commit catches
the ones that are not: Obsidian saving a note, an edit by hand, a git operation,
or the `.smart-env` plugin directory.

## Restore

Run `scripts/vault-freeze.sh restore`. For each job it re-enables and re-loads:

```
launchctl enable    gui/$(id -u)/com.koinon.daily-memory-review
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.koinon.daily-memory-review.plist
```

Then confirm all three are running again:

```
launchctl print gui/$(id -u)/com.koinon.daily-memory-review | head -3
```

**The vault retires in a later slice, not this one.** KPA-13 needs both systems
alive, so restore the jobs rather than leaving them off. Turning them off for
good is a decision that belongs to the story that retires the vault.
