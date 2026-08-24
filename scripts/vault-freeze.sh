#!/usr/bin/env bash
#
# Freeze the memory vault so the migration has a stable thing to be checked
# against, and detect drift when something writes to it anyway.
#
#   vault-freeze.sh freeze    stop the three jobs and record the commit
#   vault-freeze.sh check     fail when the vault has moved since the freeze
#   vault-freeze.sh restore   start the three jobs again
#
# See docs/runbooks/vault-freeze.md.

set -euo pipefail

VAULT="${KPA_VAULT:-$HOME/Development/obsidian_vaults/Memory}"
STAMP="$(cd "$(dirname "$0")/.." && pwd)/docs/vault-freeze.txt"
AGENTS="$HOME/Library/LaunchAgents"
UID_="$(id -u)"
JOBS=(
  com.koinon.daily-memory-review
  com.koinon.gmail-filter-review
  com.koinon.weekly-vault-review
)

die() { printf '%s\n' "$*" >&2; exit 1; }

[[ -d "$VAULT/.git" ]] || die "no git repository at $VAULT"

case "${1:-}" in

freeze)
  # An uncommitted edit has no commit to record, so it cannot be compared
  # against later. Refuse rather than record a commit that is already stale.
  if [[ -n "$(git -C "$VAULT" status --porcelain)" ]]; then
    git -C "$VAULT" status --short
    die "the vault has uncommitted changes. Commit them, then freeze."
  fi

  for job in "${JOBS[@]}"; do
    launchctl bootout "gui/$UID_/$job" 2>/dev/null || true
    launchctl disable "gui/$UID_/$job"   # survives a reboot; bootout alone does not
    printf 'stopped  %s\n' "$job"
  done

  git -C "$VAULT" rev-parse HEAD > "$STAMP"
  printf 'recorded %s at %s\n' "$(cut -c1-8 < "$STAMP")" "$STAMP"
  ;;

check)
  [[ -f "$STAMP" ]] || die "no freeze recorded. Run: $0 freeze"
  want=$(cat "$STAMP")
  have=$(git -C "$VAULT" rev-parse HEAD)
  dirty=$(git -C "$VAULT" status --porcelain)

  if [[ "$want" != "$have" ]]; then
    printf 'the vault moved since the freeze:\n'
    git -C "$VAULT" --no-pager log --oneline "$want..$have"
    die "drift, not a migration defect. Reconcile before trusting the diff."
  fi
  [[ -z "$dirty" ]] || { git -C "$VAULT" status --short; die "the vault has uncommitted changes since the freeze."; }
  printf 'vault unchanged at %s\n' "$(cut -c1-8 < "$STAMP")"
  ;;

restore)
  for job in "${JOBS[@]}"; do
    launchctl enable "gui/$UID_/$job"
    launchctl bootstrap "gui/$UID_" "$AGENTS/$job.plist" 2>/dev/null || true
    if launchctl print "gui/$UID_/$job" >/dev/null 2>&1; then
      printf 'running  %s\n' "$job"
    else
      printf 'FAILED   %s\n' "$job"
    fi
  done
  ;;

*)
  die "usage: $0 {freeze|check|restore}"
  ;;
esac
