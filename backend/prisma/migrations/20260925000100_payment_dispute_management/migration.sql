-- Payment dispute management — Issue #816
--
-- Persists disputes filed against a Payment. Evidence and messages are
-- append-only sub-records with no independent query needs of their own,
-- so they're stored as JSON columns rather than separate join tables,
-- matching payments.metadata's own convention.

DO $$ BEGIN
  CREATE TYPE "DisputeStatus" AS ENUM (
    'pending', 'awaiting_response', 'under_review', 'resolved', 'escalated', 'dismissed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DisputeReason" AS ENUM (
    'service_not_delivered', 'partial_delivery', 'quality_issue',
    'unauthorized_charge', 'duplicate_charge', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DisputeResolutionOutcome" AS ENUM (
    'full_refund', 'partial_refund', 'release_to_payee', 'dismissed', 'pending'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "disputes" (
  "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "tenant_id"           TEXT NOT NULL,
  "payment_id"          TEXT NOT NULL,
  "project_id"          TEXT,
  "invoice_id"          TEXT,
  "filed_by"            TEXT NOT NULL,
  "respondent_id"       TEXT NOT NULL,
  "arbitrator_id"       TEXT,
  "status"              "DisputeStatus" NOT NULL DEFAULT 'awaiting_response',
  "reason"              "DisputeReason" NOT NULL,
  "amount"              DECIMAL(20, 8) NOT NULL,
  "currency"            TEXT NOT NULL,
  "description"         TEXT NOT NULL,
  "evidence"            JSONB NOT NULL DEFAULT '[]',
  "messages"            JSONB NOT NULL DEFAULT '[]',
  "resolution"          "DisputeResolutionOutcome" NOT NULL DEFAULT 'pending',
  "resolution_note"     TEXT,
  "refund_amount"       DECIMAL(20, 8),
  "response_deadline"   TIMESTAMP(3) NOT NULL,
  "escalation_deadline" TIMESTAMP(3) NOT NULL,
  "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at"         TIMESTAMP(3),
  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "disputes_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id")
);

CREATE INDEX IF NOT EXISTS "disputes_tenant_id_status_idx" ON "disputes"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "disputes_payment_id_idx" ON "disputes"("payment_id");
CREATE INDEX IF NOT EXISTS "disputes_pending_escalation_idx" ON "disputes"("status", "response_deadline");
