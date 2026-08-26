#!/bin/bash
set -euo pipefail

# AgenticPay Backup Script
# Handles daily full backups, incremental backups, and Point-In-Time Restore (PITR)
# Usage: ./backup.sh [full|incremental|restore|verify|pitr]

BACKUP_DIR="${BACKUP_DIR:-/var/backups/agenticpay}"
S3_BUCKET="${S3_BUCKET:-agenticpay-backups}"
S3_REGION="${S3_REGION:-us-east-1}"
DB_URL="${DATABASE_URL:-postgresql://localhost:5432/agenticpay}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:-}"
RTO_TARGET_HOURS=4
RPO_TARGET_HOURS=1

mkdir -p "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR/full"
mkdir -p "$BACKUP_DIR/incremental"
mkdir -p "$BACKUP_DIR/logs"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOGFILE="$BACKUP_DIR/logs/backup_$TIMESTAMP.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE"
}

notify_slack() {
    if [ -n "$SLACK_WEBHOOK" ]; then
        local message="$1"
        local color="${2:-good}"
        curl -s -X POST -H 'Content-type: application/json' \
            --data "{\"attachments\":[{\"color\":\"$color\",\"text\":\"$message\"}]}" \
            "$SLACK_WEBHOOK" > /dev/null 2>&1 || true
    fi
}

verify_backup_integrity() {
    local file="$1"
    log "Verifying backup integrity: $file"

    if ! gunzip -t "$file" 2>/dev/null; then
        log "ERROR: Integrity check failed (corrupt gzip): $file"
        return 1
    fi

    local checksum_file="${file}.sha256"
    if [ ! -f "$checksum_file" ]; then
        log "ERROR: Missing checksum file: $checksum_file"
        return 1
    fi

    # The stored checksum file is `sha256sum`-format ("<digest>  <path>").
    # Recompute the digest for the current file and compare, rather than
    # trusting `sha256sum -c` to resolve the original recorded path.
    local expected_checksum
    expected_checksum=$(awk '{print $1}' "$checksum_file")
    local actual_checksum
    actual_checksum=$(sha256sum "$file" | awk '{print $1}')

    if [ -z "$expected_checksum" ]; then
        log "ERROR: Checksum file is empty or malformed: $checksum_file"
        return 1
    fi

    if [ "$expected_checksum" != "$actual_checksum" ]; then
        log "ERROR: Checksum mismatch for $file (expected $expected_checksum, got $actual_checksum)"
        return 1
    fi

    log "Integrity check passed (gzip + checksum): $file"
    return 0
}

do_full_backup() {
    log "Starting full database backup..."
    local filename="full_backup_${TIMESTAMP}.sql.gz"
    local filepath="$BACKUP_DIR/full/$filename"

    if pg_dump "$DB_URL" | gzip > "$filepath"; then
        local size=$(du -h "$filepath" | cut -f1)
        log "Full backup completed: $filepath ($size)"

        if verify_backup_integrity "$filepath"; then
            # Create checksum
            sha256sum "$filepath" > "${filepath}.sha256"
            log "Checksum created: ${filepath}.sha256"

            # Upload to S3
            if command -v aws &>/dev/null; then
                aws s3 cp "$filepath" "s3://$S3_BUCKET/full/$filename" --region "$S3_REGION"
                aws s3 cp "${filepath}.sha256" "s3://$S3_BUCKET/full/${filename}.sha256" --region "$S3_REGION"
                log "Uploaded to S3: s3://$S3_BUCKET/full/$filename"
            else
                log "AWS CLI not found, skipping S3 upload (backup saved locally)"
            fi

            notify_slack "✅ Full backup completed successfully: $size" "good"
            return 0
        else
            rm -f "$filepath" "${filepath}.sha256"
            notify_slack "❌ Full backup integrity check failed" "danger"
            return 1
        fi
    else
        log "ERROR: Full backup failed"
        rm -f "$filepath"
        notify_slack "❌ Full backup failed" "danger"
        return 1
    fi
}

