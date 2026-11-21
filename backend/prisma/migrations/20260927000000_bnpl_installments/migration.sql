-- Issue #919: BNPL installment plans
-- Adds financed installment plans plus their per-installment schedule.
-- The schedule is materialised (one row per installment) so dunning jobs can
-- index directly on (status, due_at) instead of recomputing dates.

-- CreateEnum
CREATE TYPE "InstallmentPlanStatus" AS ENUM ('active', 'completed', 'cancelled', 'defaulted');
CREATE TYPE "InstallmentStatus" AS ENUM ('scheduled', 'due', 'paid', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "installment_plans" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "merchant_id" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "principal" DECIMAL(20,8) NOT NULL,
    "down_payment" DECIMAL(20,8) NOT NULL DEFAULT 0,
    "financed_amount" DECIMAL(20,8) NOT NULL,
    "installment_count" INTEGER NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'monthly',
    "status" "InstallmentPlanStatus" NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installment_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "installments" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "installment_no" INTEGER NOT NULL,
    "amount" DECIMAL(20,8) NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "InstallmentStatus" NOT NULL DEFAULT 'scheduled',
    "paid_at" TIMESTAMP(3),
    "payment_id" TEXT,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installment_plans_tenant_id_status_idx" ON "installment_plans"("tenant_id", "status");
CREATE INDEX "installment_plans_customer_id_idx" ON "installment_plans"("customer_id");
CREATE UNIQUE INDEX "installments_plan_id_installment_no_key" ON "installments"("plan_id", "installment_no");
CREATE INDEX "installments_status_due_at_idx" ON "installments"("status", "due_at");

-- AddForeignKey
ALTER TABLE "installments" ADD CONSTRAINT "installments_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "installment_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
