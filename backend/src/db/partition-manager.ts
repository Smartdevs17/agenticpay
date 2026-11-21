import { PrismaClient } from '@prisma/client';

export type PartitionedTable =
  | 'payments_partitioned'
  | 'invoices_partitioned'
  | 'audit_logs_partitioned'
  | 'webhook_logs_partitioned';

export const PARTITIONED_TABLES: PartitionedTable[] = [
  'payments_partitioned',
  'invoices_partitioned',
  'audit_logs_partitioned',
  'webhook_logs_partitioned',
];

export interface PartitionStats {
  tenantId: string;
  tableName: string;
  partitionName: string;
  rowCount: bigint;
  sizeBytes: bigint;
  lastAnalyzed: Date | null;
  createdAt: Date;
}

export interface PartitionQueryMetrics {
  tenantId: string;
  tableName: string;
  scanPartitions: number;
  totalPartitions: number;
  pruningEfficiency: number;
}

export interface TenantMigrationResult {
  tenantId: string;
  table: PartitionedTable;
  rowsMigrated: number;
  durationMs: number;
  success: boolean;
  error?: string;
}

export class PartitionManager {
  constructor(private readonly prisma: PrismaClient) {}

  async ensurePartitionsForTenant(tenantId: string): Promise<void> {
    for (const table of PARTITIONED_TABLES) {
      await this.createPartition(table, tenantId);
    }
  }

  async createPartition(table: PartitionedTable, tenantId: string): Promise<string> {
    const result = await this.prisma.$queryRaw<[{ create_tenant_partition: string }]>`
      SELECT create_tenant_partition(${table}, ${tenantId})
    `;
    return result[0].create_tenant_partition;
  }

  async dropTenantPartitions(tenantId: string): Promise<void> {
    for (const table of PARTITIONED_TABLES) {
      const safe = tenantId.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const partitionName = `${table}_t_${safe}`;

      const exists = await this.prisma.$queryRaw<[{ exists: boolean }]>`
        SELECT EXISTS(
          SELECT 1 FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = ${partitionName}
            AND n.nspname = current_schema()
        ) AS exists
      `;

      if (exists[0].exists) {
        await this.prisma.$executeRawUnsafe(`DROP TABLE ${partitionName}`);
        await this.prisma.$executeRaw`
          DELETE FROM tenant_partitions
          WHERE tenant_id = ${tenantId} AND table_name = ${table}
        `;
      }
    }
  }

  async getPartitionStats(tenantId?: string): Promise<PartitionStats[]> {
    await this.prisma.$executeRaw`SELECT refresh_partition_stats()`;

    if (tenantId) {
      return this.prisma.$queryRaw<PartitionStats[]>`
        SELECT
          tenant_id   AS "tenantId",
          table_name  AS "tableName",
          partition_name AS "partitionName",
          row_count   AS "rowCount",
          size_bytes  AS "sizeBytes",
          last_analyzed AS "lastAnalyzed",
          created_at  AS "createdAt"
        FROM tenant_partitions
        WHERE tenant_id = ${tenantId}
        ORDER BY table_name, partition_name
      `;
    }

    return this.prisma.$queryRaw<PartitionStats[]>`
      SELECT
        tenant_id   AS "tenantId",
        table_name  AS "tableName",
        partition_name AS "partitionName",
        row_count   AS "rowCount",
        size_bytes  AS "sizeBytes",
        last_analyzed AS "lastAnalyzed",
        created_at  AS "createdAt"
      FROM tenant_partitions
      ORDER BY size_bytes DESC, table_name, partition_name
    `;
  }

  async getPartitionDistribution(): Promise<
    { tableName: string; tenantCount: number; totalRows: bigint; totalBytes: bigint }[]
  > {
    return this.prisma.$queryRaw`
      SELECT
        table_name     AS "tableName",
        COUNT(*)       AS "tenantCount",
        SUM(row_count) AS "totalRows",
        SUM(size_bytes) AS "totalBytes"
      FROM tenant_partitions
      GROUP BY table_name
      ORDER BY table_name
    `;
  }

