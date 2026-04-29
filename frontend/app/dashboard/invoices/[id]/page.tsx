'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Download, Pencil, X, Check, History, PenLine } from 'lucide-react';
import { PageBreadcrumb } from '@/components/layout/PageBreadcrumb';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';
import {
  formatDateInTimeZone,
  formatDateTimeInTimeZone,
  formatTimeInTimeZone,
} from '@/lib/utils';
import { useAuthStore } from '@/store/useAuthStore';

interface InvoiceVersion {
  timestamp: string;
  workDescription: string;
  hoursWorked: number;
  hourlyRate: number;
  calculatedAmount: number;
  signedAt: string;
}

export default function InvoiceDetailPage() {
  const params = useParams();
  const rawId = params.id as string;
  const projectId = rawId.startsWith('INV-') ? rawId.replace('INV-', '') : rawId;
  const timezone = useAuthStore((state) => state.timezone);

  const { useProjectDetail } = useAgenticPay();
  const { project, loading } = useProjectDetail(projectId);

  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [requiresSignature, setRequiresSignature] = useState(false);
  const [isSigned, setIsSigned] = useState(false);
  const [versionHistory, setVersionHistory] = useState<InvoiceVersion[]>([]);

  const [editedValues, setEditedValues] = useState({
    workDescription: 'Verified work',
    hoursWorked: 0,
    hourlyRate: 0,
  });

  const calculatedAmount =
    editedValues.hoursWorked > 0 && editedValues.hourlyRate > 0
      ? editedValues.hoursWorked * editedValues.hourlyRate
      : null;

  useEffect(() => {
    if (!rawId) return;
    try {
      const stored = localStorage.getItem(`invoice-history-${rawId}`);
      if (stored) setVersionHistory(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, [rawId]);

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

  const handlePrint = () => window.print();

  const handleSaveEdits = () => {
    setIsEditing(false);
    setRequiresSignature(true);
    setIsSigned(false);
  };

  const handleSign = () => {
    const newVersion: InvoiceVersion = {
      timestamp: new Date().toISOString(),
      workDescription: editedValues.workDescription,
      hoursWorked: editedValues.hoursWorked,
      hourlyRate: editedValues.hourlyRate,
      calculatedAmount: calculatedAmount ?? Number(project.totalAmount),
      signedAt: new Date().toLocaleString(),
    };

    const updated = [newVersion, ...versionHistory];
    setVersionHistory(updated);
    localStorage.setItem(`invoice-history-${rawId}`, JSON.stringify(updated));
    setRequiresSignature(false);
    setIsSigned(true);
  };

  const displayAmount = isSigned && calculatedAmount
    ? calculatedAmount
    : project.totalAmount;

  return (
    <div className="invoice-print-page space-y-6">
      <div className="no-print flex items-center justify-between">
        <Link href="/dashboard/invoices" className="inline-flex">
          <Button variant="ghost" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Invoices
          </Button>
        </Link>
        <div className="flex gap-2 mb-4">
          <Button variant="outline" onClick={() => setShowHistory(!showHistory)}>
            <History className="mr-2 h-4 w-4" />
            Version History ({versionHistory.length})
          </Button>
          {!isEditing && !requiresSignature && (
            <Button onClick={() => setIsEditing(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit Invoice
            </Button>
          )}
        </div>
      </div>

      {showHistory && (
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-base text-blue-800">Version History</CardTitle>
          </CardHeader>
          <CardContent>
            {versionHistory.length === 0 ? (
              <p className="text-sm text-blue-600">No previous versions yet.</p>
            ) : (
              <div className="space-y-3">
                {versionHistory.map((version, index) => (
                  <div key={index} className="rounded-lg border border-blue-200 bg-white p-4 text-sm">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-700">
                        Version {versionHistory.length - index}
                      </span>
                      <span className="text-slate-500">{version.signedAt}</span>
                    </div>
                    <p className="mt-1 text-slate-600">Description: {version.workDescription}</p>
                    <p className="text-slate-600">
                      Hours: {version.hoursWorked} x Rate: {version.hourlyRate} ={' '}
                      <strong>{version.calculatedAmount}</strong>
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {requiresSignature && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <PenLine className="h-5 w-5 text-yellow-700" />
              <div>
                <p className="font-semibold text-yellow-800">Re-signature Required</p>
                <p className="text-sm text-yellow-700">
                  Invoice was edited. Please confirm and sign to apply changes.
                </p>
              </div>
            </div>
            <Button onClick={handleSign} className="bg-yellow-600 hover:bg-yellow-700">
              <Check className="mr-2 h-4 w-4" />
              Confirm and Sign
            </Button>
          </CardContent>
        </Card>
      )}

      {isEditing && (
        <Card className="border-slate-300">
          <CardHeader>
            <CardTitle className="text-base">Edit Invoice Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>Work Description</Label>
              <Input
                className="mt-1"
                value={editedValues.workDescription}
                onChange={(e) =>
                  setEditedValues({ ...editedValues, workDescription: e.target.value })
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Hours Worked</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  value={editedValues.hoursWorked}
                  onChange={(e) =>
                    setEditedValues({ ...editedValues, hoursWorked: Number(e.target.value) })
                  }
                />
              </div>
              <div>
                <Label>Hourly Rate ({project.currency})</Label>
                <Input
                  className="mt-1"
                  type="number"
                  min="0"
                  value={editedValues.hourlyRate}
                  onChange={(e) =>
                    setEditedValues({ ...editedValues, hourlyRate: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            {calculatedAmount !== null && (
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-sm text-slate-600">Recalculated Amount</p>
                <p className="text-2xl font-bold text-slate-900">
                  {calculatedAmount} {project.currency}
                </p>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveEdits}>
                <Check className="mr-2 h-4 w-4" />
                Save Changes
              </Button>
              <Button variant="ghost" onClick={() => setIsEditing(false)}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

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
                {displayAmount} {project.currency}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {isSigned && calculatedAmount
                  ? editedValues.workDescription
                  : 'Payment for the completed work recorded in AgenticPay.'}
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
                <span className="text-right font-medium text-slate-900">
                  {isSigned && editedValues.workDescription
                    ? editedValues.workDescription
                    : 'Full Project'}
                </span>
              </div>
              {isSigned && editedValues.hoursWorked > 0 && (
                <>
                  <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                    <span className="text-slate-600">Hours Worked</span>
                    <span className="text-right font-medium text-slate-900">
                      {editedValues.hoursWorked}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-4 px-5 py-4 text-sm">
                    <span className="text-slate-600">Hourly Rate</span>
                    <span className="text-right font-medium text-slate-900">
                      {editedValues.hourlyRate} {project.currency}
                    </span>
                  </div>
                </>
              )}
              <div className="flex items-center justify-between gap-4 px-5 py-4 text-base">
                <span className="font-semibold text-slate-900">Total Due</span>
                <span className="text-right text-xl font-semibold text-slate-900">
                  {displayAmount} {project.currency}
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