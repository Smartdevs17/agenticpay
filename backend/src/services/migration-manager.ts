import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

interface MigrationVersion {
  id: string;
  name: string;
  appliedAt: string;
  duration: number;
  status: 'applied' | 'failed' | 'rolled_back';
  checksum: string;
}

interface MigrationCheckpoint {
  timestamp: string;
  version: string;
  migrations: MigrationVersion[];
  database_version: string;
  notes: string;
}

const MIGRATION_CHECKPOINTS_FILE = join(process.cwd(), '.migration-checkpoints.json');
const MIGRATION_HISTORY_FILE = join(process.cwd(), '.migration-history.json');

class MigrationManager {
  private checkpoints: MigrationCheckpoint[] = [];
  private history: MigrationVersion[] = [];

  constructor() {
    this.loadCheckpoints();
    this.loadHistory();
  }

  private loadCheckpoints(): void {
    if (existsSync(MIGRATION_CHECKPOINTS_FILE)) {
      const data = readFileSync(MIGRATION_CHECKPOINTS_FILE, 'utf-8');
      this.checkpoints = JSON.parse(data);
    }
  }

  private saveCheckpoints(): void {
    writeFileSync(MIGRATION_CHECKPOINTS_FILE, JSON.stringify(this.checkpoints, null, 2));
  }

  private loadHistory(): void {
    if (existsSync(MIGRATION_HISTORY_FILE)) {
      const data = readFileSync(MIGRATION_HISTORY_FILE, 'utf-8');
      this.history = JSON.parse(data);
    }
  }

  private saveHistory(): void {
    writeFileSync(MIGRATION_HISTORY_FILE, JSON.stringify(this.history, null, 2));
  }

  recordMigration(
    id: string,
    name: string,
    duration: number,
    checksum: string,
    status: 'applied' | 'failed' = 'applied'
  ): void {
    const migration: MigrationVersion = {
      id,
      name,
      appliedAt: new Date().toISOString(),
      duration,
      status,
      checksum,
    };

    this.history.push(migration);
    this.saveHistory();
  }

  createCheckpoint(databaseVersion: string, notes: string = ''): void {
    const checkpoint: MigrationCheckpoint = {
      timestamp: new Date().toISOString(),
      version: `v${Date.now()}`,
      migrations: [...this.history],
      database_version: databaseVersion,
      notes,
    };

    this.checkpoints.push(checkpoint);
    this.saveCheckpoints();
  }

  getLatestCheckpoint(): MigrationCheckpoint | null {
    return this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1] : null;
  }

  getCheckpointByVersion(version: string): MigrationCheckpoint | null {
    return this.checkpoints.find((cp) => cp.version === version) || null;
  }

  listCheckpoints(): MigrationCheckpoint[] {
    return [...this.checkpoints];
  }

  getHistory(): MigrationVersion[] {
    return [...this.history];
  }

  recordRollback(migrationId: string, rollbackTime: number): void {
    const migration = this.history.find((m) => m.id === migrationId);
    if (migration) {
      migration.status = 'rolled_back';
      this.saveHistory();
    }
  }

  getMigrationsByStatus(status: 'applied' | 'failed' | 'rolled_back'): MigrationVersion[] {
    return this.history.filter((m) => m.status === status);
  }

  generateReport(): {
    total_migrations: number;
    applied: number;
    failed: number;
    rolled_back: number;
    latest_checkpoint: MigrationCheckpoint | null;
    recent_migrations: MigrationVersion[];
  } {
    return {
      total_migrations: this.history.length,
      applied: this.getMigrationsByStatus('applied').length,
      failed: this.getMigrationsByStatus('failed').length,
      rolled_back: this.getMigrationsByStatus('rolled_back').length,
      latest_checkpoint: this.getLatestCheckpoint(),
      recent_migrations: this.history.slice(-10),
    };
  }
}

export const migrationManager = new MigrationManager();
