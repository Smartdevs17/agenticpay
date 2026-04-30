'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount } from 'wagmi';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Filter,
  Loader2,
  QrCode,
  Tag,
  Wallet,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { PaymentQRModal } from '@/components/payment/QRCode';
import { EmptyState } from '@/components/empty/EmptyState';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PaymentCardSkeleton } from '@/components/ui/loading-skeletons';
import { api } from '@/lib/api';
import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { formatDateTimeInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

const categories = [
  'subscription',
  'invoice',
  'donation',
  'refund',
  'payroll',
  'software',
  'infrastructure',
  'uncategorized',
] as const;

export default function PaymentsPage() {
  const router = useRouter();
  const { payments, loading } = useDashboardData();
  const timezone = useAuthStore((state) => state.timezone);
  const storedAddress = useAuthStore((state) => state.address);
  const { address: connectedAddress } = useAccount();
  const address = connectedAddress ?? storedAddress;
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [filterCategory, setFilterCategory] = useState('all');
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});

  const getPaymentCategory = (payment: (typeof payments)[number]) =>
    categoryOverrides[payment.id] ?? payment.category ?? 'uncategorized';

  const filteredPayments = filterCategory === 'all'
    ? payments
    : payments.filter((payment) => getPaymentCategory(payment) === filterCategory);

  const handleCategoryOverride = async (paymentId: string, category: string) => {
    try {
      await api.categories.override(paymentId, category);
      setCategoryOverrides((current) => ({ ...current, [paymentId]: category }));
      toast.success('Category updated successfully');
    } catch {
      toast.error('Failed to update category');
    }
  };

  const handleExport = async () => {
    try {
      const response = await api.categories.export(payments, filterCategory);
      const blob = new Blob([response], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `payments_${filterCategory}.csv`;
      anchor.click();
      window.URL.revokeObjectURL(url);
      toast.success('Export started');
    } catch {
      toast.error('Failed to export data');
    }
  };

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
          <p className="mt-1 text-gray-600 dark:text-gray-400">View all your payment transactions</p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading payments...
          </div>
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((item) => (
            <PaymentCardSkeleton key={item} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Payment History</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">View all your payment transactions</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                {filterCategory === 'all' ? 'All Categories' : filterCategory}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setFilterCategory('all')}>
                All Categories
              </DropdownMenuItem>
              {categories.map((category) => (
                <DropdownMenuItem key={category} onClick={() => setFilterCategory(category)}>
                  {category}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" onClick={handleExport} className="flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>

          {address && (
            <Button onClick={() => setIsQrModalOpen(true)} className="flex items-center gap-2">
              <QrCode className="h-4 w-4" />
              Receive Payment
            </Button>
          )}
        </div>
      </div>

      {filteredPayments.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              icon={Wallet}
              title={filterCategory === 'all' ? 'No payments yet' : 'No payments found'}
              description={
                filterCategory === 'all'
                  ? 'Your payment history will appear here once you receive payments.'
                  : `No payments found in the "${filterCategory}" category.`
              }
              action={
                filterCategory === 'all'
                  ? { label: 'View Projects', onClick: () => router.push('/dashboard/projects') }
                  : { label: 'Clear Filter', onClick: () => setFilterCategory('all') }
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredPayments.map((payment, index) => (
            <motion.div
              key={payment.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card className="transition-all hover:shadow-lg">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex flex-1 items-center gap-4">
                      {getStatusIcon(payment.status)}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{payment.projectTitle}</h3>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button type="button" className="focus:outline-none">
                                <Badge variant="secondary" className="cursor-pointer gap-1 hover:bg-gray-200">
                                  <Tag className="h-3 w-3" />
                                  {getPaymentCategory(payment)}
                                </Badge>
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              {categories.map((category) => (
                                <DropdownMenuItem
                                  key={category}
                                  onClick={() => handleCategoryOverride(payment.id, category)}
                                >
                                  {category}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                        <p className="text-sm text-gray-600">
                          {payment.type === 'milestone_payment' ? 'Milestone Payment' : 'Full Payment'}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {formatDateTimeInTimeZone(payment.timestamp, timezone)}
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
                          className="mt-2 flex items-center justify-end gap-1 text-xs text-blue-600 hover:underline"
                        >
                          View on Explorer
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>

                  {payment.transactionHash && (
                    <div className="mt-4 border-t pt-4">
                      <p className="break-all font-mono text-xs text-gray-500">{payment.transactionHash}</p>
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
