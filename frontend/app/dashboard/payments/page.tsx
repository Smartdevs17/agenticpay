"use client";

import { useState } from "react";
import { useDashboardData } from "@/lib/hooks/useDashboardData";
import { useAuthStore } from "@/store/useAuthStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  QrCode,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { PaymentQRModal } from "@/components/payment/QRCode";
import { PaymentCardSkeleton } from "@/components/ui/loading-skeletons";
import { EmptyState } from "@/components/empty/EmptyState";
import { TransactionList } from "@/components/transaction/TransactionList";
import { formatDateTimeInTimeZone } from "@/lib/utils";

export default function PaymentsPage() {
  const router = useRouter();
  const { payments, loading } = useDashboardData();
  const address = useAuthStore((state) => state.address);
  const timezone = useAuthStore((state) => state.timezone);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Payment History</h1>
          <p className="text-gray-600 mt-1 dark:text-gray-400">View all your payment transactions</p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading payments...
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <PaymentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Payment History</h1>
          <p className="text-gray-600 mt-1 dark:text-gray-400">
            View all your payment transactions
          </p>
        </div>
        <div className="flex items-center gap-2">
          {address && (
            <Button onClick={() => setIsQrModalOpen(true)} className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              Receive Payment
            </Button>
          )}
          <Button variant="outline" onClick={() => router.push("/dashboard/payments/qr")} className="flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            QR / NFC
          </Button>
        </div>
      </div>

      {payments.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={Wallet}
              title="No payments yet"
              description="Your payment history will appear here once you receive payments for completed projects."
              action={{
                label: "View Projects",
                onClick: () => router.push("/dashboard/projects"),
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <TransactionList
          payments={payments}
          timezone={timezone}
          formatDateTime={formatDateTimeInTimeZone}
          height={Math.min(720, Math.max(400, payments.length * 8))}
        />
      )}

      {address && (
        <PaymentQRModal
          address={address}
          isOpen={isQrModalOpen}
          onClose={() => setIsQrModalOpen(false)}
        />
      )}
    </div>
  );
}
