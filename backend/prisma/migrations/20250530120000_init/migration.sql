-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('free', 'pro', 'enterprise');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('milestone_payment', 'full_payment', 'refund');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'active', 'completed', 'cancelled', 'disputed');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('pending', 'in_progress', 'submitted', 'approved', 'rejected', 'completed');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('active', 'disabled', 'failed');

-- CreateEnum
CREATE TYPE "PaymentLinkStatus" AS ENUM ('active', 'expired', 'used', 'disabled');

-- CreateEnum
CREATE TYPE "EmailCategory" AS ENUM ('payment_receipt', 'payment_confirmation', 'refund_notification', 'dispute_update', 'weekly_summary', 'marketing', 'security_alert', 'onboarding');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('pending', 'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed');

-- CreateEnum
CREATE TYPE "DeliveryProvider" AS ENUM ('smtp', 'sendgrid');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tier" "UserTier" NOT NULL DEFAULT 'free',
    "wallet_address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tx_hash" TEXT,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "network" TEXT NOT NULL DEFAULT 'stellar',
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "type" "PaymentType" NOT NULL DEFAULT 'milestone_payment',
    "project_title" TEXT,
    "project_id" TEXT,
    "milestone_id" TEXT,
    "user_id" TEXT,
    "from_address" TEXT,
    "to_address" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "total_amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "client_address" TEXT NOT NULL,
    "freelancer_address" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "status" "MilestoneStatus" NOT NULL DEFAULT 'pending',
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "milestone_id" TEXT,
    "tenant_id" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'active',
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "last_fired" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_links" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "amount" DECIMAL(20,8),
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "description" TEXT,
    "status" "PaymentLinkStatus" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "payment_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "user_id" TEXT,
    "metadata" JSONB,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gas_estimates" (
    "id" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "gas_price_gwei" DECIMAL(30,9) NOT NULL,
    "base_fee_gwei" DECIMAL(30,9),
    "priority_fee_gwei" DECIMAL(30,9),
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gas_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "wallet_address" TEXT NOT NULL,
    "fake_balance" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sandbox_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_transactions" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XLM',
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "type" TEXT NOT NULL DEFAULT 'payment',
    "mock_data" JSONB,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sandbox_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sandbox_migrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "source_account_id" TEXT NOT NULL,
    "target_account_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "steps" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sandbox_migrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "EmailCategory" NOT NULL,
    "subject" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "text_body" TEXT,
    "variables" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_template_localizations" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "text_body" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_template_localizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "template_id" TEXT,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "subject" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "text_body" TEXT,
    "status" "EmailStatus" NOT NULL DEFAULT 'pending',
    "provider" "DeliveryProvider" NOT NULL DEFAULT 'smtp',
    "provider_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "bounce_reason" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "payment_receipts" BOOLEAN NOT NULL DEFAULT true,
    "payment_confirmations" BOOLEAN NOT NULL DEFAULT true,
    "refund_notifications" BOOLEAN NOT NULL DEFAULT true,
    "dispute_updates" BOOLEAN NOT NULL DEFAULT true,
    "weekly_summaries" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "onboarding" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_analytics" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "template_id" TEXT,
    "category" "EmailCategory" NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_count" INTEGER NOT NULL DEFAULT 0,
    "opened_count" INTEGER NOT NULL DEFAULT 0,
    "clicked_count" INTEGER NOT NULL DEFAULT 0,
    "bounced_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenant_id_email_idx" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "users_wallet_address_idx" ON "users"("wallet_address");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "payments_tx_hash_key" ON "payments"("tx_hash");

-- CreateIndex
CREATE INDEX "payments_tenant_id_created_at_idx" ON "payments"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_active_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payments_tx_hash_idx" ON "payments"("tx_hash");

-- CreateIndex
CREATE INDEX "payments_project_id_idx" ON "payments"("project_id");

-- CreateIndex
CREATE INDEX "projects_tenant_id_created_at_idx" ON "projects"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- CreateIndex
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_generated_at_idx" ON "invoices"("tenant_id", "generated_at");

