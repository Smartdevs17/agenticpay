-- Issue #797: critical query-path indexes for dashboard, milestone, and audit workloads.
-- These indexes mirror the query patterns exposed by backend/src/config/database.ts.

CREATE INDEX IF NOT EXISTS "idx_projects_tenant_status_created"
  ON "projects" ("tenant_id", "status", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_milestones_project_status_order"
  ON "milestones" ("project_id", "status", "order")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_invoices_project_created"
  ON "invoices" ("project_id", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_invoices_tenant_status_due"
  ON "invoices" ("tenant_id", "status", "due_at" ASC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_payments_tenant_status_created"
  ON "payments" ("tenant_id", "status", "created_at" DESC)
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_payments_project_status_created"
  ON "payments" ("project_id", "status", "created_at" DESC)
  WHERE "deleted_at" IS NULL AND "project_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_audit_logs_entity_created"
  ON "audit_logs" ("entity_id", "created_at" DESC)
  WHERE "entity_id" IS NOT NULL;