do_incremental_backup() {
    log "Starting incremental backup..."
    local filename="incr_backup_${TIMESTAMP}.sql.gz"
    local filepath="$BACKUP_DIR/incremental/$filename"

    # Get the latest full backup ID for metadata
    local latest_full=$(ls -t "$BACKUP_DIR/full/"*.sql.gz 2>/dev/null | head -1)
    if [ -z "$latest_full" ]; then
        log "ERROR: No full backup found. Run full backup first."
        return 1
    fi

    # pg_dump with --data-only for incremental (simplified approach)
    # In production, use WAL archiving
    if pg_dump "$DB_URL" --data-only --exclude-table=migrations | gzip > "$filepath"; then
        local size=$(du -h "$filepath" | cut -f1)
        log "Incremental backup completed: $filepath ($size)"

        if verify_backup_integrity "$filepath"; then
            sha256sum "$filepath" > "${filepath}.sha256"

            if command -v aws &>/dev/null; then
                aws s3 cp "$filepath" "s3://$S3_BUCKET/incremental/$filename" --region "$S3_REGION"
                aws s3 cp "${filepath}.sha256" "s3://$S3_BUCKET/incremental/${filename}.sha256" --region "$S3_REGION"
                log "Uploaded to S3: s3://$S3_BUCKET/incremental/$filename"
            fi

            return 0
        else
            rm -f "$filepath" "${filepath}.sha256"
            return 1
        fi
    else
        log "ERROR: Incremental backup failed"
        rm -f "$filepath"
        return 1
    fi
}

do_restore() {
    local restore_file="${1:-}"
    if [ -z "$restore_file" ]; then
        # Find latest full backup
        restore_file=$(ls -t "$BACKUP_DIR/full/"*.sql.gz 2>/dev/null | head -1)
    fi

    if [ -z "$restore_file" ] || [ ! -f "$restore_file" ]; then
        log "ERROR: No backup file specified or found"
        return 1
    fi

    log "Starting restore from: $restore_file"
    notify_slack "🔄 Starting database restore from: $(basename $restore_file)" "warning"

    if gunzip -c "$restore_file" | psql "$DB_URL"; then
        log "Restore completed successfully from: $restore_file"

        # Apply incremental backups if available
        for incr in $(ls -t "$BACKUP_DIR/incremental/"*.sql.gz 2>/dev/null); do
            log "Applying incremental backup: $incr"
            gunzip -c "$incr" | psql "$DB_URL" || true
        done

        notify_slack "✅ Database restore completed successfully" "good"
        return 0
    else
        log "ERROR: Restore failed from: $restore_file"
        notify_slack "❌ Database restore failed" "danger"
        return 1
    fi
}

do_verify_all() {
    log "Verifying all backups..."
    local errors=0

    for file in "$BACKUP_DIR/full/"*.sql.gz "$BACKUP_DIR/incremental/"*.sql.gz; do
        if [ -f "$file" ]; then
            if ! verify_backup_integrity "$file"; then
                errors=$((errors + 1))
            fi
        fi
    done

    if [ "$errors" -eq 0 ]; then
        log "All backups verified successfully"
        return 0
    else
        log "ERROR: $errors backup(s) failed verification"
        return 1
    fi
}

do_cleanup() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."
    local deleted=0

    # Clean full backups
    for file in "$BACKUP_DIR/full/"*.sql.gz; do
        if [ -f "$file" ]; then
            local file_time=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
            local age=$(( ( $(date +%s) - file_time ) / 86400 ))
            if [ "$age" -gt "$RETENTION_DAYS" ]; then
                rm -f "$file" "${file}.sha256"
                deleted=$((deleted + 1))
            fi
        fi
    done

    # Clean incremental backups
    for file in "$BACKUP_DIR/incremental/"*.sql.gz; do
        if [ -f "$file" ]; then
            local file_time=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null)
            local age=$(( ( $(date +%s) - file_time ) / 86400 ))
            if [ "$age" -gt "$RETENTION_DAYS" ]; then
                rm -f "$file" "${file}.sha256"
                deleted=$((deleted + 1))
            fi
        fi
    done

    log "Cleanup complete: removed $deleted old backup(s)"
}

to_epoch() {
    local ts="$1"
    # Format YYYYMMDD_HHMMSS -> YYYY-MM-DD HH:MM:SS
    if [[ "$ts" =~ ^[0-9]{8}_[0-9]{6}$ ]]; then
        local yyyymmdd="${ts%_*}"
        local hhmmss="${ts#*_}"
        ts="${yyyymmdd:0:4}-${yyyymmdd:4:2}-${yyyymmdd:6:2} ${hhmmss:0:2}:${hhmmss:2:2}:${hhmmss:4:2}"
    fi
    date -d "$ts" +%s
}

