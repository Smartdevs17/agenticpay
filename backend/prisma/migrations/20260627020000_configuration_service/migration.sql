CREATE TABLE "app_configurations" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'database',
  "description" TEXT,
  "updated_by" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "app_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "config_audit_logs" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "old_value" JSONB,
  "new_value" JSONB,
  "actor" TEXT,
  "reason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'admin',
  "request_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "config_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "app_configurations_key_key" ON "app_configurations"("key");
CREATE INDEX "app_configurations_source_idx" ON "app_configurations"("source");
CREATE INDEX "config_audit_logs_key_created_at_idx" ON "config_audit_logs"("key", "created_at");
CREATE INDEX "config_audit_logs_actor_idx" ON "config_audit_logs"("actor");
