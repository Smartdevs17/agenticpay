-- Issues #690, #691, #692, #693: Automated tax reporting, multi-format export, tax calendar

-- CreateEnum
CREATE TYPE "TaxReportPeriod" AS ENUM ('monthly', 'quarterly', 'annual');
CREATE TYPE "TaxReportStatus" AS ENUM ('draft', 'finalized', 'archived');
CREATE TYPE "TaxReportType" AS ENUM ('summary', 'vat', 'sales_tax', 'gst', 'withholding', 'filing', 'consolidated');
CREATE TYPE "DeadlineFrequency" AS ENUM ('monthly', 'quarterly', 'semi_annual', 'annual');
CREATE TYPE "DeadlineStatus" AS ENUM ('upcoming', 'due_soon', 'overdue', 'completed', 'extension');

-- CreateTable
CREATE TABLE "tax_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "report_type" "TaxReportType" NOT NULL DEFAULT 'summary',
    "period" "TaxReportPeriod" NOT NULL,
    "year" INTEGER NOT NULL,
    "period_number" INTEGER NOT NULL,
    "status" "TaxReportStatus" NOT NULL DEFAULT 'draft',
    "reporting_currency" TEXT NOT NULL DEFAULT 'USD',
    "gross_volume" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "refund_volume" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "net_volume" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_tax_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "jurisdiction_data" JSONB NOT NULL DEFAULT '[]',
    "compliance_score" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "metadata" JSONB,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_filing_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "TaxReportStatus" NOT NULL DEFAULT 'draft',
    "reporting_currency" TEXT NOT NULL DEFAULT 'USD',
    "total_gross_volume" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "total_tax_amount" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "jurisdictions" JSONB NOT NULL DEFAULT '[]',
    "report_ids" JSONB NOT NULL DEFAULT '[]',
    "compliance_score" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_filing_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_deadlines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "frequency" "DeadlineFrequency" NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "status" "DeadlineStatus" NOT NULL DEFAULT 'upcoming',
    "due_soon_threshold_days" INTEGER NOT NULL DEFAULT 14,
    "completed_at" TIMESTAMP(3),
    "extension_until" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_reports_tenant_id_merchant_id_year_idx" ON "tax_reports"("tenant_id", "merchant_id", "year");
CREATE INDEX "tax_reports_status_idx" ON "tax_reports"("status");
CREATE INDEX "tax_reports_period_year_idx" ON "tax_reports"("period", "year");

CREATE INDEX "tax_filing_reports_tenant_id_merchant_id_year_idx" ON "tax_filing_reports"("tenant_id", "merchant_id", "year");

CREATE INDEX "tax_deadlines_tenant_id_merchant_id_due_date_idx" ON "tax_deadlines"("tenant_id", "merchant_id", "due_date");
CREATE INDEX "tax_deadlines_jurisdiction_status_idx" ON "tax_deadlines"("jurisdiction", "status");
CREATE INDEX "tax_deadlines_status_due_date_idx" ON "tax_deadlines"("status", "due_date");