do_pitr() {
    local target_time="${1:-}"
    if [ -z "$target_time" ]; then
        log "ERROR: target timestamp (e.g. YYYYMMDD_HHMMSS or 'YYYY-MM-DD HH:MM:SS') is required for PITR"
        return 1
    fi

    local target_epoch
    target_epoch=$(to_epoch "$target_time")
    log "Starting Point-In-Time Restore to: $target_time (Epoch: $target_epoch)"

    # If RDS is configured and AWS CLI is installed, execute RDS PITR
    if command -v aws &>/dev/null && [ -n "${RDS_INSTANCE_IDENTIFIER:-}" ]; then
        log "RDS environment detected. Triggering RDS point-in-time restore..."
        local rds_time
        rds_time=$(date -u -d "@$target_epoch" +%Y-%m-%dT%H:%M:%SZ)
        aws rds restore-db-instance-to-point-in-time \
            --source-db-instance-identifier "$RDS_INSTANCE_IDENTIFIER" \
            --target-db-instance-identifier "${RDS_INSTANCE_IDENTIFIER}-pitr-${TIMESTAMP}" \
            --restore-time "$rds_time" \
            --region "$S3_REGION"
        log "RDS Point-In-Time Restore initiated to: ${RDS_INSTANCE_IDENTIFIER}-pitr-${TIMESTAMP}"
        notify_slack "🔄 RDS PITR initiated to $target_time" "warning"
        return 0
    fi

    # Local Simulated PITR
    log "Performing local simulated PITR restore..."
    
    # 1. Find the latest full backup older than or equal to target_epoch
    local best_full=""
    local best_full_epoch=0

    for file in "$BACKUP_DIR/full/"*.sql.gz; do
        if [ -f "$file" ]; then
            # Extract timestamp from full_backup_YYYYMMDD_HHMMSS.sql.gz
            local base
            base=$(basename "$file")
            local ts_part
            ts_part=$(echo "$base" | sed -E 's/full_backup_(.*)\.sql\.gz/\1/')
            local epoch
            epoch=$(to_epoch "$ts_part")
            if [ "$epoch" -le "$target_epoch" ] && [ "$epoch" -gt "$best_full_epoch" ]; then
                best_full="$file"
                best_full_epoch="$epoch"
            fi
        fi
    done

    if [ -z "$best_full" ]; then
        log "ERROR: No full backup found older than or equal to target time: $target_time"
        return 1
    fi

    log "Found base full backup: $(basename "$best_full") (Epoch: $best_full_epoch)"
    notify_slack "🔄 Starting PITR: base full backup $(basename "$best_full")" "warning"

    # Restore base full backup
    if gunzip -c "$best_full" | psql "$DB_URL"; then
        log "Base full backup restored successfully."
    else
        log "ERROR: Failed to restore base full backup: $best_full"
        notify_slack "❌ PITR restore failed at base backup stage" "danger"
        return 1
    fi

    # 2. Find and apply incremental backups between best_full_epoch and target_epoch
    local incr_backups=()
    for file in "$BACKUP_DIR/incremental/"*.sql.gz; do
        if [ -f "$file" ]; then
            local base
            base=$(basename "$file")
            local ts_part
            ts_part=$(echo "$base" | sed -E 's/incr_backup_(.*)\.sql\.gz/\1/')
            local epoch
            epoch=$(to_epoch "$ts_part")
            if [ "$epoch" -gt "$best_full_epoch" ] && [ "$epoch" -le "$target_epoch" ]; then
                incr_backups+=("$epoch|$file")
            fi
        fi
    done

    # Sort incremental backups chronologically
    if [ ${#incr_backups[@]} -gt 0 ]; then
        # Sort array
        IFS=$'\n' sorted_incr=($(sort -n <<<"${incr_backups[*]}"))
        unset IFS

        log "Applying ${#sorted_incr[@]} incremental backups..."
        for item in "${sorted_incr[@]}"; do
            local file="${item#*|}"
            log "Applying incremental backup: $(basename "$file")"
            if gunzip -c "$file" | psql "$DB_URL"; then
                log "Applied: $(basename "$file")"
            else
                log "ERROR: Failed to apply incremental backup: $file"
                notify_slack "❌ PITR failed applying incremental backup $(basename "$file")" "danger"
                return 1
            fi
        done
    else
        log "No incremental backups to apply in target time window."
    fi

    log "Point-In-Time Restore completed successfully to $target_time"
    notify_slack "✅ PITR restore completed successfully to $target_time" "good"
    return 0
}

# Main
case "${1:-full}" in
    full)
        do_full_backup
        do_cleanup
        ;;
    incremental)
        do_incremental_backup
        ;;
    restore)
        do_restore "${2:-}"
        ;;
    verify)
        do_verify_all
        ;;
    pitr)
        do_pitr "${2:-}"
        ;;
    *)
        echo "Usage: $0 [full|incremental|restore <file>|verify|pitr <timestamp>]"
        echo ""
        echo "  full             - Create full database backup"
        echo "  incremental      - Create incremental backup"
        echo "  restore          - Restore from backup file"
        echo "  verify           - Verify all backup integrity"
        echo "  pitr <timestamp> - Point-In-Time Restore to a specific timestamp (e.g. YYYYMMDD_HHMMSS)"
        exit 1
        ;;
esac