-- Issues #940, #937, #938, #939: Automated financial statements,
-- reconciliation, settlement, and payout failure analytics reports.

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('pending', 'generating', 'completed', 'failed');
CREATE TYPE "ReportType" AS ENUM ('reconciliation', 'settlement', 'financial_statement', 'payout_failure_analytics');

-- CreateTable
CREATE TABLE "report_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "type" "ReportType" NOT NULL DEFAULT 'reconciliation',
    "status" "ReportStatus" NOT NULL DEFAULT 'pending',
    "date_from" TIMESTAMP(3) NOT NULL,
    "date_to" TIMESTAMP(3) NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'json',
    "filters" JSONB,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "report_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_archives" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_reports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "dimensions" JSONB NOT NULL DEFAULT '[]',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "chart_type" TEXT NOT NULL DEFAULT '',
    "date_range" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "day_of_week" INTEGER,
    "day_of_month" INTEGER,
    "time" TEXT NOT NULL DEFAULT '09:00',
    "recipients" TEXT[] NOT NULL DEFAULT '{}',
    "next_send_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_templates" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "dimensions" JSONB NOT NULL DEFAULT '[]',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "chart_type" TEXT NOT NULL DEFAULT '',
    "date_range" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_jobs_tenant_id_status_idx" ON "report_jobs"("tenant_id", "status");
CREATE INDEX "report_jobs_type_idx" ON "report_jobs"("type");
CREATE INDEX "report_jobs_created_at_idx" ON "report_jobs"("created_at");

CREATE INDEX "report_archives_report_id_idx" ON "report_archives"("report_id");
CREATE INDEX "report_archives_created_at_idx" ON "report_archives"("created_at");

CREATE INDEX "saved_reports_tenant_id_idx" ON "saved_reports"("tenant_id");
CREATE INDEX "saved_reports_is_favorite_idx" ON "saved_reports"("is_favorite");

CREATE INDEX "report_templates_is_public_idx" ON "report_templates"("is_public");

-- AddForeignKey
ALTER TABLE "report_archives" ADD CONSTRAINT "report_archives_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "report_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "report_templates" ADD CONSTRAINT "report_templates_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "saved_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
