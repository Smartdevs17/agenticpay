'use client';

import { useState } from 'react';
import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Clock, AlertCircle, Filter, FileText, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { InvoiceCardSkeleton } from '@/components/ui/loading-skeletons';
import { EmptyState } from '@/components/empty/EmptyState';
import { useRouter } from 'next/navigation';

export default function InvoicesPage() {
  const router = useRouter();
  const { invoices, loading } = useDashboardData();
  const [filter, setFilter] = useState<'all' | 'paid' | 'pending' | 'overdue'>('all');

  const filteredInvoices =
    filter === 'all' ? invoices : invoices.filter((inv) => inv.status === filter);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle2 className="h-5 w-5 text-green-600" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-yellow-600" />;
      case 'overdue':
        return <AlertCircle className="h-5 w-5 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-700 border-green-200';
      case 'pending':
        return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'overdue':
        return 'bg-red-100 text-red-700 border-red-200';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-600 mt-1">View and manage your invoices</p>
          <div className="mt-2 inline-flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading invoices...
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <InvoiceCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
        <p className="text-gray-600 mt-1">View and manage your invoices</p>
      </div>

      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-gray-500" />
        <div className="flex gap-2">
          {(['all', 'paid', 'pending', 'overdue'] as const).map((status) => (
            <Button
              key={status}
              variant={filter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(status)}
              className="capitalize"
            >
              {status}
            </Button>
          ))}
        </div>
      </div>

      {filteredInvoices.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={FileText}
              title={filter === 'all' ? 'No invoices yet' : `No ${filter} invoices`}
              description={
                filter === 'all'
                  ? 'Your invoices will appear here once projects generate them.'
                  : `You don't have any ${filter} invoices at the moment.`
              }
              action={{
                label: filter === 'all' ? 'View Projects' : 'Show All Invoices',
                onClick: () => {
                  if (filter === 'all') {
                    router.push('/dashboard/projects');
                  } else {
                    setFilter('all');
                  }
                },
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredInvoices.map((invoice, index) => (
            <motion.div
              key={invoice.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Link href={`/dashboard/projects/${invoice.projectId}`}>
                <Card className="hover:shadow-lg transition-all cursor-pointer">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4 flex-1">
                        {getStatusIcon(invoice.status)}
                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900">{invoice.projectTitle}</h3>
                          <p className="text-sm text-gray-600">{invoice.milestoneTitle}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            Ref #{invoice.id} •{' '}
                            {new Date(invoice.generatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-gray-900">
                          {invoice.amount} {invoice.currency}
                        </p>
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium border mt-2 ${getStatusColor(
                            invoice.status
                          )}`}
                        >
                          {invoice.status}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}