import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const execAsync = promisify(exec);

export interface BackupConfig {
    dbUrl: string;
    s3Bucket: string;
    s3Region: string;
    backupDir: string;
    retentionDays: number;
    incrementalIntervalHours: number;
}

export interface BackupRecord {
    id: string;
    type: 'full' | 'incremental';
    status: 'running' | 'completed' | 'failed';
    sizeBytes: number;
    checksum: string;
    path: string;
    startedAt: Date;
    completedAt?: Date;
    error?: string;
}

export interface RestorePoint {
    id: string;
    timestamp: Date;
    fullBackupId: string;
    incrementalBackupIds: string[];
    status: 'available' | 'restoring' | 'restored' | 'failed';
}

const DEFAULT_CONFIG: BackupConfig = {
    dbUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/agenticpay',
    s3Bucket: process.env.S3_BACKUP_BUCKET || 'agenticpay-backups',
    s3Region: process.env.S3_REGION || 'us-east-1',
    backupDir: process.env.BACKUP_DIR || '/var/backups/agenticpay',
    retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS || '30', 10),
    incrementalIntervalHours: 6,
};

export class BackupService {
    private config: BackupConfig;
    private backups: Map<string, BackupRecord> = new Map();
    private restorePoints: Map<string, RestorePoint> = new Map();

    constructor(config: Partial<BackupConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        if (!existsSync(this.config.backupDir)) {
            mkdirSync(this.config.backupDir, { recursive: true });
        }
    }

    async createFullBackup(): Promise<BackupRecord> {
        const id = `full_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `full_backup_${timestamp}.sql.gz`;
        const filepath = join(this.config.backupDir, filename);

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
            // Run pg_dump and compress
            const { stdout, stderr } = await execAsync(
                `pg_dump "${this.config.dbUrl}" | gzip > "${filepath}"`,
                { timeout: 30 * 60 * 1000 }, // 30 min timeout
            );

            // Calculate checksum
            const checksum = await this.calculateChecksum(filepath);
            const stats = existsSync(filepath) ? await promisify(require('fs').stat)(filepath) : { size: 0 };

            record.status = 'completed';
            record.sizeBytes = stats.size;
            record.checksum = checksum;
            record.completedAt = new Date();

            // Upload to S3 (simulated - in production use AWS SDK)
            console.log(`[Backup] Full backup completed: ${filepath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            await this.uploadToS3(filepath, `full/${filename}`);

            // Cleanup old backups
            await this.cleanupOldBackups();

            // Create restore point
            this.createRestorePoint(id, []);

        } catch (error) {
            record.status = 'failed';
            record.error = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Backup] Full backup failed: ${record.error}`);
        }

        this.backups.set(id, record);
        return record;
    }

    async createIncrementalBackup(lastFullBackupId: string): Promise<BackupRecord> {
        const id = `incr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `incr_backup_${timestamp}.sql.gz`;
        const filepath = join(this.config.backupDir, filename);

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
            // Use pg_dump with --data-only for incremental (simplified approach)
            // In production, use WAL archiving or pg_dump with custom format
            const { stdout, stderr } = await execAsync(
                `pg_dump "${this.config.dbUrl}" --data-only --exclude-table=migrations | gzip > "${filepath}"`,
                { timeout: 15 * 60 * 1000 },
            );

            const checksum = await this.calculateChecksum(filepath);
            const stats = existsSync(filepath) ? await promisify(require('fs').stat)(filepath) : { size: 0 };

            record.status = 'completed';
            record.sizeBytes = stats.size;
            record.checksum = checksum;
            record.completedAt = new Date();

            console.log(`[Backup] Incremental backup completed: ${filepath} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            await this.uploadToS3(filepath, `incremental/${filename}`);

            // Update restore point
            const restorePoint = Array.from(this.restorePoints.values())
                .find(rp => rp.fullBackupId === lastFullBackupId && rp.status === 'available');
            if (restorePoint) {
                restorePoint.incrementalBackupIds.push(id);
            }

        } catch (error) {
            record.status = 'failed';
            record.error = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Backup] Incremental backup failed: ${record.error}`);
        }

