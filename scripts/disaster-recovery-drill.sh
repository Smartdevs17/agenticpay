#!/bin/bash
set -euo pipefail

# Restores the newest full backup into an explicitly separate drill database
# and verifies that PostgreSQL can read the restored schema. The target guard
# prevents an operator from accidentally drilling against the source database.

SOURCE_DATABASE_URL="${DATABASE_URL:?DATABASE_URL is required}"
TARGET_DATABASE_URL="${DRILL_DATABASE_URL:?DRILL_DATABASE_URL is required}"
BACKUP_ROOT="${BACKUP_DIR:-/var/backups/agenticpay}"

if [ "$SOURCE_DATABASE_URL" = "$TARGET_DATABASE_URL" ]; then
  echo "Refusing disaster-recovery drill: source and target databases are identical" >&2
  exit 1
fi

latest_backup=$(find "$BACKUP_ROOT/full" -maxdepth 1 -type f -name 'full_backup_*.sql.gz' -print | sort | tail -1)
if [ -z "$latest_backup" ]; then
  echo "No full backup found under $BACKUP_ROOT/full" >&2
  exit 1
fi

DATABASE_URL="$SOURCE_DATABASE_URL" bash scripts/backup.sh verify
DATABASE_URL="$TARGET_DATABASE_URL" bash scripts/backup.sh restore "$latest_backup"

psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
schema_count=$(psql "$TARGET_DATABASE_URL" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'")

echo "Disaster-recovery drill passed: restored $(basename "$latest_backup") with $schema_count public tables"
