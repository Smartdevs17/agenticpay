#!/bin/bash
set -euo pipefail

# AgenticPay Backup Script
# Handles daily full backups and incremental backups
# Usage: ./backup.sh [full|incremental|restore|verify]

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
    *)
        echo "Usage: $0 [full|incremental|restore <file>|verify]"
        echo ""
        echo "  full        - Create full database backup"
        echo "  incremental - Create incremental backup"
        echo "  restore     - Restore from backup file"
        echo "  verify      - Verify all backup integrity"
        exit 1
        ;;
esac