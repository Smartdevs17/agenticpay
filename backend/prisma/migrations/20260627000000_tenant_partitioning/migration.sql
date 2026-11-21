-- Migration: Tenant partitioning for multi-tenant isolation (#504)
-- Strategy: list-partitioning by tenant_id with zero-downtime shadow-table approach.
-- Partitioned shadow tables run alongside originals; the partition-manager drives
-- the data backfill and final cutover per deployment.

-- ─── Phase 1: Enrich audit_logs with tenant_id ───────────────────────────────

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "tenant_id" TEXT;

UPDATE "audit_logs" al
SET    "tenant_id" = u."tenant_id"
FROM   "users" u
WHERE  al."user_id" = u."id"
  AND  al."tenant_id" IS NULL;

UPDATE "audit_logs"
SET    "tenant_id" = 'system'
WHERE  "tenant_id" IS NULL;

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_idx"
  ON "audit_logs" ("tenant_id");

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_created_at_idx"
  ON "audit_logs" ("tenant_id", "created_at");

-- ─── Phase 2: Partition registry ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "tenant_partitions" (
  "id"             TEXT         NOT NULL,
  "tenant_id"      TEXT         NOT NULL,
  "table_name"     TEXT         NOT NULL,
  "partition_name" TEXT         NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_count"      BIGINT       NOT NULL DEFAULT 0,
  "size_bytes"     BIGINT       NOT NULL DEFAULT 0,
  "last_analyzed"  TIMESTAMP(3),
  CONSTRAINT "tenant_partitions_pkey"    PRIMARY KEY ("id"),
  CONSTRAINT "tenant_partitions_unique"  UNIQUE ("table_name", "partition_name")
);

CREATE INDEX IF NOT EXISTS "tenant_partitions_tenant_idx"
  ON "tenant_partitions" ("tenant_id");

CREATE INDEX IF NOT EXISTS "tenant_partitions_table_idx"
  ON "tenant_partitions" ("table_name");

-- ─── Phase 3: PostgreSQL helper functions ─────────────────────────────────────

-- Idempotently creates a LIST partition for a given tenant on a partitioned table.
CREATE OR REPLACE FUNCTION create_tenant_partition(
  p_table  TEXT,
  p_tenant TEXT
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_safe TEXT;
  v_part TEXT;
BEGIN
  v_safe := lower(regexp_replace(p_tenant, '[^a-zA-Z0-9]', '_', 'g'));
  v_part := p_table || '_t_' || v_safe;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE  c.relname = v_part
      AND  n.nspname = current_schema()
  ) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF %I FOR VALUES IN (%L)',
      v_part, p_table, p_tenant
    );
    INSERT INTO tenant_partitions (id, tenant_id, table_name, partition_name)
    VALUES (gen_random_uuid()::text, p_tenant, p_table, v_part)
    ON CONFLICT (table_name, partition_name) DO NOTHING;
  END IF;

  RETURN v_part;
END;
$$;

-- Refreshes row count and byte size for all tracked partitions.
CREATE OR REPLACE FUNCTION refresh_partition_stats() RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT table_name, partition_name FROM tenant_partitions LOOP
    UPDATE tenant_partitions
    SET    row_count    = (SELECT reltuples::BIGINT FROM pg_class WHERE relname = r.partition_name),
           size_bytes   = pg_relation_size(r.partition_name::regclass),
           last_analyzed = now()
    WHERE  table_name     = r.table_name
      AND  partition_name = r.partition_name;
  END LOOP;
END;
$$;

-- ─── Phase 4: Partitioned shadow tables ──────────────────────────────────────
-- These mirror the originals with composite PKs (id, tenant_id) required by
-- PostgreSQL LIST partitioning. The partition-manager handles data sync and
-- the final cutover rename.

CREATE TABLE IF NOT EXISTS "payments_partitioned" (
  "id"            TEXT          NOT NULL,
  "tenant_id"     TEXT          NOT NULL,
  "tx_hash"       TEXT,
  "amount"        DECIMAL(20,8) NOT NULL,
  "currency"      TEXT          NOT NULL DEFAULT 'XLM',
  "network"       TEXT          NOT NULL DEFAULT 'stellar',
  "status"        TEXT          NOT NULL DEFAULT 'pending',
  "type"          TEXT          NOT NULL DEFAULT 'milestone_payment',
  "project_title" TEXT,
  "project_id"    TEXT,
  "milestone_id"  TEXT,
  "user_id"       TEXT,
  "from_address"  TEXT,
  "to_address"    TEXT,
  "metadata"      JSONB,
  "created_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"    TIMESTAMP(3),
  CONSTRAINT "payments_part_pkey" PRIMARY KEY ("id", "tenant_id")
) PARTITION BY LIST ("tenant_id");

CREATE TABLE IF NOT EXISTS "payments_partitioned_default"
  PARTITION OF "payments_partitioned" DEFAULT;

CREATE INDEX IF NOT EXISTS "payments_part_tenant_created_idx"
  ON "payments_partitioned" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "payments_part_status_idx"
  ON "payments_partitioned" ("status");
CREATE INDEX IF NOT EXISTS "payments_part_tx_hash_idx"
  ON "payments_partitioned" ("tx_hash");
CREATE INDEX IF NOT EXISTS "payments_part_project_id_idx"
  ON "payments_partitioned" ("project_id");

