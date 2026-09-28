# Disaster recovery runbook

This runbook defines the recovery process for the AgenticPay PostgreSQL data
plane. The objectives are an RPO of one hour and an RTO of four hours. Incident
commanders must record actual recovery times and data loss in the incident log.

## Preparation and ownership

- Primary owner: on-call platform engineer.
- Approver for production restore: incident commander plus database owner.
- Full backups run daily; incremental backups run every six hours. Production
  deployments should use WAL archiving to meet the one-hour RPO.
- Backups require SHA-256 verification before upload or restore.
- Quarterly restore drills must target an isolated database and preserve the
  workflow artifact/log as evidence.

## Incident procedure

1. Declare the incident, freeze database migrations and payment writes, and
   record the suspected corruption time.
2. Confirm whether the primary can be recovered in place. Prefer failover to a
   healthy replica for infrastructure-only failures.
3. List and verify restore candidates:

   ```bash
   BACKUP_DIR=/var/backups/agenticpay bash scripts/backup.sh verify
   ```

4. Select the newest verified full backup before the incident, then either:

   ```bash
   DATABASE_URL="$RECOVERY_DATABASE_URL" bash scripts/backup.sh restore /path/to/full_backup.sql.gz
   DATABASE_URL="$RECOVERY_DATABASE_URL" bash scripts/backup.sh pitr '2026-09-25 10:00:00'
   ```

5. Validate migrations, table counts, a read-only payment query, queue health,
   and reconciliation totals before directing traffic to the recovered system.
6. Rotate credentials exposed during response, re-enable writes gradually, and
   monitor payment failures, lag, and reconciliation mismatches.
7. Publish the achieved RPO/RTO, missing transactions, and follow-up actions.

## Automated restore drill

The drill refuses to run when source and target URLs are identical:

```bash
DATABASE_URL="$SOURCE_DATABASE_URL" \
DRILL_DATABASE_URL="$ISOLATED_DATABASE_URL" \
BACKUP_DIR=/tmp/agenticpay-drill \
bash scripts/disaster-recovery-drill.sh
```

Use the `Database Backup` workflow's `drill` dispatch option for CI evidence.
The target database is disposable; never use a production connection string as
`DRILL_DATABASE_URL`.

## Recovery verification checklist

- [ ] Backup gzip and SHA-256 validation passed.
- [ ] Restore used an isolated target first.
- [ ] Schema and migration state match the release being recovered.
- [ ] Payment totals reconcile against ledger/provider records.
- [ ] Background queues and webhook delivery resume without duplication.
- [ ] RPO and RTO measurements are attached to the incident.
