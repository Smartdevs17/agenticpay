'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Filter,
  FileText,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { InvoiceCardSkeleton } from '@/components/ui/loading-skeletons';
import { EmptyState } from '@/components/empty/EmptyState';
import { formatDateInTimeZone } from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

export default function InvoicesPage() {
  const router = useRouter();
  const { invoices, loading } = useDashboardData();
  const timezone = useAuthStore((state) => state.timezone);
  const [filter, setFilter] = useState<'all' | 'paid' | 'pending' | 'overdue'>('all');

  const filteredInvoices =
    filter === 'all'
      ? invoices
      : invoices.filter((inv) => inv.status === filter);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'paid':
        return <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />;
      case 'pending':
        return <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />;
      case 'overdue':
        return <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800/50';
      case 'pending':
        return 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/50';
      case 'overdue':
        return 'bg-red-100 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/50';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
    }
  };

  if (loading) {
    return (

      <div className="space-y-6 px-1">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading your financial documents...</p>
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />

      <div className="space-y-6">
        <div>
          <p className="text-gray-600 mt-1 dark:text-gray-400">
            View and manage your invoices
          </p>
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

    <div className="space-y-6 max-w-5xl mx-auto px-1 sm:px-0">
      {/* Filters Section */}
      <div className="bg-white dark:bg-gray-900/50 p-2 rounded-2xl border border-gray-200 dark:border-gray-800 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-2 px-2 border-r border-gray-100 dark:border-gray-800 hidden sm:flex">
          <Filter className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">Status</span>
        </div>
        
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1 sm:pb-0">

    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="text-gray-600 mt-1 dark:text-gray-400">
          View and manage your invoices
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
        <Filter className="h-4 w-4 text-gray-500 flex-shrink-0" />
        <div className="flex gap-2">

          {(['all', 'paid', 'pending', 'overdue'] as const).map(
            (status) => (
              <button
                key={status}
                onClick={() => setFilter(status)}

                className={`
                  px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all active:scale-95 touch-manipulation whitespace-nowrap
                  ${filter === status 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-800'}
                `}

                className="capitalize whitespace-nowrap"

              >
                {status}
              </button>
            )
          )}
        </div>
      </div>

      {/* Content List */}
      <div className="grid grid-cols-1 gap-4">

        <AnimatePresence mode="popLayout">
          {filteredInvoices.length === 0 ? (

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
                          Ref #{invoice.id} • {formatDateInTimeZone(invoice.generatedAt, timezone)}
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

      {filteredInvoices.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={FileText}
              title={
                filter === 'all'
                  ? 'No invoices yet'
                  : `No ${filter} invoices`
              }
              description={
                filter === 'all'
                  ? 'Your invoices will appear here once projects generate them.'
                  : `You don't have any ${filter} invoices at the moment.`
              }
              action={{
                label:
                  filter === 'all'
                    ? 'View Projects'
                    : 'Show All Invoices',
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
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key="empty"
            >
              <Card className="border-dashed border-gray-200 dark:border-gray-800">
                <CardContent className="p-0">
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
            </motion.div>
          ) : (
            filteredInvoices.map((invoice, index) => (
              <motion.div
                key={invoice.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ delay: index * 0.04 }}
                layout
              >

                <Link href={`/dashboard/projects/${invoice.projectId}`}>
                  <Card className="group hover:border-blue-500/50 hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300 cursor-pointer active:scale-[0.99] touch-manipulation">
                    <CardContent className="p-5 sm:p-6">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                        <div className="flex items-start gap-4 flex-1">
                          <div className={`mt-1 p-2.5 rounded-xl border ${getStatusColor(invoice.status)}`}>
                            {getStatusIcon(invoice.status)}
                          </div>

                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-gray-900 dark:text-gray-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                              {invoice.projectTitle}
                            </h3>
                            <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5 line-clamp-1">
                              {invoice.milestoneTitle}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-[10px] sm:text-xs font-medium text-gray-400 dark:text-gray-500">
                              <span className="font-mono">Ref: #{invoice.id.slice(0, 8)}</span>
                              <span className="w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-700 hidden sm:block"></span>
                              <span>{formatDateInTimeZone(invoice.generatedAt, timezone)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 border-t sm:border-none pt-4 sm:pt-0 border-gray-50 dark:border-gray-800/50">
                          <div className="flex flex-col sm:items-end">
                            <p className="text-lg sm:text-2xl font-black text-gray-900 dark:text-gray-100 tracking-tight">
                              {invoice.amount} <span className="text-sm font-bold text-blue-600 dark:text-blue-400">{invoice.currency}</span>
                            </p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${getStatusColor(
                                invoice.status
                              )}`}
                            >
                              {invoice.status}
                            </span>
                            <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all sm:hidden">
                              <ArrowRight className="h-4 w-4" />
                            </div>
                          </div>
                        </div>
                <Card className="hover:shadow-lg transition-all cursor-pointer">
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="flex items-center gap-4 flex-1">
                        {getStatusIcon(invoice.status)}

                        <div className="flex-1">
                          <h3 className="font-semibold text-gray-900 dark:text-gray-100">
                            {invoice.projectTitle}
                          </h3>

                          <p className="text-sm text-gray-600 dark:text-gray-400">
                            {invoice.milestoneTitle}
                          </p>

                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                            Ref #{invoice.id} •{' '}
                            {formatDateInTimeZone(
                              invoice.generatedAt,
                              timezone
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="text-left sm:text-right flex items-center sm:block justify-between sm:justify-end gap-2">
                        <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                          {invoice.amount} {invoice.currency}
                        </p>

                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium border sm:mt-2 ${getStatusColor(
                            invoice.status
                          )}`}
                        >
                          {invoice.status.toUpperCase()}
                        </span>

                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
