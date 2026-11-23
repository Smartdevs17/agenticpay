-- Issue #1472: replay-receipt table for all inbound webhooks.

-- CreateEnum
CREATE TYPE "WebhookReceiptStatus" AS ENUM ('processing', 'processed', 'failed');

-- CreateTable
CREATE TABLE "webhook_receipts" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "signature_hash" TEXT,
    "payload_hash" TEXT NOT NULL,
    "status" "WebhookReceiptStatus" NOT NULL DEFAULT 'processing',
    "delivery_count" INTEGER NOT NULL DEFAULT 1,
    "response_status" INTEGER,
    "source_ip" TEXT,
    "event_timestamp" TIMESTAMP(3),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_receipts_provider_event_id_key" ON "webhook_receipts"("provider", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_receipts_provider_signature_hash_key" ON "webhook_receipts"("provider", "signature_hash");

-- CreateIndex
CREATE INDEX "webhook_receipts_expires_at_idx" ON "webhook_receipts"("expires_at");

-- CreateIndex
CREATE INDEX "webhook_receipts_status_claimed_at_idx" ON "webhook_receipts"("status", "claimed_at");
