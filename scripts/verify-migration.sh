#!/usr/bin/env bash
#
# Verify the migration against the frozen vault, in one command. KPA-13.
#
#   scripts/verify-migration.sh
#
# 1. Fail when the vault has moved since the freeze, so drift never reads as a
#    migration defect (REQ-032).
# 2. Run the vault's own check.py, and the independent counter beside it.
# 3. Make a fresh local database, migrate it, load the vault into it, and
#    render Sukkal's report in check.py's layout.
# 4. Diff the two reports and reconcile the five counts. Exit 1 on anything no
#    recorded decision explains.
#
# It only ever writes a database whose name starts with sukkal_verify, because
# step 3 empties it. Set VERIFY_DATABASE to use another one of those.
# docs/runbooks/migration-verification.md says how to read the output.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VAULT="${VAULT_PATH:-$HOME/Development/obsidian_vaults/Memory}"
DB="${VERIFY_DATABASE:-sukkal_verify}"
URL="postgresql://$(whoami)@localhost:5432/$DB"

die() { printf '%s\n' "$*" >&2; exit 1; }

[[ "$DB" == sukkal_verify* ]] || die "refusing $DB: this script empties its database, so the name must start with sukkal_verify"
[[ -f "$VAULT/scripts/check.py" ]] || die "no check.py at $VAULT/scripts/check.py. Set VAULT_PATH"

# check.py reads today's date and takes no argument, so both reports have to
# be written on one day. The day is read now and again at the end.
today="$(date +%F)"

SUKKAL_VAULT="$VAULT" "$ROOT/scripts/vault-freeze.sh" check

work="$(mktemp -d)"
printf 'reports in %s\n' "$work"

# check.py exits 1 when it finds a problem. That is still a report to diff,
# so its status is kept rather than allowed to stop the run.
status=0
python3 "$VAULT/scripts/check.py" >| "$work/check.txt" || status=$?
[[ $status -le 1 ]] || die "check.py failed to run (exit $status)"
python3 "$ROOT/scripts/count-vault.py" "$VAULT" >| "$work/counts.json"

dropdb --if-exists "$DB"
createdb "$DB"
psql -d "$DB" -qc "CREATE EXTENSION IF NOT EXISTS vector"
DATABASE_URL="$URL" npm --prefix "$ROOT" run --silent migrate >/dev/null

verdict=0
VERIFY_DATABASE_URL="$URL" VAULT_PATH="$VAULT" node "$ROOT/scripts/verify-migration.ts" \
  --today "$today" --check-report "$work/check.txt" --counts "$work/counts.json" || verdict=$?

[[ "$(date +%F)" == "$today" ]] || die "the date changed during the run, so the two reports may disagree for that alone. Run it again."
exit "$verdict"
