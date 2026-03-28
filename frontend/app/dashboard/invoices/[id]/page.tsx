'use client';

import { useParams } from 'next/navigation';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Download } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
} from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

export default function InvoiceDetailPage() {
  const params = useParams();
  const rawId = params.id as string;
  const projectId = rawId.startsWith('INV-') ? rawId.replace('INV-', '') : rawId;
  const timezone = useAuthStore((state) => state.timezone);

  const { useProjectDetail } = useAgenticPay();
  const { project, loading } = useProjectDetail(projectId);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Card>
          <CardHeader>
            <Skeleton className="mb-2 h-8 w-64" />
          </CardHeader>
          <CardContent className="space-y-6">
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!project || (!project.invoiceUri && project.status !== 'completed')) {
    return (
      <div className="flex h-64 flex-col items-center justify-center">
        <p className="mb-4 text-gray-600">Invoice not found</p>
        <Link href="/dashboard/invoices">
          <Button>Back to Invoices</Button>
        </Link>
      </div>
    );
  }

  const status = project.status === 'completed' ? 'paid' : 'pending';
  const generatedAt = new Date(project.createdAt);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6 invoice-print-page">
      <PageBreadcrumb
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Invoices', href: '/dashboard/invoices' },
        ]}
        currentPage={`Invoice ${rawId}`}
      />

      <Link href="/dashboard/invoices" className="no-print inline-flex">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Invoices
        </Button>
      </Link>

      <Card className="invoice-print-card overflow-hidden border border-slate-200 shadow-sm">
        <CardHeader className="space-y-6 border-b border-slate-200 bg-slate-50/60">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
                AgenticPay Invoice
              </p>
              <CardTitle className="mb-2 mt-2 text-2xl">Invoice #{rawId}</CardTitle>
              <p className="text-gray-600">{project.title}</p>
            </div>
            <span
              className={`inline-flex w-fit rounded-full px-4 py-2 text-sm font-medium ${
                status === 'paid'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
              }`}
            >
              {status.toUpperCase()}
            </span>
          </div>

          <div className="grid gap-4 text-sm text-slate-600 sm:grid-cols-3">
            <div className="print-break-inside-avoid rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Generated
              </p>
              <p className="mt-2 font-medium text-slate-900">
                {formatDateInTimeZone(generatedAt, timezone)}
              </p>
              <p className="text-xs text-slate-500">{formatTimeInTimeZone(generatedAt, timezone)}</p>
            </div>
            <div className="print-break-inside-avoid rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Invoice Status
              </p>
              <p className="mt-2 font-medium text-slate-900">{status.toUpperCase()}</p>
            </div>
            <div className="print-break-inside-avoid rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Milestone
              </p>
              <p className="mt-2 font-medium text-slate-900">Full Project</p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8 p-6 sm:p-8">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="print-break-inside-avoid rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:col-span-2">
              <p className="mb-1 text-sm text-gray-600">Amount Due</p>
              <p className="text-3xl font-bold tracking-tight text-slate-900">
                {project.totalAmount} {project.currency}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                Payment for the completed work recorded in AgenticPay.
              </p>
            </div>
            <div className="print-break-inside-avoid rounded-2xl border border-slate-200 p-5">
              <p className="mb-1 text-sm text-gray-600">Invoice ID</p>
              <p className="text-lg font-semibold text-slate-900">{rawId}</p>
            </div>
          </div>

          <div className="grid gap-6 border-t border-slate-200 pt-8 md:grid-cols-2">
            <div className="print-break-inside-avoid rounded-2xl border border-slate-200 p-5">
              <p className="mb-2 text-sm text-gray-600">Bill From</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Client
              </p>
              <p className="mt-3 font-medium">{project.client.name}</p>
              <p className="break-all font-mono text-sm text-gray-500">
                {project.client.address}
              </p>
            </div>
            <div className="print-break-inside-avoid rounded-2xl border border-slate-200 p-5">
              <p className="mb-2 text-sm text-gray-600">Bill To</p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Freelancer
              </p>
              <p className="mt-3 font-medium">{project.freelancer.name}</p>
              <p className="break-all font-mono text-sm text-gray-500">
                {project.freelancer.address}
              </p>
            </div>
          </div>

          <div className="print-break-inside-avoid rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">Invoice Summary</h2>
            </div>
            <div className="divide-y divide-slate-200">
              <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                <span className="text-slate-600">Project</span>
                <span className="text-right font-medium text-slate-900">{project.title}</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                <span className="text-slate-600">Generated</span>
                <span className="text-right font-medium text-slate-900">
                  {formatDateTimeInTimeZone(generatedAt, timezone)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                <span className="text-slate-600">Work Scope</span>
                <span className="text-right font-medium text-slate-900">Full Project</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-5 py-4 text-base">
                <span className="font-semibold text-slate-900">Total Due</span>
                <span className="text-right text-xl font-semibold text-slate-900">
                  {project.totalAmount} {project.currency}
                </span>
              </div>
            </div>
          </div>

          <div className="print-break-inside-avoid rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-4 text-sm text-slate-600">
            This invoice was generated from AgenticPay project data and is formatted
            for on-screen review and browser printing.
          </div>

          <div className="no-print flex gap-3 pt-2">
            <Button variant="outline" onClick={handlePrint}>
              <Download className="mr-2 h-4 w-4" />
              Print Invoice
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
