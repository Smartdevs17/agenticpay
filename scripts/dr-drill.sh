#!/usr/bin/env bash
# Warm-standby promotion drill.
#
# Checks that a streaming replica is in recovery and caught up within a lag budget. With
# --execute it promotes the replica, checks that it accepts writes, and checks the elapsed
# time against an RTO budget. Without --execute it only checks, and prints the plan.
#
# Promotion is one-way: a promoted replica no longer follows the primary. Run this only
# against a disposable drill replica, never against the live standby. See infra/dr/README.md.
#
# The restore-from-backup drill is separate: scripts/disaster-recovery-drill.sh.

set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
usage: DRILL_PRIMARY_URL=... DRILL_STANDBY_URL=... [DR_DRILL_CONFIRM=promote-drill-replica] \
       scripts/dr-drill.sh [--execute]

  DRILL_PRIMARY_URL       primary database URL (used only to confirm it is a different database)
  DRILL_STANDBY_URL       standby database URL to check and, with --execute, promote
  DRILL_MAX_LAG_SECONDS   maximum replay lag allowed before the drill refuses (default 30)
  DRILL_RTO_BUDGET_SECONDS  maximum promotion time allowed (default 300)
  DR_DRILL_CONFIRM        must be exactly "promote-drill-replica" for --execute
USAGE
}

EXECUTE=0
case "${1:-}" in
  "") ;;
  --execute) EXECUTE=1 ;;
  -h | --help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

PRIMARY_URL="${DRILL_PRIMARY_URL:?DRILL_PRIMARY_URL is required}"
STANDBY_URL="${DRILL_STANDBY_URL:?DRILL_STANDBY_URL is required}"
MAX_LAG_SECONDS="${DRILL_MAX_LAG_SECONDS:-30}"
RTO_BUDGET_SECONDS="${DRILL_RTO_BUDGET_SECONDS:-300}"

if [ "$PRIMARY_URL" = "$STANDBY_URL" ]; then
  echo "Refusing promotion drill: primary and standby are the same database" >&2
  exit 1
fi

if [ "$EXECUTE" -eq 1 ] && [ "${DR_DRILL_CONFIRM:-}" != "promote-drill-replica" ]; then
  echo "Refusing --execute: set DR_DRILL_CONFIRM=promote-drill-replica to confirm the standby is disposable" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required" >&2
  exit 1
fi

in_recovery=$(psql "$STANDBY_URL" -v ON_ERROR_STOP=1 -Atc "SELECT pg_is_in_recovery()")
if [ "$in_recovery" != "t" ]; then
  echo "Standby is not in recovery, so it is not a replica. Refusing to continue." >&2
  exit 1
fi

# pg_last_xact_replay_timestamp() is NULL before any transaction has been replayed. An idle
# replica with no history therefore reports zero lag.
lag_seconds=$(psql "$STANDBY_URL" -v ON_ERROR_STOP=1 -Atc \
  "SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM now() - pg_last_xact_replay_timestamp()))::int, 0)")
if [ "$lag_seconds" -gt "$MAX_LAG_SECONDS" ]; then
  echo "Replay lag is ${lag_seconds}s, above the ${MAX_LAG_SECONDS}s budget. Refusing the drill." >&2
  exit 1
fi
echo "Standby is in recovery with replay lag ${lag_seconds}s (budget ${MAX_LAG_SECONDS}s)."

if [ "$EXECUTE" -eq 0 ]; then
  echo "Plan (not executed): promote the standby, confirm it accepts writes, and check the time against ${RTO_BUDGET_SECONDS}s."
  echo "Re-run with --execute and DR_DRILL_CONFIRM=promote-drill-replica to perform it."
  exit 0
fi

started=$(date +%s)
promoted=$(psql "$STANDBY_URL" -v ON_ERROR_STOP=1 -Atc "SELECT pg_promote(wait => true, wait_seconds => 60)")
if [ "$promoted" != "t" ]; then
  echo "pg_promote did not report success" >&2
  exit 1
fi

still_in_recovery=$(psql "$STANDBY_URL" -v ON_ERROR_STOP=1 -Atc "SELECT pg_is_in_recovery()")
if [ "$still_in_recovery" != "f" ]; then
  echo "Standby is still in recovery after promotion" >&2
  exit 1
fi

# Write probe: a promoted standby must accept writes. The table lives in the drill replica only.
psql "$STANDBY_URL" -v ON_ERROR_STOP=1 -q -c \
  "CREATE TABLE IF NOT EXISTS dr_drill_canary (id bigserial PRIMARY KEY, drilled_at timestamptz NOT NULL DEFAULT now()); INSERT INTO dr_drill_canary DEFAULT VALUES;"

elapsed=$(( $(date +%s) - started ))
if [ "$elapsed" -gt "$RTO_BUDGET_SECONDS" ]; then
  echo "Promotion took ${elapsed}s, above the ${RTO_BUDGET_SECONDS}s RTO budget" >&2
  exit 1
fi

echo "Promotion drill passed: standby promoted and writable in ${elapsed}s (budget ${RTO_BUDGET_SECONDS}s)."
