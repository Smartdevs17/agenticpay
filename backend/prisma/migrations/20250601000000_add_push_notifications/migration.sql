-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM (
    'payment_notification',
    'dispute_alert',
    'project_update',
    'milestone_reminder',
    'security_alert',
    'subscription_update',
    'system_notification'
);

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM (
    'pending',
    'sent',
    'delivered',
    'clicked',
    'failed'
);

-- CreateTable "push_subscriptions"
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "user_agent" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable "push_preferences"
CREATE TABLE "push_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "payment_notifications" BOOLEAN NOT NULL DEFAULT true,
    "dispute_alerts" BOOLEAN NOT NULL DEFAULT true,
    "project_updates" BOOLEAN NOT NULL DEFAULT true,
    "milestone_reminders" BOOLEAN NOT NULL DEFAULT true,
    "security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "subscription_updates" BOOLEAN NOT NULL DEFAULT true,
    "system_notifications" BOOLEAN NOT NULL DEFAULT true,
    "group_notifications" BOOLEAN NOT NULL DEFAULT true,
    "notify_sound" BOOLEAN NOT NULL DEFAULT true,
    "notify_badge" BOOLEAN NOT NULL DEFAULT true,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable "notification_logs"
CREATE TABLE "notification_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "category" "NotificationCategory" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "icon" TEXT,
    "badge" TEXT,
    "tag" TEXT,
    "data" JSONB,
    "deep_link" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_tenant_id_user_id_endpoint_key" ON "push_subscriptions"("tenant_id", "user_id", "endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_tenant_id_user_id_idx" ON "push_subscriptions"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "push_subscriptions_endpoint_idx" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_is_active_idx" ON "push_subscriptions"("is_active");

-- CreateIndex
CREATE INDEX "push_subscriptions_created_at_idx" ON "push_subscriptions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "push_preferences_tenant_id_user_id_key" ON "push_preferences"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "push_preferences_tenant_id_idx" ON "push_preferences"("tenant_id");

-- CreateIndex
CREATE INDEX "push_preferences_user_id_idx" ON "push_preferences"("user_id");

-- CreateIndex
CREATE INDEX "notification_logs_tenant_id_user_id_idx" ON "notification_logs"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_idx" ON "notification_logs"("status");

-- CreateIndex
CREATE INDEX "notification_logs_category_idx" ON "notification_logs"("category");

-- CreateIndex
CREATE INDEX "notification_logs_subscription_id_idx" ON "notification_logs"("subscription_id");

-- CreateIndex
CREATE INDEX "notification_logs_sent_at_idx" ON "notification_logs"("sent_at");

-- CreateIndex
CREATE INDEX "notification_logs_tag_idx" ON "notification_logs"("tag");

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "push_subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
