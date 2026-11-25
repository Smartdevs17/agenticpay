#!/usr/bin/env bash
# Fails when a range of commits adds `console.log(` to app code.
#
# Usage: scripts/no-console.sh [<base> [<head>]]
#   head defaults to HEAD. Without a usable base, the range is the commits on
#   <head> that are not on any remote-tracking branch (i.e. what a push of a
#   new branch would publish).
#
# Only lines *added* in the range are checked, so existing calls don't block
# unrelated changes. App code is .js/.jsx/.ts/.tsx/.mjs/.cjs under frontend/,
# backend/ and workers/, excluding tests, scripts, migrations, seeds,
# benchmarks, e2e, docs and *.config.* files. console.warn/error/info are
# allowed. Silence one intentional line with `// eslint-disable-line no-console`.
#
# Exit codes: 0 clean, 1 console.log found, 2 git/usage error.
# Run by .husky/pre-push; skip a push with `git push --no-verify` or HUSKY=0.
set -euo pipefail

if [ "$#" -gt 2 ]; then
  echo "usage: scripts/no-console.sh [<base> [<head>]]" >&2
  exit 2
fi

head_rev=${2:-HEAD}
base=${1:-}

if ! head=$(git rev-parse -q --verify "${head_rev}^{commit}"); then
  echo "no-console: unknown head revision '${head_rev}'" >&2
  exit 2
fi

# A base we can't resolve (e.g. the remote moved and we haven't fetched) is
# treated like a new branch rather than failing the push.
if [ -n "$base" ] && ! base=$(git rev-parse -q --verify "${base}^{commit}"); then
  base=
fi
if [ -z "$base" ]; then
  oldest=$(git rev-list --reverse "$head" --not --remotes | awk 'NR == 1')
  if [ -z "$oldest" ]; then
    exit 0 # nothing that isn't already on a remote
  fi
  base=$(git rev-parse -q --verify "${oldest}^" || git hash-object -t tree /dev/null)
fi

violations=$(
  git diff --no-color --no-ext-diff --unified=0 --diff-filter=AMR "$base" "$head" -- frontend backend workers |
    awk '
      function app_file(p) {
        if (p !~ /\.(js|jsx|ts|tsx|mjs|cjs)$/) return 0
        if (p ~ /\.(test|spec)\.[^\/]+$/ || p ~ /\.config\.[^\/]+$/ || p ~ /\.d\.ts$/) return 0
        if (p ~ /(^|\/)(__tests__|__mocks__|tests?|e2e|scripts|migrations|seed|benchmarks|docs)\//) return 0
        return 1
      }
      /^\+\+\+ / { file = substr($0, 7); check = (file != "dev/null") && app_file(file); next }
      /^@@ / {
        split($3, r, ","); line = substr(r[1], 2) + 0; next
      }
      /^\+/ {
        text = substr($0, 2)
        if (check && text ~ /console\.log[ \t]*\(/ && text !~ /eslint-disable-line no-console/ && text !~ /^[ \t]*(\/\/|\/\*|\*)/) {
          gsub(/^[ \t]+/, "", text)
          printf "%s:%d: %s\n", file, line, text
        }
        line++
      }
    '
)

if [ -z "$violations" ]; then
  exit 0
fi

count=$(printf '%s\n' "$violations" | wc -l | tr -d ' ')
{
  echo "no-console: ${count} console.log call(s) added to app code:"
  printf '%s\n' "$violations" | sed 's/^/  /'
  echo
  echo "Use the app logger (or console.warn/console.error), or mark an intentional"
  echo "line with '// eslint-disable-line no-console'. To skip this check once:"
  echo "git push --no-verify"
} >&2
exit 1
