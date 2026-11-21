/**
 * BackupAutomationService — Issue #880
 *
 * Unified service that consolidates all database backup and restore logic:
 *  - Full backups (pg_dump, gzip-compressed)
 *  - Incremental backups (WAL / data-only pg_dump)
 *  - Persist to local disk and optionally to S3 (via AWS SDK or simulated)
 *  - Restore from a restore point (full + incremental chain)
 *  - Dry-run restore (validates the chain without touching the live DB)
 *  - Point-in-time recovery (PITR) lookup
 *  - Scheduling awareness: exposes the recommended schedules so the job
 *    registry can import them without coupling to node-cron directly.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const execAsync = promisify(exec);

// ── Config ─────────────────────────────────────────────────────────────────

export interface BackupAutomationConfig {
  /** PostgreSQL connection string. */
  dbUrl: string;
  /** Local directory for backup files. */
  backupDir: string;
  /** S3 bucket name (optional). */
  s3Bucket: string;
  /** AWS region for S3 uploads. */
  s3Region: string;
  /** Number of days to keep completed backups. */
  retentionDays: number;
  /** Whether S3 upload is enabled. */
  useS3: boolean;
  /** PITR window in hours — how far back in time a restore can target. */
  pitrWindowHours: number;
  /** If true, skip actual pg_dump / psql commands (for testing). */
  dryRunMode: boolean;
}

const DEFAULT_CONFIG: BackupAutomationConfig = {
  dbUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/agenticpay',
  backupDir: process.env.BACKUP_DIR ?? '/var/backups/agenticpay',
  s3Bucket: process.env.S3_BACKUP_BUCKET ?? 'agenticpay-backups',
  s3Region: process.env.S3_REGION ?? 'us-east-1',
  retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS ?? '30', 10),
  useS3: process.env.BACKUP_USE_S3 === 'true',
  pitrWindowHours: parseInt(process.env.BACKUP_PITR_WINDOW_HOURS ?? '168', 10), // 7 days
  dryRunMode: false,
};

// ── Types ──────────────────────────────────────────────────────────────────

export type BackupType = 'full' | 'incremental';
export type BackupStatus = 'running' | 'completed' | 'failed';
export type RestorePointStatus = 'available' | 'restoring' | 'restored' | 'failed';

export interface BackupRecord {
  id: string;
  type: BackupType;
  status: BackupStatus;
  /** Compressed file size in bytes (0 while running or on failure). */
  sizeBytes: number;
  /** SHA-256 hex digest of the backup file. */
  checksum: string;
  /** Absolute path to the backup file on disk. */
  path: string;
  /** S3 object key (undefined if S3 is disabled or upload not yet done). */
  s3Key?: string;
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface RestorePoint {
  id: string;
  /** When this restore point was created. */
  timestamp: Date;
  /** BackupRecord id for the full backup. */
  fullBackupId: string;
  /** Ordered list of incremental backup ids to apply after the full restore. */
  incrementalBackupIds: string[];
  status: RestorePointStatus;
}

export interface PitrEntry {
  timestamp: Date;
  restorePointId: string;
  description: string;
}

export interface DryRunResult {
  /** Whether all referenced backup files exist and checksums are valid. */
  valid: boolean;
  /** Human-readable messages about what would happen (or what failed). */
  messages: string[];
  restorePointId: string;
}

// ── Recommended schedules (consumed by scheduled-tasks.ts) ─────────────────

export const BACKUP_SCHEDULES = {
  /** Full backup — every day at 02:00 UTC. */
  FULL: '0 2 * * *',
  /** Incremental backup — every 6 hours (00:00, 06:00, 12:00, 18:00). */
  INCREMENTAL: '0 0,6,12,18 * * *',
  /** Retention cleanup — every Sunday at 04:00 UTC. */
  CLEANUP: '0 4 * * 0',
} as const;

// ── Service ────────────────────────────────────────────────────────────────

export class BackupAutomationService {
  private readonly cfg: BackupAutomationConfig;

  /** In-memory store of backup records (keyed by id). */
  private backups = new Map<string, BackupRecord>();

  /** In-memory store of restore points (keyed by id). */
  private restorePoints = new Map<string, RestorePoint>();

