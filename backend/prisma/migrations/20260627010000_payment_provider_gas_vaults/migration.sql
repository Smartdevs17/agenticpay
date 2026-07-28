-- Migration: payment provider id, gas budgets/prediction, payment vaults
-- Issues: #480, #479, #478

-- #480: Add providerId to Payment model
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider_id" TEXT;
CREATE INDEX IF NOT EXISTS "payments_provider_id_idx" ON "payments"("provider_id");

-- #479: Enums (PostgreSQL)
DO $$ BEGIN
  CREATE TYPE "gas_prediction_horizon" AS ENUM ('1min', '5min', '15min');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- #479: Gas budgets
CREATE TABLE IF NOT EXISTS "gas_budgets" (
  "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"      TEXT NOT NULL,
  "wallet_address" TEXT NOT NULL,
  "chain_id"       INTEGER NOT NULL,
  "limit_gwei"     DOUBLE PRECISION NOT NULL,
  "used_gwei"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reset_at"       TIMESTAMP(3) NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"     TIMESTAMP(3),
  CONSTRAINT "gas_budgets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "gas_budgets_tenant_wallet_chain_uidx"
  ON "gas_budgets"("tenant_id", "wallet_address", "chain_id")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "gas_budgets_tenant_id_idx" ON "gas_budgets"("tenant_id");
CREATE INDEX IF NOT EXISTS "gas_budgets_wallet_chain_idx" ON "gas_budgets"("wallet_address", "chain_id");

-- #479: Gas prediction logs
CREATE TABLE IF NOT EXISTS "gas_prediction_logs" (
  "id"              TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "network"         TEXT NOT NULL,
  "horizon"         TEXT NOT NULL,
  "predicted_gwei"  DOUBLE PRECISION NOT NULL,
  "actual_gwei"     DOUBLE PRECISION,
  "error_pct"       DOUBLE PRECISION,
  "recorded_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gas_prediction_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "gas_prediction_logs_network_horizon_idx"
  ON "gas_prediction_logs"("network", "horizon", "recorded_at");

-- #478: Enums
DO $$ BEGIN
  CREATE TYPE "VaultStatus" AS ENUM ('pending', 'active', 'disputed', 'completed', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VaultMilestoneStatus" AS ENUM ('pending', 'approved', 'released', 'expired', 'disputed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- #478: Payment vaults
CREATE TABLE IF NOT EXISTS "payment_vaults" (
  "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"           TEXT NOT NULL,
  "depositor_address"   TEXT NOT NULL,
  "recipient_address"   TEXT NOT NULL,
  "total_amount"        DECIMAL(65,30) NOT NULL,
  "currency"            TEXT NOT NULL,
  "network"             TEXT NOT NULL,
  "status"              "VaultStatus" NOT NULL DEFAULT 'pending',
  "contract_address"    TEXT,
  "contract_vault_id"   TEXT,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"          TIMESTAMP(3),
  CONSTRAINT "payment_vaults_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "payment_vaults_tenant_status_idx" ON "payment_vaults"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "payment_vaults_depositor_idx" ON "payment_vaults"("depositor_address");
CREATE INDEX IF NOT EXISTS "payment_vaults_contract_idx" ON "payment_vaults"("contract_address");

-- #478: Vault milestones
CREATE TABLE IF NOT EXISTS "vault_milestones" (
  "id"               TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "vault_id"         TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "amount_percent"   INTEGER NOT NULL,
  "deadline"         TIMESTAMP(3) NOT NULL,
  "approver_address" TEXT NOT NULL,
  "status"           "VaultMilestoneStatus" NOT NULL DEFAULT 'pending',
  "released_at"      TIMESTAMP(3),
  "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"       TIMESTAMP(3),
  CONSTRAINT "vault_milestones_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vault_milestones_vault_id_fkey" FOREIGN KEY ("vault_id") REFERENCES "payment_vaults"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "vault_milestones_vault_status_idx" ON "vault_milestones"("vault_id", "status");

-- #478: Milestone releases
CREATE TABLE IF NOT EXISTS "milestone_releases" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "milestone_id" TEXT NOT NULL,
  "tx_hash"      TEXT,
  "released_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "triggered_by" TEXT NOT NULL,
  CONSTRAINT "milestone_releases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "milestone_releases_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "vault_milestones"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "milestone_releases_milestone_id_idx" ON "milestone_releases"("milestone_id");
