-- Migration: Add PaymentRequest model with expiration fields
-- Issue #460 — Payment Request Expiration with Smart Contract Enforcement

CREATE TYPE "PaymentRequestStatus" AS ENUM ('pending', 'paid', 'expired', 'cancelled');

CREATE TABLE "payment_requests" (
    "id"                  TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "tenant_id"           TEXT NOT NULL,
    "requester_id"        TEXT NOT NULL,
    "payer_address"       TEXT,
    "requester_address"   TEXT NOT NULL,
    "amount"              DECIMAL(20,8) NOT NULL,
    "currency"            TEXT NOT NULL DEFAULT 'XLM',
    "network"             TEXT NOT NULL DEFAULT 'stellar',
    "token_address"       TEXT,
    "status"              "PaymentRequestStatus" NOT NULL DEFAULT 'pending',
    "expires_at"          TIMESTAMP(3) NOT NULL,
    "expired_at"          TIMESTAMP(3),
    "paid_at"             TIMESTAMP(3),
    "contract_request_id" TEXT,
    "memo"                TEXT,
    "metadata"            JSONB,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"          TIMESTAMP(3),

    CONSTRAINT "payment_requests_pkey" PRIMARY KEY ("id")
);

-- Indexes for dashboard filtering and sweep cron
CREATE INDEX "payment_requests_tenant_status_idx"  ON "payment_requests"("tenant_id", "status");
CREATE INDEX "payment_requests_expires_at_idx"     ON "payment_requests"("expires_at");
CREATE INDEX "payment_requests_status_expires_idx" ON "payment_requests"("status", "expires_at");
CREATE INDEX "payment_requests_requester_id_idx"   ON "payment_requests"("requester_id");
CREATE INDEX "payment_requests_payer_address_idx"  ON "payment_requests"("payer_address");
CREATE INDEX "payment_requests_created_at_idx"     ON "payment_requests"("created_at");
