# Warm-standby disaster recovery

This directory covers the warm-standby replica and the promotion drill. The restore-from-backup
drill is separate; see [docs/DISASTER_RECOVERY.md](../../docs/DISASTER_RECOVERY.md).

## Topology

- **Primary** takes all writes.
- **Warm standby** is a PostgreSQL streaming replica. It is in recovery, follows the primary,
  and serves no writes. Its replay lag is the data at risk if the primary is lost.
- **Promotion** turns the standby into a writable primary. It is one-way: a promoted standby no
  longer follows the old primary, so the old primary must be rebuilt as a standby afterwards.

## Objectives

- Lag budget: `DRILL_MAX_LAG_SECONDS` (default 30s). A standby over budget is not promoted in a drill.
- Promotion time budget: `DRILL_RTO_BUDGET_SECONDS` (default 300s).

These are drill thresholds, not guarantees. Record measured values in the drill evidence.

## Configuration

Copy `replica.env.example` to a file outside the repository and fill it in. Never commit real
URLs or credentials. The example holds variable names and defaults only.

## Running the drill

The drill never touches the primary. It checks the standby, and only with `--execute` promotes it.

Check only (safe; prints the plan):

```powershell
$env:DRILL_PRIMARY_URL = "<primary url>"
$env:DRILL_STANDBY_URL = "<drill replica url>"
bash scripts/dr-drill.sh
```

Promote (destructive to the drill replica):

```powershell
$env:DR_DRILL_CONFIRM = "promote-drill-replica"
bash scripts/dr-drill.sh --execute
```

Run promotion only against a disposable drill replica. Confirm the URL points at the drill
host before setting `DR_DRILL_CONFIRM`.

## What the drill checks

1. The two URLs name different databases.
2. The standby reports `pg_is_in_recovery() = true`. A non-replica is refused.
3. Replay lag is within budget.
4. With `--execute`: `pg_promote()` succeeds, the node leaves recovery, a write to a canary table
   succeeds, and elapsed time is within the RTO budget.

## Evidence to keep

For each drill, record the date, the measured lag before promotion, the promotion time, the
canary write result, and who ran it. Attach the script output to the drill ticket.

## Known limits

- The drill does not measure data loss against the primary's last commit. Lag is replay lag as
  seen by the standby.
- It does not reroute application traffic. DNS or connection-string failover is a separate
  runbook step and is not exercised here.
- It has not been run against a live Postgres in this change. The guard behaviour is covered by
  `scripts/dr-drill.test.mjs`; the promotion path needs a drill run before it is relied on.