  async migrateExistingTenantData(
    tenantId: string,
    table: PartitionedTable,
  ): Promise<TenantMigrationResult> {
    const start = Date.now();

    try {
      await this.createPartition(table, tenantId);

      let rowsMigrated = 0;

      if (table === 'payments_partitioned') {
        const res = await this.prisma.$executeRaw`
          INSERT INTO payments_partitioned (
            id, tenant_id, tx_hash, amount, currency, network, status, type,
            project_title, project_id, milestone_id, user_id,
            from_address, to_address, metadata, created_at, updated_at, deleted_at
          )
          SELECT
            id, tenant_id, tx_hash, amount, currency, network, status::text, type::text,
            project_title, project_id, milestone_id, user_id,
            from_address, to_address, metadata, created_at, updated_at, deleted_at
          FROM payments
          WHERE tenant_id = ${tenantId}
          ON CONFLICT DO NOTHING
        `;
        rowsMigrated = Number(res);
      } else if (table === 'invoices_partitioned') {
        const res = await this.prisma.$executeRaw`
          INSERT INTO invoices_partitioned (
            id, tenant_id, project_id, milestone_id, amount, currency, status,
            generated_at, due_at, paid_at, created_at, updated_at, deleted_at
          )
          SELECT
            id, tenant_id, project_id, milestone_id, amount, currency, status::text,
            generated_at, due_at, paid_at, created_at, updated_at, deleted_at
          FROM invoices
          WHERE tenant_id = ${tenantId}
          ON CONFLICT DO NOTHING
        `;
        rowsMigrated = Number(res);
      } else if (table === 'audit_logs_partitioned') {
        const res = await this.prisma.$executeRaw`
          INSERT INTO audit_logs_partitioned (
            id, tenant_id, timestamp, actor, action, resource, details,
            previous_hash, hash, anchor_id, archived_at, cold_archived_at,
            entity_id, entity_type, user_id, metadata, ip_address, created_at
          )
          SELECT
            id, COALESCE(tenant_id, 'system'),
            timestamp, actor, action, resource, details,
            previous_hash, hash, anchor_id, archived_at, cold_archived_at,
            entity_id, entity_type, user_id, metadata, ip_address, created_at
          FROM audit_logs
          WHERE COALESCE(tenant_id, 'system') = ${tenantId}
          ON CONFLICT DO NOTHING
        `;
        rowsMigrated = Number(res);
      }

      return { tenantId, table, rowsMigrated, durationMs: Date.now() - start, success: true };
    } catch (error) {
      return {
        tenantId,
        table,
        rowsMigrated: 0,
        durationMs: Date.now() - start,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async migrateAllTenants(table: PartitionedTable): Promise<TenantMigrationResult[]> {
    const tenants = await this.getDistinctTenants(table);
    const results: TenantMigrationResult[] = [];

    for (const tenantId of tenants) {
      results.push(await this.migrateExistingTenantData(tenantId, table));
    }

    return results;
  }

  private async getDistinctTenants(table: PartitionedTable): Promise<string[]> {
    type Row = { tenant_id: string };

    if (table === 'payments_partitioned') {
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT DISTINCT tenant_id FROM payments WHERE tenant_id IS NOT NULL
      `;
      return rows.map((r) => r.tenant_id);
    }

    if (table === 'invoices_partitioned') {
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT DISTINCT tenant_id FROM invoices WHERE tenant_id IS NOT NULL
      `;
      return rows.map((r) => r.tenant_id);
    }

    if (table === 'audit_logs_partitioned') {
      const rows = await this.prisma.$queryRaw<Row[]>`
        SELECT DISTINCT COALESCE(tenant_id, 'system') AS tenant_id FROM audit_logs
      `;
      return rows.map((r) => r.tenant_id);
    }

    return [];
  }

  async getQueryMetrics(tenantId: string, table: PartitionedTable): Promise<PartitionQueryMetrics> {
    const allPartitions = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) AS count FROM tenant_partitions WHERE table_name = ${table}
    `;

    const totalPartitions = Number(allPartitions[0].count);

    return {
      tenantId,
      tableName: table,
      scanPartitions: 1,
      totalPartitions,
      pruningEfficiency: totalPartitions > 0 ? (1 - 1 / totalPartitions) * 100 : 0,
    };
  }
}