INSERT INTO "payments_partitioned" (
  id, tenant_id, tx_hash, amount, currency, network, status, type,
  project_title, project_id, milestone_id, user_id,
  from_address, to_address, metadata, created_at, updated_at, deleted_at
)
SELECT
  id, tenant_id, tx_hash, amount, currency, network, status::text, type::text,
  project_title, project_id, milestone_id, user_id,
  from_address, to_address, metadata, created_at, updated_at, deleted_at
FROM "payments"
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "invoices_partitioned" (
  "id"           TEXT          NOT NULL,
  "tenant_id"    TEXT          NOT NULL,
  "project_id"   TEXT          NOT NULL,
  "milestone_id" TEXT,
  "amount"       DECIMAL(20,8) NOT NULL,
  "currency"     TEXT          NOT NULL DEFAULT 'XLM',
  "status"       TEXT          NOT NULL DEFAULT 'draft',
  "generated_at" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_at"       TIMESTAMP(3),
  "paid_at"      TIMESTAMP(3),
  "created_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"   TIMESTAMP(3),
  CONSTRAINT "invoices_part_pkey" PRIMARY KEY ("id", "tenant_id")
) PARTITION BY LIST ("tenant_id");

CREATE TABLE IF NOT EXISTS "invoices_partitioned_default"
  PARTITION OF "invoices_partitioned" DEFAULT;

CREATE INDEX IF NOT EXISTS "invoices_part_tenant_generated_idx"
  ON "invoices_partitioned" ("tenant_id", "generated_at");
CREATE INDEX IF NOT EXISTS "invoices_part_project_id_idx"
  ON "invoices_partitioned" ("project_id");
CREATE INDEX IF NOT EXISTS "invoices_part_status_idx"
  ON "invoices_partitioned" ("status");

INSERT INTO "invoices_partitioned" (
  id, tenant_id, project_id, milestone_id, amount, currency, status,
  generated_at, due_at, paid_at, created_at, updated_at, deleted_at
)
SELECT
  id, tenant_id, project_id, milestone_id, amount, currency, status::text,
  generated_at, due_at, paid_at, created_at, updated_at, deleted_at
FROM "invoices"
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "audit_logs_partitioned" (
  "id"               TEXT         NOT NULL,
  "tenant_id"        TEXT         NOT NULL DEFAULT 'system',
  "timestamp"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor"            TEXT         NOT NULL,
  "action"           TEXT         NOT NULL,
  "resource"         TEXT         NOT NULL,
  "details"          JSONB,
  "previous_hash"    TEXT         NOT NULL,
  "hash"             TEXT         NOT NULL,
  "anchor_id"        TEXT,
  "archived_at"      TIMESTAMP(3),
  "cold_archived_at" TIMESTAMP(3),
  "entity_id"        TEXT,
  "entity_type"      TEXT,
  "user_id"          TEXT,
  "metadata"         JSONB,
  "ip_address"       TEXT,
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_part_pkey" PRIMARY KEY ("id", "tenant_id")
) PARTITION BY LIST ("tenant_id");

CREATE TABLE IF NOT EXISTS "audit_logs_partitioned_default"
  PARTITION OF "audit_logs_partitioned" DEFAULT;

CREATE INDEX IF NOT EXISTS "audit_logs_part_tenant_created_idx"
  ON "audit_logs_partitioned" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_part_actor_idx"
  ON "audit_logs_partitioned" ("actor");
CREATE INDEX IF NOT EXISTS "audit_logs_part_action_idx"
  ON "audit_logs_partitioned" ("action");
CREATE INDEX IF NOT EXISTS "audit_logs_part_entity_idx"
  ON "audit_logs_partitioned" ("entity_id", "created_at");

INSERT INTO "audit_logs_partitioned" (
  id, tenant_id, timestamp, actor, action, resource, details,
  previous_hash, hash, anchor_id, archived_at, cold_archived_at,
  entity_id, entity_type, user_id, metadata, ip_address, created_at
)
SELECT
  id, COALESCE(tenant_id, 'system'),
  timestamp, actor, action, resource, details,
  previous_hash, hash, anchor_id, archived_at, cold_archived_at,
  entity_id, entity_type, user_id, metadata, ip_address, created_at
FROM "audit_logs"
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "webhook_logs_partitioned" (
  "id"          TEXT         NOT NULL,
  "tenant_id"   TEXT         NOT NULL,
  "webhook_id"  TEXT         NOT NULL,
  "event_type"  TEXT         NOT NULL,
  "payload"     JSONB,
  "status_code" INTEGER,
  "response"    TEXT,
  "attempt"     INTEGER      NOT NULL DEFAULT 1,
  "duration_ms" INTEGER,
  "delivered_at" TIMESTAMP(3),
  "failed_at"   TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_logs_part_pkey" PRIMARY KEY ("id", "tenant_id")
) PARTITION BY LIST ("tenant_id");

CREATE TABLE IF NOT EXISTS "webhook_logs_partitioned_default"
  PARTITION OF "webhook_logs_partitioned" DEFAULT;

CREATE INDEX IF NOT EXISTS "webhook_logs_part_tenant_created_idx"
  ON "webhook_logs_partitioned" ("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "webhook_logs_part_webhook_id_idx"
  ON "webhook_logs_partitioned" ("webhook_id");
CREATE INDEX IF NOT EXISTS "webhook_logs_part_event_type_idx"
  ON "webhook_logs_partitioned" ("event_type");
