-- Issue #884: Implement soft delete with archive strategy
--
-- Adds a generic archive table used to store the full row payload of
-- soft-deleted records once they pass their retention window, plus an
-- index to make sweeping soft-deleted rows across tenants efficient.

-- CreateTable
CREATE TABLE "archived_records" (
    "id" TEXT NOT NULL,
    "model_name" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "payload" JSONB NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_reason" TEXT NOT NULL DEFAULT 'retention_policy',

    CONSTRAINT "archived_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archived_records_model_name_record_id_key" ON "archived_records"("model_name", "record_id");
CREATE INDEX "archived_records_model_name_idx" ON "archived_records"("model_name");
CREATE INDEX "archived_records_deleted_at_idx" ON "archived_records"("deleted_at");
CREATE INDEX "archived_records_tenant_id_idx" ON "archived_records"("tenant_id");

-- Composite indexes so the archival sweep can cheaply find "soft-deleted
-- and past retention" rows on the highest-volume soft-deletable tables.
CREATE INDEX IF NOT EXISTS "payments_deleted_at_idx" ON "payments"("deleted_at");
CREATE INDEX IF NOT EXISTS "projects_deleted_at_idx" ON "projects"("deleted_at");
CREATE INDEX IF NOT EXISTS "milestones_deleted_at_idx" ON "milestones"("deleted_at");
CREATE INDEX IF NOT EXISTS "invoices_deleted_at_idx" ON "invoices"("deleted_at");
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users"("deleted_at");
