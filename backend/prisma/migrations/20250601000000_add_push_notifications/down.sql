-- DropForeignKey
ALTER TABLE "notification_logs" DROP CONSTRAINT "notification_logs_subscription_id_fkey";

-- DropTable
DROP TABLE "notification_logs";

-- DropTable
DROP TABLE "push_preferences";

-- DropTable
DROP TABLE "push_subscriptions";

-- DropEnum
DROP TYPE "NotificationStatus";

-- DropEnum
DROP TYPE "NotificationCategory";
