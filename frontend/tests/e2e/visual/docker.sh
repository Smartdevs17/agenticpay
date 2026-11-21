#!/usr/bin/env bash
# Runs the visual suite in the same Linux image and architecture as CI, from
# macOS, Windows (WSL) or Linux. Arguments are passed to `playwright test`:
#
#   npm run test:visual:docker                       # compare against baselines
#   npm run test:visual:docker -- --update-snapshots # re-record baselines
#
# The working tree is copied into the container (your host node_modules and
# .next are never touched); only __screenshots__/, playwright-report/ and
# test-results/ are mounted back.
#
# The in-container `next build` needs ~6 GB of Docker memory. With less, serve
# a production build from the host and only render in the container — pixels
# come from the container's browser and fonts, so baselines are unchanged:
#
#   npm run build && npm run start -- --port 3300 &
#   VISUAL_BASE_URL=http://host.docker.internal:3300 npm run test:visual:docker
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
FRONTEND="$REPO/frontend"

command -v docker >/dev/null || { echo "docker is required — install Docker Desktop" >&2; exit 1; }

# The image's browsers must match the locked @playwright/test version.
PW_VERSION="$(node -p "require('$FRONTEND/package-lock.json').packages['node_modules/@playwright/test'].version")"
IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"
WORKDIR=/work/frontend/tests/e2e/visual

mkdir -p "$HERE/__screenshots__" "$FRONTEND/playwright-report" "$FRONTEND/test-results"

echo "Running visual suite in $IMAGE (linux/amd64, same as CI)"
cd "$REPO"
git ls-files --cached --others --exclude-standard -z -- . ':!frontend/tests/e2e/visual/__screenshots__' \
  | tar --null -T - -cf - \
  | docker run --rm -i --platform linux/amd64 --ipc=host \
      -e CI="${CI:-}" \
      -e VISUAL_BASE_URL="${VISUAL_BASE_URL:-}" \
      --add-host=host.docker.internal:host-gateway \
      -v agenticpay-visual-npm-cache:/root/.npm \
      -v "$HERE/__screenshots__:$WORKDIR/__screenshots__" \
      -v "$FRONTEND/playwright-report:/work/frontend/playwright-report" \
      -v "$FRONTEND/test-results:/work/frontend/test-results" \
      "$IMAGE" \
      bash -c 'mkdir -p /work && tar -xf - -C /work && exec /work/frontend/tests/e2e/visual/run.sh "$@"' -- "$@"
