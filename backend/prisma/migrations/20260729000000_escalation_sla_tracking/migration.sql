-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('dispute', 'payment_discrepancy', 'fraud_alert', 'compliance_review', 'support_ticket', 'account_issue', 'system_incident');
CREATE TYPE "IssueSeverity" AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE "EscalationLevel" AS ENUM ('level_1', 'level_2', 'level_3', 'management');
CREATE TYPE "SLAStatus" AS ENUM ('compliant', 'at_risk', 'breached', 'resolved');

-- CreateTable: escalation_rules
CREATE TABLE "escalation_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "issue_type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "response_time_mins" INTEGER NOT NULL,
    "resolution_time_mins" INTEGER NOT NULL,
    "escalation_chain" JSONB NOT NULL,
    "notify_channels" JSONB NOT NULL,
    "notify_roles" TEXT[],
    "auto_escalate" BOOLEAN NOT NULL DEFAULT true,
    "cooldown_mins" INTEGER NOT NULL DEFAULT 60,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escalation_rules_tenant_id_name_key" UNIQUE ("tenant_id", "name")
);

-- CreateTable: issue_slas
CREATE TABLE "issue_slas" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "escalation_rule_id" TEXT,
    "issue_type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "response_time_mins" INTEGER NOT NULL,
    "resolution_time_mins" INTEGER NOT NULL,
    "warning_threshold_pct" INTEGER NOT NULL DEFAULT 80,
    "business_hours_only" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "issue_slas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "issue_slas_tenant_id_issue_type_severity_key" UNIQUE ("tenant_id", "issue_type", "severity")
);

-- CreateTable: escalation_events
CREATE TABLE "escalation_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "rule_id" TEXT,
    "issue_id" TEXT NOT NULL,
    "issue_type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
    "from_level" "EscalationLevel" NOT NULL,
    "to_level" "EscalationLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "triggered_by" TEXT,
    "notified_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sla_breaches
CREATE TABLE "sla_breaches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sla_id" TEXT,
    "issue_id" TEXT NOT NULL,
    "issue_type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
    "breach_type" TEXT NOT NULL,
    "target_mins" INTEGER NOT NULL,
    "actual_mins" INTEGER NOT NULL,
    "status" "SLAStatus" NOT NULL DEFAULT 'breached',
    "notified_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_breaches_pkey" PRIMARY KEY ("id")
);

-- CreateTable: escalation_analytics
CREATE TABLE "escalation_analytics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "issue_type" "IssueType" NOT NULL,
    "severity" "IssueSeverity" NOT NULL DEFAULT 'medium',
    "period" TEXT NOT NULL DEFAULT 'daily',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "total_issues" INTEGER NOT NULL DEFAULT 0,
    "escalated_count" INTEGER NOT NULL DEFAULT 0,
    "sla_breach_count" INTEGER NOT NULL DEFAULT 0,
    "resolved_count" INTEGER NOT NULL DEFAULT 0,
    "avg_response_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_resolution_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_escalation_time" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sla_compliance_pct" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "open_count" INTEGER NOT NULL DEFAULT 0,
    "at_risk_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "escalation_analytics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escalation_analytics_tenant_id_issue_type_severity__key" UNIQUE ("tenant_id", "issue_type", "severity", "period", "period_start")
);

-- CreateIndex
CREATE INDEX "escalation_rules_tenant_id_issue_type_idx" ON "escalation_rules"("tenant_id", "issue_type");
CREATE INDEX "escalation_rules_is_active_idx" ON "escalation_rules"("is_active");

CREATE INDEX "issue_slas_tenant_id_issue_type_idx" ON "issue_slas"("tenant_id", "issue_type");
CREATE INDEX "issue_slas_is_active_idx" ON "issue_slas"("is_active");

CREATE INDEX "escalation_events_tenant_id_issue_id_idx" ON "escalation_events"("tenant_id", "issue_id");
CREATE INDEX "escalation_events_tenant_id_issue_type_created_at_idx" ON "escalation_events"("tenant_id", "issue_type", "created_at");
CREATE INDEX "escalation_events_created_at_idx" ON "escalation_events"("created_at");

CREATE INDEX "sla_breaches_tenant_id_issue_id_idx" ON "sla_breaches"("tenant_id", "issue_id");
CREATE INDEX "sla_breaches_tenant_id_issue_type_created_at_idx" ON "sla_breaches"("tenant_id", "issue_type", "created_at");
CREATE INDEX "sla_breaches_status_idx" ON "sla_breaches"("status");
CREATE INDEX "sla_breaches_created_at_idx" ON "sla_breaches"("created_at");

CREATE INDEX "escalation_analytics_tenant_id_period_start_idx" ON "escalation_analytics"("tenant_id", "period_start");
CREATE INDEX "escalation_analytics_tenant_id_issue_type_idx" ON "escalation_analytics"("tenant_id", "issue_type");

-- AddForeignKey
ALTER TABLE "issue_slas" ADD CONSTRAINT "issue_slas_escalation_rule_id_fkey" FOREIGN KEY ("escalation_rule_id") REFERENCES "escalation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "escalation_events" ADD CONSTRAINT "escalation_events_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "escalation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sla_breaches" ADD CONSTRAINT "sla_breaches_sla_id_fkey" FOREIGN KEY ("sla_id") REFERENCES "issue_slas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Down migration
-- ALTER TABLE "sla_breaches" DROP CONSTRAINT "sla_breaches_sla_id_fkey";
-- ALTER TABLE "escalation_events" DROP CONSTRAINT "escalation_events_rule_id_fkey";
-- ALTER TABLE "issue_slas" DROP CONSTRAINT "issue_slas_escalation_rule_id_fkey";
-- DROP TABLE "escalation_analytics";
-- DROP TABLE "sla_breaches";
-- DROP TABLE "escalation_events";
-- DROP TABLE "issue_slas";
-- DROP TABLE "escalation_rules";
-- DROP TYPE "SLAStatus";
-- DROP TYPE "EscalationLevel";
-- DROP TYPE "IssueSeverity";
-- DROP TYPE "IssueType";