  constructor(cfg: Partial<BackupAutomationConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...cfg };
    this.ensureBackupDir();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Run a full pg_dump, compress, verify, and optionally upload to S3.
   * Creates a new restore point anchored to this full backup.
   */
  async runFullBackup(): Promise<BackupRecord> {
    const id = this.newId('full');
    const timestamp = this.fileTimestamp();
    const filename = `full_backup_${timestamp}.sql.gz`;
    const filepath = join(this.cfg.backupDir, filename);

    const record: BackupRecord = {
      id,
      type: 'full',
      status: 'running',
      sizeBytes: 0,
      checksum: '',
      path: filepath,
      startedAt: new Date(),
    };
    this.backups.set(id, record);

    try {
      await this.dumpDatabase(filepath, false);

      const { sizeBytes, checksum } = await this.fileMeta(filepath);
      record.sizeBytes = sizeBytes;
      record.checksum = checksum;
      record.status = 'completed';
      record.completedAt = new Date();

      if (this.cfg.useS3) {
        const s3Key = `full/${filename}`;
        await this.uploadToS3(filepath, s3Key);
        record.s3Key = s3Key;
      }

      // Anchor a fresh restore point to this full backup
      this.createRestorePoint(id);

      // Track PITR entry
      this.addPitrEntry(this.getLatestRestorePointForFull(id)?.id ?? id, `Full backup ${id}`);

      console.log(
        `[BackupAutomation] Full backup done: ${id}  size=${(sizeBytes / 1024 / 1024).toFixed(2)} MB`,
      );

      // Background cleanup (non-fatal)
      this.cleanupOldBackups().catch((err) =>
        console.error('[BackupAutomation] Cleanup error:', err),
      );
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
      console.error(`[BackupAutomation] Full backup failed: ${record.error}`);
    }

    this.backups.set(id, record);
    return record;
  }

  /**
   * Run an incremental pg_dump (data-only, excluding migration tables) on top
   * of the most recent available full backup.
   */
  async runIncrementalBackup(): Promise<BackupRecord> {
    const latestFull = this.getLatestCompletedFull();

    const id = this.newId('incr');
    const timestamp = this.fileTimestamp();
    const filename = `incr_backup_${timestamp}.sql.gz`;
    const filepath = join(this.cfg.backupDir, filename);

    const record: BackupRecord = {
      id,
      type: 'incremental',
      status: 'running',
      sizeBytes: 0,
      checksum: '',
      path: filepath,
      startedAt: new Date(),
    };
    this.backups.set(id, record);

    try {
      await this.dumpDatabase(filepath, true);

      const { sizeBytes, checksum } = await this.fileMeta(filepath);
      record.sizeBytes = sizeBytes;
      record.checksum = checksum;
      record.status = 'completed';
      record.completedAt = new Date();

      if (this.cfg.useS3) {
        const s3Key = `incremental/${filename}`;
        await this.uploadToS3(filepath, s3Key);
        record.s3Key = s3Key;
      }

      // Attach to the restore point associated with the latest full backup
      if (latestFull) {
        const rp = this.getLatestRestorePointForFull(latestFull.id);
        if (rp) {
          rp.incrementalBackupIds.push(id);
          this.addPitrEntry(rp.id, `Incremental backup ${id} on full ${latestFull.id}`);
        }
      }

      console.log(
        `[BackupAutomation] Incremental backup done: ${id}  size=${(sizeBytes / 1024 / 1024).toFixed(2)} MB`,
      );
    } catch (err) {
      record.status = 'failed';
      record.error = err instanceof Error ? err.message : String(err);
      console.error(`[BackupAutomation] Incremental backup failed: ${record.error}`);
    }

    this.backups.set(id, record);
    return record;
  }

