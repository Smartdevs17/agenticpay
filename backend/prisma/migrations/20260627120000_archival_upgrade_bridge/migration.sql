-- Issue #473, #474, #475: Archival, upgrade validation, and bridge monitoring models

-- CreateEnum
CREATE TYPE "ArchivalBatchStatus" AS ENUM ('pending', 'collecting', 'compressing', 'uploading', 'completed', 'failed', 'restoring');
CREATE TYPE "ArchivalChain" AS ENUM ('stellar', 'ethereum', 'polygon', 'base', 'arbitrum', 'soroban');
CREATE TYPE "UpgradeValidationStatus" AS ENUM ('pending', 'running', 'passed', 'failed', 'rolled_back');
CREATE TYPE "ContractPlatform" AS ENUM ('evm', 'soroban');
CREATE TYPE "BridgeProvider" AS ENUM ('wormhole', 'layerzero', 'axelar', 'custom');
CREATE TYPE "BridgeMessageStatus" AS ENUM ('initiated', 'source_confirmed', 'relayed', 'destination_executed', 'failed', 'stuck', 'expired');
CREATE TYPE "BridgeAlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "archival_batches" (
    "id" TEXT NOT NULL,
    "batch_date" DATE NOT NULL,
    "status" "ArchivalBatchStatus" NOT NULL DEFAULT 'pending',
    "chain" "ArchivalChain" NOT NULL,
    "record_count" INTEGER NOT NULL DEFAULT 0,
    "uncompressed_bytes" BIGINT NOT NULL DEFAULT 0,
    "compressed_bytes" BIGINT NOT NULL DEFAULT 0,
    "content_hash" TEXT,
    "ipfs_cid" TEXT,
    "ipfs_url" TEXT,
    "verified_hash" TEXT,
    "error_message" TEXT,
    "retention_until" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "archival_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_archives" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "chain" "ArchivalChain" NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "block_number" BIGINT NOT NULL,
    "block_hash" TEXT,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "proof_of_inclusion" JSONB NOT NULL,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_archives_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_upgrades" (
    "id" TEXT NOT NULL,
    "contract_name" TEXT NOT NULL,
    "platform" "ContractPlatform" NOT NULL,
    "network" TEXT NOT NULL,
    "proxy_address" TEXT NOT NULL,
    "previous_implementation" TEXT,
    "new_implementation" TEXT NOT NULL,
    "deployer_address" TEXT,
    "timelock_address" TEXT,
    "status" "UpgradeValidationStatus" NOT NULL DEFAULT 'pending',
    "deployed_at" TIMESTAMP(3),
    "rolled_back_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_upgrades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "upgrade_validation_reports" (
    "id" TEXT NOT NULL,
    "upgrade_id" TEXT NOT NULL,
    "status" "UpgradeValidationStatus" NOT NULL,
    "storage_layout_diff" JSONB,
    "simulation_passed" BOOLEAN NOT NULL DEFAULT false,
    "smoke_tests_passed" BOOLEAN NOT NULL DEFAULT false,
    "admin_preserved" BOOLEAN NOT NULL DEFAULT false,
    "proxy_admin_valid" BOOLEAN NOT NULL DEFAULT false,
    "implementation_verified" BOOLEAN NOT NULL DEFAULT false,
    "failures" JSONB,
    "warnings" JSONB,
    "fork_block_number" BIGINT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upgrade_validation_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bridge_messages" (
    "id" TEXT NOT NULL,
    "provider" "BridgeProvider" NOT NULL,
    "source_chain" TEXT NOT NULL,
    "destination_chain" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "tx_hash_source" TEXT,
    "tx_hash_destination" TEXT,
    "status" "BridgeMessageStatus" NOT NULL DEFAULT 'initiated',
    "amount" TEXT,
    "token_address" TEXT,
    "sender" TEXT,
    "recipient" TEXT,
    "gas_cost_source" TEXT,
    "gas_cost_destination" TEXT,
    "initiated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_confirmed_at" TIMESTAMP(3),
    "relayed_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "expected_delivery_ms" INTEGER NOT NULL DEFAULT 300000,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bridge_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bridge_alerts" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "severity" "BridgeAlertSeverity" NOT NULL,
    "alert_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bridge_alerts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bridge_retries" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "tx_hash" TEXT,
    "error_message" TEXT,
    "initiated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "bridge_retries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "archival_batches_batch_date_chain_key" ON "archival_batches"("batch_date", "chain");
CREATE INDEX "archival_batches_status_idx" ON "archival_batches"("status");
CREATE INDEX "archival_batches_batch_date_idx" ON "archival_batches"("batch_date");
CREATE INDEX "archival_batches_ipfs_cid_idx" ON "archival_batches"("ipfs_cid");

CREATE INDEX "data_archives_batch_id_idx" ON "data_archives"("batch_id");
CREATE INDEX "data_archives_chain_tx_hash_idx" ON "data_archives"("chain", "tx_hash");
CREATE INDEX "data_archives_block_number_idx" ON "data_archives"("block_number");

CREATE INDEX "contract_upgrades_network_contract_name_idx" ON "contract_upgrades"("network", "contract_name");
CREATE INDEX "contract_upgrades_status_idx" ON "contract_upgrades"("status");

CREATE INDEX "upgrade_validation_reports_upgrade_id_idx" ON "upgrade_validation_reports"("upgrade_id");
CREATE INDEX "upgrade_validation_reports_status_idx" ON "upgrade_validation_reports"("status");

CREATE UNIQUE INDEX "bridge_messages_provider_message_id_key" ON "bridge_messages"("provider", "message_id");
CREATE INDEX "bridge_messages_status_idx" ON "bridge_messages"("status");
CREATE INDEX "bridge_messages_provider_idx" ON "bridge_messages"("provider");
CREATE INDEX "bridge_messages_source_chain_destination_chain_idx" ON "bridge_messages"("source_chain", "destination_chain");
CREATE INDEX "bridge_messages_initiated_at_idx" ON "bridge_messages"("initiated_at");

CREATE INDEX "bridge_alerts_message_id_idx" ON "bridge_alerts"("message_id");
CREATE INDEX "bridge_alerts_severity_idx" ON "bridge_alerts"("severity");

CREATE INDEX "bridge_retries_message_id_idx" ON "bridge_retries"("message_id");

-- AddForeignKey
ALTER TABLE "data_archives" ADD CONSTRAINT "data_archives_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "archival_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upgrade_validation_reports" ADD CONSTRAINT "upgrade_validation_reports_upgrade_id_fkey" FOREIGN KEY ("upgrade_id") REFERENCES "contract_upgrades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bridge_alerts" ADD CONSTRAINT "bridge_alerts_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "bridge_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bridge_retries" ADD CONSTRAINT "bridge_retries_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "bridge_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
