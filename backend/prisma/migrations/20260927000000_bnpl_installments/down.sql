-- Down migration for Issue #919 (BNPL installment plans).
DROP TABLE IF EXISTS "installments";
DROP TABLE IF EXISTS "installment_plans";
DROP TYPE IF EXISTS "InstallmentStatus";
DROP TYPE IF EXISTS "InstallmentPlanStatus";
