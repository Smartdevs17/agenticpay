'use client';

import { useState } from 'react';
import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { useAuthStore } from '@/store/useAuthStore';
import { Card, CardContent } from '@/components/ui/card';
import {
  CheckCircle2,
  Clock,
  XCircle,
  ExternalLink,
  Wallet,
  QrCode,
  Loader2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { PaymentCardSkeleton } from '@/components/ui/loading-skeletons';
import { EmptyState } from '@/components/empty/EmptyState';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { PaymentQRModal } from '@/components/payment/QRCode';

export default function PaymentsPage() {
  const router = useRouter();
  const { payments, loading } = useDashboardData();
  const { address } = useAuthStore();
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-600" />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Payment History</h1>
          <p className="text-gray-600 mt-1">View all your payment transactions</p>
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Payment History</h1>
          <p className="text-gray-600 mt-1">View all your payment transactions</p>
        </div>

        {address && (
          <Button onClick={() => setIsQrModalOpen(true)} className="flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            Receive Payment
          </Button>
        )}
      </div>

      {payments.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Wallet}
              title="No payments yet"
              description="Your payment history will appear here once you receive payments for completed projects."
              action={{
                label: 'View Projects',
                onClick: () => router.push('/dashboard/projects'),
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {payments.map((payment, index) => (
            <motion.div
              key={payment.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="hover:shadow-lg transition-all">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 flex-1">
                      {getStatusIcon(payment.status)}
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">{payment.projectTitle}</h3>
                        <p className="text-sm text-gray-600">
                          {payment.type === 'milestone_payment'
                            ? 'Milestone Payment'
                            : 'Full Payment'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(payment.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xl font-bold text-gray-900">
                        {payment.amount} {payment.currency}
                      </p>
                      {payment.transactionHash && (
                        <a
                          href={`https://testnet.cronoscan.com/tx/${payment.transactionHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline mt-2 justify-end"
                        >
                          View on Explorer
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                  {payment.transactionHash && (
                    <div className="mt-4 pt-4 border-t">
                      <p className="text-xs text-gray-500 font-mono break-all">
                        {payment.transactionHash}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
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