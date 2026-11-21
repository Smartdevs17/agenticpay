#!/usr/bin/env bash
# Installs dependencies, builds the frontend and runs the visual suite.
# Runs inside the official Playwright image — by the CI `visual` job and by
# ./docker.sh locally — so baselines are always rendered on the same stack.
# Arguments are passed to `playwright test` (e.g. --update-snapshots, -g overview).
set -euo pipefail

cd "$(dirname "$0")/../../.."   # frontend/

echo "::group::Install dependencies"
npm ci --prefer-offline --include=optional --no-audit --no-fund
# The lockfile is generated on macOS and omits Linux native binaries; same
# workaround as the cross-browser E2E job in .github/workflows/e2e.yml.
npm install --no-save --no-audit --no-fund \
  "@rollup/rollup-linux-x64-gnu@$(node -p "require('rollup/package.json').version")" \
  "lightningcss-linux-x64-gnu@$(node -p "require(require('path').join(require('path').dirname(require.resolve('lightningcss')), '..', 'package.json')).version")" \
  "@tailwindcss/oxide-linux-x64-gnu@$(node -p "require('@tailwindcss/oxide/package.json').version")"
echo "::endgroup::"

# VISUAL_BASE_URL points at an already running production server (see
# docker.sh); otherwise build here and let Playwright start `next start`.
if [ -z "${VISUAL_BASE_URL:-}" ]; then
  echo "::group::Build"
  NEXT_TELEMETRY_DISABLED=1 SENTRY_AUTH_TOKEN='' npm run build
  echo "::endgroup::"
fi

VISUAL_SKIP_BUILD=1 npx playwright test -c tests/e2e/visual/playwright.config.ts "$@"
