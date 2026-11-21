-- Issue #626, #627, #628: Multi-currency FX, jurisdiction-aware tax engine, and payment reconciliation

-- CreateEnum
CREATE TYPE "ReconciliationBatchStatus" AS ENUM ('pending', 'running', 'completed', 'completed_with_exceptions', 'failed');
CREATE TYPE "ReconciliationRecordSource" AS ENUM ('internal', 'bank_statement', 'psp_settlement', 'onchain');
CREATE TYPE "ReconciliationMatchType" AS ENUM ('exact', 'fuzzy', 'manual');
CREATE TYPE "ReconciliationExceptionStatus" AS ENUM ('open', 'investigating', 'resolved', 'written_off');
CREATE TYPE "TaxRuleType" AS ENUM ('vat', 'gst', 'sales_tax', 'withholding');

-- CreateTable
CREATE TABLE "reconciliation_batches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "status" "ReconciliationBatchStatus" NOT NULL DEFAULT 'pending',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "exception_count" INTEGER NOT NULL DEFAULT 0,
    "matched_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "unmatched_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_records" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source" "ReconciliationRecordSource" NOT NULL,
    "external_ref" TEXT,
    "payment_id" TEXT,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_matches" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "internal_record_id" TEXT NOT NULL,
    "external_record_id" TEXT NOT NULL,
    "match_type" "ReconciliationMatchType" NOT NULL DEFAULT 'exact',
    "confidence" DECIMAL(5,4) NOT NULL DEFAULT 1,
    "amount_delta" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_matches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_exceptions" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "record_id" TEXT,
    "reason" TEXT NOT NULL,
    "status" "ReconciliationExceptionStatus" NOT NULL DEFAULT 'open',
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "assigned_to" TEXT,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_jurisdiction_rules" (
    "id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rule_type" "TaxRuleType" NOT NULL,
    "rate" DECIMAL(7,6) NOT NULL,
    "applies_above" DECIMAL(20,8),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_jurisdiction_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_exemptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "certificate_id" TEXT,
    "reason" TEXT NOT NULL,
    "valid_from" TIMESTAMP(3) NOT NULL,
    "valid_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_exemptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_calculation_audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "jurisdiction" TEXT NOT NULL,
    "taxable_amount" DECIMAL(20,8) NOT NULL,
    "tax_amount" DECIMAL(20,8) NOT NULL,
    "rate" DECIMAL(7,6) NOT NULL,
    "rule_id" TEXT,
    "exemption_id" TEXT,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_calculation_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fx_rates" (
    "id" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fx_rate_alerts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "base_currency" TEXT NOT NULL,
    "quote_currency" TEXT NOT NULL,
    "threshold_pct" DECIMAL(6,4) NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'both',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMP(3),
    "last_triggered_rate" DECIMAL(24,10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fx_rate_alerts_pkey" PRIMARY KEY ("id")
);

-- AlterTable: multi-currency invoice fields
ALTER TABLE "invoices" ADD COLUMN "presentment_currency" TEXT;
ALTER TABLE "invoices" ADD COLUMN "presentment_amount" DECIMAL(20,8);
ALTER TABLE "invoices" ADD COLUMN "fx_rate" DECIMAL(24,10);
ALTER TABLE "invoices" ADD COLUMN "fx_rate_locked_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "reconciliation_batches_tenant_id_period_start_idx" ON "reconciliation_batches"("tenant_id", "period_start");
CREATE INDEX "reconciliation_batches_status_idx" ON "reconciliation_batches"("status");

CREATE INDEX "reconciliation_records_batch_id_idx" ON "reconciliation_records"("batch_id");
CREATE INDEX "reconciliation_records_tenant_id_occurred_at_idx" ON "reconciliation_records"("tenant_id", "occurred_at");
CREATE INDEX "reconciliation_records_payment_id_idx" ON "reconciliation_records"("payment_id");

CREATE INDEX "reconciliation_matches_batch_id_idx" ON "reconciliation_matches"("batch_id");

CREATE INDEX "reconciliation_exceptions_batch_id_idx" ON "reconciliation_exceptions"("batch_id");
CREATE INDEX "reconciliation_exceptions_tenant_id_status_idx" ON "reconciliation_exceptions"("tenant_id", "status");

CREATE INDEX "tax_jurisdiction_rules_jurisdiction_active_idx" ON "tax_jurisdiction_rules"("jurisdiction", "active");

CREATE INDEX "tax_exemptions_tenant_id_merchant_id_jurisdiction_idx" ON "tax_exemptions"("tenant_id", "merchant_id", "jurisdiction");

CREATE INDEX "tax_calculation_audit_logs_tenant_id_merchant_id_created_a_idx" ON "tax_calculation_audit_logs"("tenant_id", "merchant_id", "created_at");
CREATE INDEX "tax_calculation_audit_logs_payment_id_idx" ON "tax_calculation_audit_logs"("payment_id");

CREATE INDEX "fx_rates_base_currency_quote_currency_expires_at_idx" ON "fx_rates"("base_currency", "quote_currency", "expires_at");
CREATE INDEX "fx_rates_base_currency_quote_currency_fetched_at_idx" ON "fx_rates"("base_currency", "quote_currency", "fetched_at");

CREATE INDEX "fx_rate_alerts_tenant_id_base_currency_quote_currency_idx" ON "fx_rate_alerts"("tenant_id", "base_currency", "quote_currency");

-- AddForeignKey
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "reconciliation_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