-- CreateIndex
CREATE INDEX "invoices_project_id_idx" ON "invoices"("project_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "webhooks_tenant_id_idx" ON "webhooks"("tenant_id");

-- CreateIndex
CREATE INDEX "webhooks_status_idx" ON "webhooks"("status");

-- CreateIndex
CREATE INDEX "payment_links_merchant_id_idx" ON "payment_links"("merchant_id");

-- CreateIndex
CREATE INDEX "payment_links_status_idx" ON "payment_links"("status");

-- CreateIndex
CREATE INDEX "audit_logs_entity_id_created_at_idx" ON "audit_logs"("entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_action_idx" ON "audit_logs"("entity_type", "action");

-- CreateIndex
CREATE UNIQUE INDEX "gas_estimates_network_key" ON "gas_estimates"("network");

-- CreateIndex
CREATE INDEX "gas_estimates_network_recorded_at_idx" ON "gas_estimates"("network", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_accounts_wallet_address_key" ON "sandbox_accounts"("wallet_address");

-- CreateIndex
CREATE INDEX "sandbox_accounts_tenant_id_idx" ON "sandbox_accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "sandbox_accounts_wallet_address_idx" ON "sandbox_accounts"("wallet_address");

-- CreateIndex
CREATE INDEX "sandbox_accounts_is_active_idx" ON "sandbox_accounts"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_accounts_tenant_id_email_key" ON "sandbox_accounts"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_transactions_tx_hash_key" ON "sandbox_transactions"("tx_hash");

-- CreateIndex
CREATE INDEX "sandbox_transactions_account_id_idx" ON "sandbox_transactions"("account_id");

-- CreateIndex
CREATE INDEX "sandbox_transactions_tx_hash_idx" ON "sandbox_transactions"("tx_hash");

-- CreateIndex
CREATE INDEX "sandbox_transactions_status_idx" ON "sandbox_transactions"("status");

-- CreateIndex
CREATE INDEX "sandbox_transactions_created_at_idx" ON "sandbox_transactions"("created_at");

-- CreateIndex
CREATE INDEX "sandbox_migrations_tenant_id_idx" ON "sandbox_migrations"("tenant_id");

-- CreateIndex
CREATE INDEX "sandbox_migrations_status_idx" ON "sandbox_migrations"("status");

-- CreateIndex
CREATE INDEX "email_templates_tenant_id_idx" ON "email_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "email_templates_category_idx" ON "email_templates"("category");

-- CreateIndex
CREATE INDEX "email_templates_locale_idx" ON "email_templates"("locale");

-- CreateIndex
CREATE INDEX "email_templates_is_active_idx" ON "email_templates"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "email_templates_tenant_id_name_locale_key" ON "email_templates"("tenant_id", "name", "locale");

-- CreateIndex
CREATE INDEX "email_template_localizations_template_id_idx" ON "email_template_localizations"("template_id");

-- CreateIndex
CREATE INDEX "email_template_localizations_locale_idx" ON "email_template_localizations"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "email_template_localizations_template_id_locale_key" ON "email_template_localizations"("template_id", "locale");

-- CreateIndex
CREATE INDEX "email_deliveries_tenant_id_idx" ON "email_deliveries"("tenant_id");

-- CreateIndex
CREATE INDEX "email_deliveries_recipient_email_idx" ON "email_deliveries"("recipient_email");

-- CreateIndex
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries"("status");

-- CreateIndex
CREATE INDEX "email_deliveries_template_id_idx" ON "email_deliveries"("template_id");

-- CreateIndex
CREATE INDEX "email_deliveries_sent_at_idx" ON "email_deliveries"("sent_at");

-- CreateIndex
CREATE INDEX "email_deliveries_provider_id_idx" ON "email_deliveries"("provider_id");

-- CreateIndex
CREATE INDEX "email_preferences_tenant_id_idx" ON "email_preferences"("tenant_id");

-- CreateIndex
CREATE INDEX "email_preferences_email_idx" ON "email_preferences"("email");

-- CreateIndex
CREATE UNIQUE INDEX "email_preferences_tenant_id_email_key" ON "email_preferences"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_preferences_user_id_key" ON "email_preferences"("user_id");

-- CreateIndex
CREATE INDEX "email_analytics_tenant_id_idx" ON "email_analytics"("tenant_id");

-- CreateIndex
CREATE INDEX "email_analytics_category_idx" ON "email_analytics"("category");

-- CreateIndex
CREATE INDEX "email_analytics_date_idx" ON "email_analytics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "email_analytics_tenant_id_category_date_key" ON "email_analytics"("tenant_id", "category", "date");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sandbox_transactions" ADD CONSTRAINT "sandbox_transactions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "sandbox_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
