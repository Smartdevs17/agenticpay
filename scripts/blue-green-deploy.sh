#!/usr/bin/env bash
set -euo pipefail

APP_NAME="${APP_NAME:-agenticpay}"
NAMESPACE="${KUBE_NAMESPACE:-production}"
SERVICE_NAME="${SERVICE_NAME:-$APP_NAME}"
CONTAINER_NAME="${CONTAINER_NAME:-$APP_NAME}"
HEALTH_PATH="${HEALTH_PATH:-/api/v1/health}"
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-5m}"
IMAGE=""
TARGET_COLOR=""
DRY_RUN=false

usage() {
  echo "Usage: $0 --image <registry/image:tag> [--target blue|green] [--dry-run]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) IMAGE="${2:-}"; shift 2 ;;
    --target) TARGET_COLOR="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[[ -n "$IMAGE" ]] || { echo "--image is required" >&2; exit 1; }
[[ -z "$TARGET_COLOR" || "$TARGET_COLOR" == "blue" || "$TARGET_COLOR" == "green" ]] || {
  echo "--target must be blue or green" >&2; exit 1;
}

run() {
  if [[ "$DRY_RUN" == "true" ]]; then
    printf '+ '; printf '%q ' "$@"; printf '\n'
  else
    "$@"
  fi
}

if [[ "$DRY_RUN" == "true" ]]; then
  TARGET_COLOR="${TARGET_COLOR:-green}"
  ACTIVE_COLOR="$([[ "$TARGET_COLOR" == "blue" ]] && echo green || echo blue)"
else
  ACTIVE_COLOR="$(kubectl -n "$NAMESPACE" get service "$SERVICE_NAME" -o jsonpath='{.spec.selector.color}')"
  case "$ACTIVE_COLOR" in
    blue) TARGET_COLOR="${TARGET_COLOR:-green}" ;;
    green) TARGET_COLOR="${TARGET_COLOR:-blue}" ;;
    *) echo "Service selector must identify an active blue or green deployment" >&2; exit 1 ;;
  esac
  [[ "$TARGET_COLOR" != "$ACTIVE_COLOR" ]] || {
    echo "Refusing to update the active $ACTIVE_COLOR slot" >&2; exit 1;
  }
fi

TARGET_DEPLOYMENT="${APP_NAME}-${TARGET_COLOR}"
PREVIEW_SERVICE="${APP_NAME}-${TARGET_COLOR}"

echo "Deploying $IMAGE to $TARGET_DEPLOYMENT (active: $ACTIVE_COLOR)"
run kubectl -n "$NAMESPACE" set image "deployment/$TARGET_DEPLOYMENT" "$CONTAINER_NAME=$IMAGE"
run kubectl -n "$NAMESPACE" rollout status "deployment/$TARGET_DEPLOYMENT" --timeout="$ROLLOUT_TIMEOUT"

if [[ "$DRY_RUN" != "true" ]]; then
  PREVIEW_URL="${PREVIEW_URL:-http://${PREVIEW_SERVICE}.${NAMESPACE}.svc.cluster.local${HEALTH_PATH}}"
  curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 3 "$PREVIEW_URL" >/dev/null
fi

echo "Health checks passed; switching $SERVICE_NAME to $TARGET_COLOR"
run kubectl -n "$NAMESPACE" patch service "$SERVICE_NAME" --type merge -p "{\"spec\":{\"selector\":{\"app\":\"$APP_NAME\",\"color\":\"$TARGET_COLOR\"}}}"

if [[ "$DRY_RUN" != "true" && -n "${PUBLIC_HEALTH_URL:-}" ]]; then
  if ! curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 2 "$PUBLIC_HEALTH_URL" >/dev/null; then
    echo "Post-switch health check failed; restoring $ACTIVE_COLOR" >&2
    kubectl -n "$NAMESPACE" patch service "$SERVICE_NAME" --type merge -p "{\"spec\":{\"selector\":{\"app\":\"$APP_NAME\",\"color\":\"$ACTIVE_COLOR\"}}}"
    exit 2
  fi
fi

echo "Blue-green deployment complete: $TARGET_COLOR is active"
