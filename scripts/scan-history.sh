#!/usr/bin/env bash
#
# Scans the whole git history for a credential.
#
# Run it before every push. NFR-005 allows zero findings, and history is
# permanent: a repository that carried a key once carries it forever.
#
# Three checks, because no one of them is enough.
set -euo pipefail

cd "$(dirname "$0")/.."
failures=0

echo "== 1. gitleaks =="
if command -v gitleaks >/dev/null; then
  gitleaks git --no-banner . || failures=$((failures + 1))
  echo "   Note: gitleaks' default rules do not flag a database URL carrying a"
  echo "   password. Check 3 covers that. Proved on 27 August 2026."
else
  echo "   absent. brew install gitleaks"
  failures=$((failures + 1))
fi

echo
echo "== 2. the credentials in use =="
# Reads the private file rather than the repository. It names the variable it
# matched and prints no value, on every path.
#
# Matches one value against every commit, and skips a value that would fail
# every run rather than one that could leak:
#
#   empty            matches every commit.
#   all upper case   is the placeholder shape, the same one check 3 clears.
#   under 16 chars   is shorter than anything this project issues. The database
#                    password is 32 characters, SUKKAL_SECRET_KEY is 44, and both
#                    come from a generator. A shorter secret is skipped, and the
#                    answer to that is a longer secret.
#
# The caller skips a *_PATH or *_DIR by name before this runs.
#
# It names the commit and the file, because a commit hash is not a secret and
# is what somebody needs to scrub the history.
search_history() {
  local label=$1 value=$2 hits count
  [ -n "$value" ] || return 0
  case "$value" in *[!A-Z0-9_]*) ;; *) return 0 ;; esac
  [ "${#value}" -ge 16 ] || return 0
  # The value reaches git on standard input rather than in argv, which every
  # other user on the machine can read with ps.
  hits=$(printf '%s\n' "$value" | git grep -lF -f - $all_commits 2>/dev/null || true)
  [ -n "$hits" ] || return 0
  count=$(printf '%s\n' "$hits" | wc -l | tr -d ' ')
  echo "   FAIL: $label appears in the history, in $count commit(s)"
  printf '%s\n' "$hits" | head -5 | sed 's/^/     /' || true
  found=$((found + 1))
}

env_file="${SUKKAL_ENV_FILE:-$HOME/.config/sukkal/env}"
if [ -r "$env_file" ]; then
  found=0
  all_commits=$(git rev-list --all)
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; *=*) ;; *) continue ;; esac
    name=${line%%=*}
    name=${name#export }
    value=${line#*=}
    case "$value" in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
    esac
    # A *_PATH or *_DIR names a location on disk, not a credential. VAULT_PATH
    # holds a path under $HOME that the repository names throughout, so a search
    # for it fails every run. The rule reads the name and not the shape of the
    # value on purpose: a rule skipping every value that starts with a slash
    # would also skip a base64 key beginning with one, and base64 starts with a
    # slash one time in 64.
    # A path names a place on this machine and a url names where this
    # installation answers. Neither is a secret, and both belong in the
    # repository: SUKKAL_URL is http://localhost:3000 in .env.example and in four
    # source files, so comparing it fails every run and teaches a reader to
    # ignore this check. KPA-103 added it and this line with it.
    case "$name" in *_PATH|*_DIR) continue ;; esac
    # The two database URLs carry a password and are what this check exists
    # for, so they are named rather than matched by shape. Every other *_URL
    # names where something answers, which is not a secret and does belong in
    # the repository: SUKKAL_URL is http://localhost:3000 in .env.example and in
    # four source files, so comparing it fails every run and teaches a reader
    # to ignore this check. KPA-103 added it and this line with it.
    case "$name" in
      DATABASE_URL|DATABASE_URL_TEST) ;;
      *_URL) continue ;;
    esac
    search_history "the value of $name" "$value"
    # A connection string leaks whole, and its password also leaks alone. So
    # both are searched. The password is what this check found before KPA-137.
    password=$(printf '%s\n' "$value" | grep -oE '://[^:/@]+:[^@]+@' | sed -E 's|^://[^:]*:||; s|@$||' || true)
    if [ -n "$password" ]; then
      search_history "the password in $name" "$password"
    fi
  done < "$env_file"
  [ "$found" -eq 0 ] && echo "   clean: no value in $env_file appears in the history"
  failures=$((failures + found))
else
  echo "   $env_file is unreadable. See docs/runbooks/secrets.md"
  failures=$((failures + 1))
fi

echo
echo "== 3. connection strings carrying a password =="
# A placeholder or a shell variable is fine. A literal is not.
#
# Each line below is a match a person read and cleared. Add one only after
# reading the commit it comes from, and say why it is not a credential.
reviewed=(
  # A synthetic fixture, committed in cecd24f before this scan existed. The
  # host is 10.0.0.1 and the test never connects. The working tree now reads
  # PLACEHOLDER, so this match ends with that commit.
  "postgresql://someone:secret@10.0.0.1:5432/nowhere"

  # docs/runbooks/secrets.md quoted this decoy while explaining that gitleaks
  # does not catch a connection string. The password was invented for that
  # test and works on nothing. The runbook no longer spells it out, so this
  # match ends with commit 6c93cda.
  "postgresql://kpa:hunter2SuperSecret@192.168.20.110:5432/kpa"
)

hits=$(git grep -nE '(postgres(ql)?|mysql|mongodb(\+srv)?|redis|amqp)://[^/@[:space:]]+:[^/@[:space:]]+@' \
         $(git rev-list --all) 2>/dev/null || true)
# A loopback host reaches no network, so its password protects nothing. This
# is the same rule src/db/connect.ts applies when it lets loopback through in
# the clear, and it is what keeps the CI service container out of the report.
literals=$(echo "$hits" \
  | grep -vE ':[$][A-Za-z_{][^@]*@|:[A-Z_]+@' \
  | grep -vE '@(localhost|127\.0\.0\.1|\[?::1\]?)[:/]' || true)
for cleared in "${reviewed[@]}"; do
  literals=$(echo "$literals" | grep -vF "$cleared" || true)
done
if [ -n "$literals" ]; then
  echo "   FAIL: a literal password in a connection string"
  echo "$literals"
  failures=$((failures + 1))
else
  echo "   clean: every match is a placeholder, a shell variable, or reviewed"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "PASS: three checks, no finding."
else
  echo "FAIL: $failures check(s) reported something. Read the output above."
fi
exit "$failures"
