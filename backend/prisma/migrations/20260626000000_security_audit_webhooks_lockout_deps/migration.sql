ALTER TABLE "webhooks"
  ADD COLUMN IF NOT EXISTS "signature_version" TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS "secret_expires_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rotated_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "encryption_public_key" TEXT;

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "actor" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS "resource" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "details" JSONB,
  ADD COLUMN IF NOT EXISTS "previous_hash" TEXT NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN IF NOT EXISTS "hash" TEXT,
  ADD COLUMN IF NOT EXISTS "anchor_id" TEXT,
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cold_archived_at" TIMESTAMP(3);

UPDATE "audit_logs"
SET "hash" = md5("id" || "created_at"::text || "action")
WHERE "hash" IS NULL;

ALTER TABLE "audit_logs" ALTER COLUMN "hash" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "audit_logs_hash_key" ON "audit_logs"("hash");
CREATE INDEX IF NOT EXISTS "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_idx" ON "audit_logs"("actor");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_action_timestamp_idx" ON "audit_logs"("actor", "action", "timestamp");

CREATE TABLE IF NOT EXISTS "audit_anchors" (
  "id" TEXT NOT NULL,
  "latest_hash" TEXT NOT NULL,
  "chain" TEXT NOT NULL,
  "transaction_hash" TEXT,
  "block_number" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_anchors_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_anchors_latest_hash_idx" ON "audit_anchors"("latest_hash");
CREATE INDEX IF NOT EXISTS "audit_anchors_created_at_idx" ON "audit_anchors"("created_at");

CREATE TABLE IF NOT EXISTS "account_lockouts" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "ip_address" TEXT,
  "failed_attempts" INTEGER NOT NULL DEFAULT 0,
  "locked_until" TIMESTAMP(3),
  "unlock_token_hash" TEXT,
  "last_failed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_lockouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "account_lockouts_account_id_ip_address_key" ON "account_lockouts"("account_id", "ip_address");
CREATE INDEX IF NOT EXISTS "account_lockouts_account_id_idx" ON "account_lockouts"("account_id");
CREATE INDEX IF NOT EXISTS "account_lockouts_ip_address_idx" ON "account_lockouts"("ip_address");
CREATE INDEX IF NOT EXISTS "account_lockouts_locked_until_idx" ON "account_lockouts"("locked_until");

CREATE TABLE IF NOT EXISTS "login_attempts" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "ip_address" TEXT NOT NULL,
  "user_agent" TEXT,
  "success" BOOLEAN NOT NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "login_attempts_account_id_created_at_idx" ON "login_attempts"("account_id", "created_at");
CREATE INDEX IF NOT EXISTS "login_attempts_ip_address_created_at_idx" ON "login_attempts"("ip_address", "created_at");
CREATE INDEX IF NOT EXISTS "login_attempts_success_idx" ON "login_attempts"("success");

CREATE TABLE IF NOT EXISTS "webhook_secrets" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "key_id" TEXT NOT NULL,
  "secret_hash" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'v1',
  "active_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "rotated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_secrets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webhook_secrets_merchant_id_key_id_key" ON "webhook_secrets"("merchant_id", "key_id");
CREATE INDEX IF NOT EXISTS "webhook_secrets_merchant_id_expires_at_idx" ON "webhook_secrets"("merchant_id", "expires_at");

CREATE TABLE IF NOT EXISTS "vulnerability_reports" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "summary" JSONB NOT NULL,
  "artifact_url" TEXT,
  CONSTRAINT "vulnerability_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vulnerability_reports_source_scanned_at_idx" ON "vulnerability_reports"("source", "scanned_at");

CREATE TABLE IF NOT EXISTS "dependency_vulnerabilities" (
  "id" TEXT NOT NULL,
  "report_id" TEXT NOT NULL,
  "ecosystem" TEXT NOT NULL,
  "package_name" TEXT NOT NULL,
  "installed_version" TEXT,
  "fixed_version" TEXT,
  "severity" TEXT NOT NULL,
  "advisory_id" TEXT,
  "title" TEXT NOT NULL,
  "remediation" TEXT,
  "due_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dependency_vulnerabilities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dependency_vulnerabilities_ecosystem_severity_idx" ON "dependency_vulnerabilities"("ecosystem", "severity");
CREATE INDEX IF NOT EXISTS "dependency_vulnerabilities_package_name_idx" ON "dependency_vulnerabilities"("package_name");
ALTER TABLE "dependency_vulnerabilities"
  ADD CONSTRAINT "dependency_vulnerabilities_report_id_fkey"
  FOREIGN KEY ("report_id") REFERENCES "vulnerability_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
