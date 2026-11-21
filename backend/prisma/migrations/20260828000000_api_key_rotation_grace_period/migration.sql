-- Issue #756: API key rotation with grace period and usage tracking

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN "rotated_at" TIMESTAMP(3);
ALTER TABLE "api_keys" ADD COLUMN "grace_period_ends_at" TIMESTAMP(3);
ALTER TABLE "api_keys" ADD COLUMN "predecessor_key_id" TEXT;
ALTER TABLE "api_keys" ADD COLUMN "successor_key_id" TEXT;