  /**
   * Restore a database from a named restore point, applying the full backup
   * then each incremental in order.
   *
   * @param restorePointId - The id of the restore point to restore from.
   * @param targetDbUrl - Optional override for the target database URL.
   */
  async restore(restorePointId: string, targetDbUrl?: string): Promise<boolean> {
    const rp = this.restorePoints.get(restorePointId);
    if (!rp) throw new Error(`Restore point not found: ${restorePointId}`);

    const target = targetDbUrl ?? this.cfg.dbUrl;
    rp.status = 'restoring';

    try {
      const fullRecord = this.backups.get(rp.fullBackupId);
      if (!fullRecord) throw new Error(`Full backup record not found: ${rp.fullBackupId}`);

      await this.restoreFile(fullRecord.path, target);

      for (const incrId of rp.incrementalBackupIds) {
        const incrRecord = this.backups.get(incrId);
        if (!incrRecord) {
          console.warn(`[BackupAutomation] Incremental ${incrId} not found — skipping`);
          continue;
        }
        await this.restoreFile(incrRecord.path, target);
      }

      rp.status = 'restored';
      console.log(`[BackupAutomation] Restore complete → ${target}`);
      return true;
    } catch (err) {
      rp.status = 'failed';
      console.error(
        `[BackupAutomation] Restore failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Validates a restore point chain (file existence + checksum) without
   * actually touching the database.
   */
  async dryRunRestore(restorePointId: string): Promise<DryRunResult> {
    const rp = this.restorePoints.get(restorePointId);
    const messages: string[] = [];

    if (!rp) {
      return {
        valid: false,
        messages: [`Restore point "${restorePointId}" not found`],
        restorePointId,
      };
    }

    let valid = true;

    // Check full backup
    const fullRecord = this.backups.get(rp.fullBackupId);
    if (!fullRecord) {
      messages.push(`[FAIL] Full backup record missing: ${rp.fullBackupId}`);
      valid = false;
    } else if (!existsSync(fullRecord.path)) {
      messages.push(`[FAIL] Full backup file not found on disk: ${fullRecord.path}`);
      valid = false;
    } else {
      const ok = await this.verifyChecksum(fullRecord.path, fullRecord.checksum);
      if (ok) {
        messages.push(`[OK]   Full backup ${rp.fullBackupId} — checksum valid`);
      } else {
        messages.push(`[FAIL] Full backup ${rp.fullBackupId} — checksum MISMATCH`);
        valid = false;
      }
    }

    // Check each incremental
    for (const incrId of rp.incrementalBackupIds) {
      const incrRecord = this.backups.get(incrId);
      if (!incrRecord) {
        messages.push(`[WARN] Incremental backup record missing: ${incrId} — will be skipped`);
        continue;
      }
      if (!existsSync(incrRecord.path)) {
        messages.push(`[FAIL] Incremental file not found on disk: ${incrRecord.path}`);
        valid = false;
      } else {
        const ok = await this.verifyChecksum(incrRecord.path, incrRecord.checksum);
        if (ok) {
          messages.push(`[OK]   Incremental ${incrId} — checksum valid`);
        } else {
          messages.push(`[FAIL] Incremental ${incrId} — checksum MISMATCH`);
          valid = false;
        }
      }
    }

    return { valid, messages, restorePointId };
  }

  /** Return all restore points sorted newest-first. */
  getRestorePoints(): RestorePoint[] {
    return [...this.restorePoints.values()].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime(),
    );
  }

  /** Return a single restore point by id (or undefined). */
  getRestorePoint(id: string): RestorePoint | undefined {
    return this.restorePoints.get(id);
  }

  /** Return all backup records sorted newest-first. */
  getAllBackups(): BackupRecord[] {
    return [...this.backups.values()].sort(
      (a, b) => b.startedAt.getTime() - a.startedAt.getTime(),
    );
  }

  /** Return a single backup record by id (or undefined). */
  getBackup(id: string): BackupRecord | undefined {
    return this.backups.get(id);
  }

  /**
   * Return all PITR entries within the configured window, newest-first.
   */
  getPitrEntries(): PitrEntry[] {
    const cutoff = new Date(Date.now() - this.cfg.pitrWindowHours * 3600 * 1000);
    return this._pitrLog
      .filter((e) => e.timestamp >= cutoff)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /** Look up the PITR entry closest to a target time (without going over). */
  getPitrEntryAt(targetTime: Date): PitrEntry | undefined {
    const entries = this.getPitrEntries()
      .filter((e) => e.timestamp <= targetTime)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return entries[0];
  }

  /**
   * Delete backup files and records older than retentionDays.
   * Returns the number of records cleaned up.
   */
  async cleanupOldBackups(): Promise<number> {
    const cutoffMs = Date.now() - this.cfg.retentionDays * 24 * 3600 * 1000;
    let count = 0;

    for (const [id, record] of this.backups) {
      if (record.startedAt.getTime() < cutoffMs && record.status === 'completed') {
        try {
          if (existsSync(record.path)) {
            await unlink(record.path);
          }
          this.backups.delete(id);
          count++;
        } catch (err) {
          console.error(`[BackupAutomation] Cleanup failed for ${id}:`, err);
        }
      }
    }

    if (count > 0) {
      console.log(`[BackupAutomation] Cleaned up ${count} expired backup(s)`);
    }
    return count;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _pitrLog: PitrEntry[] = [];

  private addPitrEntry(restorePointId: string, description: string): void {
    this._pitrLog.push({ timestamp: new Date(), restorePointId, description });
  }

  private ensureBackupDir(): void {
    if (!existsSync(this.cfg.backupDir)) {
      mkdirSync(this.cfg.backupDir, { recursive: true });
    }
  }

  private newId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }

  private fileTimestamp(): string {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  private createRestorePoint(fullBackupId: string): RestorePoint {
    const id = this.newId('rp');
    const rp: RestorePoint = {
      id,
      timestamp: new Date(),
      fullBackupId,
      incrementalBackupIds: [],
      status: 'available',
    };
    this.restorePoints.set(id, rp);
    return rp;
  }

  private getLatestRestorePointForFull(fullBackupId: string): RestorePoint | undefined {
    return [...this.restorePoints.values()]
      .filter((rp) => rp.fullBackupId === fullBackupId && rp.status === 'available')
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
  }

  private getLatestCompletedFull(): BackupRecord | undefined {
    return [...this.backups.values()]
      .filter((b) => b.type === 'full' && b.status === 'completed')
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  }

  /**
   * Run pg_dump and gzip-compress to `filepath`.
   * In dryRunMode, creates an empty file instead.
   */
  private async dumpDatabase(filepath: string, incrementalOnly: boolean): Promise<void> {
    if (this.cfg.dryRunMode) {
      // Write a placeholder file so checksum/stat logic still works
      const { writeFile } = await import('node:fs/promises');
      await writeFile(filepath, `-- dry-run backup (incremental=${incrementalOnly})\n`);
      return;
    }

    const dataOnlyFlag = incrementalOnly ? '--data-only --exclude-table=_prisma_migrations' : '';
    const cmd = `pg_dump "${this.cfg.dbUrl}" ${dataOnlyFlag} | gzip > "${filepath}"`;
    await execAsync(cmd, { timeout: 30 * 60 * 1000 });
  }

  /**
   * Apply a gzip-compressed SQL dump to `dbUrl` via psql.
   * In dryRunMode, validates the file exists and checksum matches but skips psql.
   */
  private async restoreFile(filepath: string, dbUrl: string): Promise<void> {
    if (!existsSync(filepath)) {
      throw new Error(`Backup file not found: ${filepath}`);
    }
    if (this.cfg.dryRunMode) return;

    await execAsync(`gunzip -c "${filepath}" | psql "${dbUrl}"`, {
      timeout: 60 * 60 * 1000,
    });
  }

  /** Compute file size and SHA-256 checksum. */
  private async fileMeta(filepath: string): Promise<{ sizeBytes: number; checksum: string }> {
    const stat = statSync(filepath);
    const checksum = await this.computeChecksum(filepath);
    return { sizeBytes: stat.size, checksum };
  }

  private computeChecksum(filepath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filepath);
      stream.on('error', reject);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async verifyChecksum(filepath: string, expected: string): Promise<boolean> {
    if (!expected) return false;
    try {
      const actual = await this.computeChecksum(filepath);
      return actual.toLowerCase() === expected.trim().toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Upload a file to S3.  Uses the AWS SDK if available, otherwise falls back
   * to a local copy (dev/test environments).
   */
  private async uploadToS3(filepath: string, s3Key: string): Promise<void> {
    // Try AWS SDK first
    try {
      const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const { createReadStream } = await import('node:fs');
      const client = new S3Client({ region: this.cfg.s3Region });
      await client.send(
        new PutObjectCommand({
          Bucket: this.cfg.s3Bucket,
          Key: s3Key,
          Body: createReadStream(filepath),
        }),
      );
      console.log(`[BackupAutomation] Uploaded to S3: s3://${this.cfg.s3Bucket}/${s3Key}`);
      return;
    } catch {
      // AWS SDK not available or credentials missing — fall back to local simulation
    }

    // Fallback: copy to a local "s3" sub-directory (for development / CI)
    const destDir = join(this.cfg.backupDir, 's3', s3Key.split('/')[0]!);
    if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
    const destPath = join(this.cfg.backupDir, 's3', s3Key);
    await execAsync(`cp "${filepath}" "${destPath}"`);
    console.log(`[BackupAutomation] Uploaded to S3 (local sim): ${destPath}`);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

export const backupAutomationService = new BackupAutomationService();