        this.backups.set(id, record);
        return record;
    }

    async restore(restorePointId: string, targetDbUrl?: string): Promise<boolean> {
        const restorePoint = this.restorePoints.get(restorePointId);
        if (!restorePoint) {
            throw new Error(`Restore point not found: ${restorePointId}`);
        }

        const dbUrl = targetDbUrl || this.config.dbUrl;
        restorePoint.status = 'restoring';

        try {
            const fullBackup = this.backups.get(restorePoint.fullBackupId);
            if (!fullBackup || !existsSync(fullBackup.path)) {
                throw new Error(`Full backup not found: ${restorePoint.fullBackupId}`);
            }

            // Restore full backup
            console.log(`[Backup] Restoring full backup: ${fullBackup.path}`);
            await execAsync(
                `gunzip -c "${fullBackup.path}" | psql "${dbUrl}"`,
                { timeout: 60 * 60 * 1000 },
            );

            // Apply incremental backups in order
            for (const incrId of restorePoint.incrementalBackupIds) {
                const incrBackup = this.backups.get(incrId);
                if (incrBackup && existsSync(incrBackup.path)) {
                    console.log(`[Backup] Applying incremental backup: ${incrBackup.path}`);
                    await execAsync(
                        `gunzip -c "${incrBackup.path}" | psql "${dbUrl}"`,
                        { timeout: 30 * 60 * 1000 },
                    );
                }
            }

            restorePoint.status = 'restored';
            console.log(`[Backup] Restore completed successfully to ${dbUrl}`);
            return true;

        } catch (error) {
            restorePoint.status = 'failed';
            console.error(`[Backup] Restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    async verifyBackup(backupId: string): Promise<boolean> {
        const backup = this.backups.get(backupId);
        if (!backup) return false;

        try {
            // Verify file exists and checksum matches
            if (!existsSync(backup.path)) {
                console.error(`[Backup] Verification failed: file not found ${backup.path}`);
                return false;
            }

            const currentChecksum = await this.calculateChecksum(backup.path);
            if (currentChecksum !== backup.checksum) {
                console.error(`[Backup] Verification failed: checksum mismatch for ${backup.id}`);
                return false;
            }

            // Try to read the gzip file to verify integrity
            await execAsync(`gunzip -t "${backup.path}"`, { timeout: 60_000 });

            console.log(`[Backup] Verification passed: ${backup.id}`);
            return true;

        } catch (error) {
            console.error(`[Backup] Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return false;
        }
    }

    getBackup(id: string): BackupRecord | undefined {
        return this.backups.get(id);
    }

    getAllBackups(): BackupRecord[] {
        return Array.from(this.backups.values())
            .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    }

    getRestorePoints(): RestorePoint[] {
        return Array.from(this.restorePoints.values())
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    private createRestorePoint(fullBackupId: string, incrementalIds: string[]): RestorePoint {
        const id = `rp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const point: RestorePoint = {
            id,
            timestamp: new Date(),
            fullBackupId,
            incrementalBackupIds: incrementalIds,
            status: 'available',
        };
        this.restorePoints.set(id, point);
        return point;
    }

    private async calculateChecksum(filepath: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const hash = createHash('sha256');
            const stream = createReadStream(filepath);
            stream.on('data', (data) => hash.update(data));
            stream.on('end', () => resolve(hash.digest('hex')));
            stream.on('error', reject);
        });
    }

    private async uploadToS3(filepath: string, s3Key: string): Promise<void> {
        // In production, use AWS SDK S3 upload
        // For now, simulate with a local copy
        const s3Dir = join(this.config.backupDir, 's3', s3Key.split('/')[0]);
        if (!existsSync(s3Dir)) {
            mkdirSync(s3Dir, { recursive: true });
        }
        const destPath = join(this.config.backupDir, 's3', s3Key);
        await execAsync(`cp "${filepath}" "${destPath}"`);
        console.log(`[Backup] Uploaded to S3 (simulated): ${s3Key}`);
    }

    private async cleanupOldBackups(): Promise<void> {
        const cutoff = Date.now() - (this.config.retentionDays * 24 * 60 * 60 * 1000);
        let deletedCount = 0;

        for (const [id, backup] of this.backups) {
            if (backup.startedAt.getTime() < cutoff && backup.status === 'completed') {
                try {
                    if (existsSync(backup.path)) {
                        await execAsync(`rm "${backup.path}"`);
                    }
                    this.backups.delete(id);
                    deletedCount++;
                } catch (error) {
                    console.error(`[Backup] Cleanup failed for ${id}: ${error}`);
                }
            }
        }

        if (deletedCount > 0) {
            console.log(`[Backup] Cleaned up ${deletedCount} old backup(s)`);
        }
    }
}

export const backupService = new BackupService();