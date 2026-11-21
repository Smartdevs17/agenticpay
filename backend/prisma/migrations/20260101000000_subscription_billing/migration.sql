-- Subscription billing with metered usage and tiered pricing (Issue #570)

-- Create subscription-related enums
CREATE TYPE "SubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled', 'unpaid', 'trialing', 'paused');
CREATE TYPE "UsageMetricType" AS ENUM ('api_calls', 'storage_gb', 'compute_hours', 'transactions', 'custom');
CREATE TYPE "BillingInterval" AS ENUM ('monthly', 'yearly');

-- Subscription plans table
CREATE TABLE "subscription_plans" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "stripe_price_id" TEXT,
  "base_price" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "billing_interval" "BillingInterval" NOT NULL,
  "features" JSONB,
  "usage_limits" JSONB,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "trial_days" INTEGER NOT NULL DEFAULT 0,
  "grace_period_days" INTEGER NOT NULL DEFAULT 3,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "subscription_plans_tenant_id_name_key" UNIQUE ("tenant_id", "name")
);

CREATE INDEX "subscription_plans_tenant_id_idx" ON "subscription_plans" ("tenant_id");
CREATE INDEX "subscription_plans_is_active_idx" ON "subscription_plans" ("is_active");

-- Metered pricing configuration
CREATE TABLE "metered_pricing" (
  "id" TEXT PRIMARY KEY,
  "plan_id" TEXT NOT NULL,
  "metric_type" "UsageMetricType" NOT NULL,
  "stripe_meter_id" TEXT,
  "unit_price" DECIMAL(10, 4) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "included_units" INTEGER NOT NULL DEFAULT 0,
  "tiers" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "metered_pricing_plan_id_metric_type_key" UNIQUE ("plan_id", "metric_type"),
  CONSTRAINT "metered_pricing_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "metered_pricing_plan_id_idx" ON "metered_pricing" ("plan_id");

-- Subscriptions table
CREATE TABLE "subscriptions" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "stripe_subscription_id" TEXT UNIQUE,
  "stripe_customer_id" TEXT,
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
  "current_period_start" TIMESTAMP(3) NOT NULL,
  "current_period_end" TIMESTAMP(3) NOT NULL,
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "canceled_at" TIMESTAMP(3),
  "trial_start" TIMESTAMP(3),
  "trial_end" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "subscriptions_tenant_id_idx" ON "subscriptions" ("tenant_id");
CREATE INDEX "subscriptions_user_id_idx" ON "subscriptions" ("user_id");
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions" ("plan_id");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions" ("status");
CREATE INDEX "subscriptions_stripe_subscription_id_idx" ON "subscriptions" ("stripe_subscription_id");

-- Usage records table
CREATE TABLE "usage_records" (
  "id" TEXT PRIMARY KEY,
  "subscription_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "metric_type" "UsageMetricType" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "aggregated_at" TIMESTAMP(3),
  "billed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "usage_records_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "usage_records_subscription_id_idx" ON "usage_records" ("subscription_id");
CREATE INDEX "usage_records_tenant_id_idx" ON "usage_records" ("tenant_id");
CREATE INDEX "usage_records_metric_type_idx" ON "usage_records" ("metric_type");
CREATE INDEX "usage_records_timestamp_idx" ON "usage_records" ("timestamp");
CREATE INDEX "usage_records_aggregated_at_idx" ON "usage_records" ("aggregated_at");

-- Usage aggregates table
CREATE TABLE "usage_aggregates" (
  "id" TEXT PRIMARY KEY,
  "subscription_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "metric_type" "UsageMetricType" NOT NULL,
  "total_quantity" INTEGER NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "cost" DECIMAL(10, 4) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_aggregates_subscription_id_metric_type_period_start_key" UNIQUE ("subscription_id", "metric_type", "period_start")
);

CREATE INDEX "usage_aggregates_subscription_id_idx" ON "usage_aggregates" ("subscription_id");
CREATE INDEX "usage_aggregates_tenant_id_idx" ON "usage_aggregates" ("tenant_id");
CREATE INDEX "usage_aggregates_period_start_idx" ON "usage_aggregates" ("period_start");

-- Subscription invoices table
CREATE TABLE "subscription_invoices" (
  "id" TEXT PRIMARY KEY,
  "subscription_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "stripe_invoice_id" TEXT UNIQUE,
  "amount" DECIMAL(10, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "period_end" TIMESTAMP(3) NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "paid_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_payment_attempt" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "subscription_invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "subscription_invoices_subscription_id_idx" ON "subscription_invoices" ("subscription_id");
CREATE INDEX "subscription_invoices_tenant_id_idx" ON "subscription_invoices" ("tenant_id");
CREATE INDEX "subscription_invoices_status_idx" ON "subscription_invoices" ("status");
CREATE INDEX "subscription_invoices_due_date_idx" ON "subscription_invoices" ("due_date");

-- Usage alerts table
CREATE TABLE "usage_alerts" (
  "id" TEXT PRIMARY KEY,
  "subscription_id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "metric_type" "UsageMetricType" NOT NULL,
  "threshold" INTEGER NOT NULL,
  "triggered" BOOLEAN NOT NULL DEFAULT false,
  "triggered_at" TIMESTAMP(3),
  "notified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_alerts_subscription_id_metric_type_threshold_key" UNIQUE ("subscription_id", "metric_type", "threshold")
);

CREATE INDEX "usage_alerts_subscription_id_idx" ON "usage_alerts" ("subscription_id");
CREATE INDEX "usage_alerts_triggered_idx" ON "usage_alerts" ("triggered");
