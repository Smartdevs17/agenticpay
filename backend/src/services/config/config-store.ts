import { prisma } from '../../lib/prisma.js';
import type { ConfigValue } from './config-schema.js';

export interface StoredConfiguration {
  key: string;
  value: ConfigValue;
  source: string;
  description?: string | null;
  updatedBy?: string | null;
  version: number;
  updatedAt: Date;
}

export interface ConfigAuditEntry {
  id: string;
  key: string;
  oldValue: ConfigValue | null;
  newValue: ConfigValue | null;
  actor: string | null;
  reason: string | null;
  source: string;
  requestId: string | null;
  createdAt: Date;
}

export interface ConfigStore {
  list(): Promise<StoredConfiguration[]>;
  get(key: string): Promise<StoredConfiguration | null>;
  upsert(input: {
    key: string;
    value: ConfigValue;
    description?: string;
    actor?: string;
    expectedVersion?: number;
  }): Promise<{ before: StoredConfiguration | null; after: StoredConfiguration; conflict: boolean }>;
  audit(input: {
    key: string;
    oldValue: ConfigValue | null;
    newValue: ConfigValue | null;
    actor?: string;
    reason?: string;
    source?: string;
    requestId?: string;
  }): Promise<void>;
  listAudit(limit?: number): Promise<ConfigAuditEntry[]>;
}

function mapStored(row: any): StoredConfiguration {
  return {
    key: row.key,
    value: row.value,
    source: row.source,
    description: row.description,
    updatedBy: row.updatedBy,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

export class PrismaConfigStore implements ConfigStore {
  async list(): Promise<StoredConfiguration[]> {
    const rows = await (prisma as any).appConfiguration.findMany({ orderBy: { key: 'asc' } });
    return rows.map(mapStored);
  }

  async get(key: string): Promise<StoredConfiguration | null> {
    const row = await (prisma as any).appConfiguration.findUnique({ where: { key } });
    return row ? mapStored(row) : null;
  }

  async upsert(input: {
    key: string;
    value: ConfigValue;
    description?: string;
    actor?: string;
    expectedVersion?: number;
  }): Promise<{ before: StoredConfiguration | null; after: StoredConfiguration; conflict: boolean }> {
    const before = await this.get(input.key);
    if (before && input.expectedVersion !== undefined && before.version !== input.expectedVersion) {
      return { before, after: before, conflict: true };
    }

    if (!before) {
      const row = await (prisma as any).appConfiguration.create({
        data: {
          key: input.key,
          value: input.value,
          description: input.description,
          updatedBy: input.actor,
          source: 'database',
        },
      });
      return { before, after: mapStored(row), conflict: false };
    }

    const result = await (prisma as any).appConfiguration.updateMany({
      where: {
        key: input.key,
        ...(input.expectedVersion !== undefined ? { version: input.expectedVersion } : {}),
      },
      data: {
        value: input.value,
        description: input.description,
        updatedBy: input.actor,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      const latest = await this.get(input.key);
      return { before: latest, after: latest ?? before, conflict: true };
    }

    const row = await (prisma as any).appConfiguration.findUniqueOrThrow({ where: { key: input.key } });
    return { before, after: mapStored(row), conflict: false };
  }

  async audit(input: {
    key: string;
    oldValue: ConfigValue | null;
    newValue: ConfigValue | null;
    actor?: string;
    reason?: string;
    source?: string;
    requestId?: string;
  }): Promise<void> {
    await (prisma as any).configAuditLog.create({
      data: {
        key: input.key,
        oldValue: input.oldValue as any,
        newValue: input.newValue as any,
        actor: input.actor,
        reason: input.reason,
        source: input.source ?? 'admin',
        requestId: input.requestId,
      },
    });
  }

  async listAudit(limit = 100): Promise<ConfigAuditEntry[]> {
    const rows = await (prisma as any).configAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row: any) => ({
      id: row.id,
      key: row.key,
      oldValue: row.oldValue,
      newValue: row.newValue,
      actor: row.actor,
      reason: row.reason,
      source: row.source,
      requestId: row.requestId,
      createdAt: row.createdAt,
    }));
  }
}
