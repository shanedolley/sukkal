#!/usr/bin/env bash
#
# Sets the owner's password, on the box itself, with no mail involved.
#
# ADR-0023 makes the application the only gate on every installation, so a lost
# password locks the owner out of three mailboxes and there is nobody to ask.
# ADR-0009 named this escape hatch and left it unbuilt. KPA-79 built it.
#
#   scripts/reset-password.sh                 ask for a new password and set it
#   scripts/reset-password.sh --link          print a link that sets one
#   scripts/reset-password.sh --link --url https://kpa.example
#   scripts/reset-password.sh --unlock        end a run of failed sign-ins
#
# `--unlock` is KPA-78's recovery path. Nobody is ever locked out, because a
# run of failures buys a wait and never a lock, so it shortens a wait rather
# than opening a door.
#
# THE PASSWORD IS TYPED, NEVER PASSED. `read -s` hides it and the pipe carries
# it, so it reaches neither `ps` nor a shell history. An option holding a
# password would be readable by every process on the box for as long as this
# one ran.
#
# It runs against DATABASE_URL, which on the server is the real database. That
# is the point of it.
set -euo pipefail

cd "$(dirname "$0")/.."

env_file="$HOME/.config/sukkal/env"
node_args=(--experimental-strip-types)
if [ -f "$env_file" ]; then
  node_args+=("--env-file=$env_file")
fi

# --link and --unlock ask for nothing, so the prompt below is skipped and the
# arguments go straight through.
for arg in "$@"; do
  if [ "$arg" = "--link" ] || [ "$arg" = "--unlock" ]; then
    exec node "${node_args[@]}" src/auth/reset-cli.ts "$@"
  fi
done

echo "This sets the password on this installation and signs every browser out."
echo

read -rsp "New password: " password
echo
read -rsp "Type it again: " again
echo

if [ "$password" != "$again" ]; then
  echo "The two do not match. Nothing changed." >&2
  exit 1
fi

printf '%s\n' "$password" | node "${node_args[@]}" src/auth/reset-cli.ts "$@"
