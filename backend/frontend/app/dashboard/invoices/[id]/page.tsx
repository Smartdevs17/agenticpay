'use client';

import { useParams } from 'next/navigation';
import { useAgenticPay } from '@/lib/hooks/useAgenticPay';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ExternalLink, Download } from 'lucide-react';
import Link from 'next/link';
import { Skeleton } from '@/components/ui/skeleton';

export default function InvoiceDetailPage() {
  const params = useParams();
  const rawId = params.id as string;
  const projectId = rawId.startsWith('INV-') ? rawId.replace('INV-', '') : rawId;

  const { useProjectDetail } = useAgenticPay();
  const { project, loading } = useProjectDetail(projectId);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64 mb-2" />
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
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-600 mb-4">Invoice not found</p>
        <Link href="/dashboard/invoices">
          <Button>Back to Invoices</Button>
        </Link>
      </div>
    );
  }

  // Construct display status
  const status = project.status === 'completed' ? 'paid' : 'pending';

  return (
    <div className="space-y-6">
      <Link href="/dashboard/invoices">
        <Button variant="ghost" className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Invoices
        </Button>
      </Link>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-start">
            <div>
              <CardTitle className="text-2xl mb-2">Invoice #{rawId}</CardTitle>
              <p className="text-gray-600">{project.title}</p>
            </div>
            <span
              className={`px-4 py-2 rounded-full text-sm font-medium ${status === 'paid'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-yellow-100 text-yellow-700'
                }`}
            >
              {status.toUpperCase()}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-sm text-gray-600 mb-1">Amount</p>
              <p className="text-2xl font-bold">
                {project.totalAmount} {project.currency}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Milestone</p>
              <p className="text-lg font-medium">Full Project</p>
            </div>
          </div>

          <div className="border-t pt-6 space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-2">Client</p>
              <p className="font-medium">{project.client.name}</p>
              <p className="text-sm text-gray-500 font-mono">{project.client.address}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">Freelancer</p>
              <p className="font-medium">{project.freelancer.name}</p>
              <p className="text-sm text-gray-500 font-mono">{project.freelancer.address}</p>
            </div>
          </div>

          <div className="border-t pt-6 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Generated</span>
              <span className="font-medium">
                {new Date(project.createdAt).toLocaleString()}
              </span>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Download PDF
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
