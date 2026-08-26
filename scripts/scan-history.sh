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
# Reads the private file rather than the repository, and prints no value.
env_file="${KPA_ENV_FILE:-$HOME/.config/kpa/env}"
if [ -r "$env_file" ]; then
  found=0
  while IFS= read -r secret; do
    [ -n "$secret" ] || continue
    if git grep -qF "$secret" $(git rev-list --all) 2>/dev/null; then
      echo "   FAIL: a password from $env_file appears in the history"
      found=1
    fi
  done < <(grep -oE '://[^:/@]+:[^@]+@' "$env_file" | sed -E 's|^://[^:]*:||; s|@$||' | sort -u)
  [ "$found" -eq 0 ] && echo "   clean: no password from $env_file appears in the history"
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
