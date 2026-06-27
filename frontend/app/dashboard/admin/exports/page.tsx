'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Download, FileText, Loader2, RefreshCw, StopCircle, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiCall } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';

interface ExportJob {
  id: string;
  format: 'csv' | 'jsonl';
  status: 'running' | 'completed' | 'cancelled' | 'error';
  rowsProcessed: number;
  totalEstimate?: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  progress?: number;
}

type ExportResource = 'audit' | 'payments';
type ExportFormat = 'csv' | 'jsonl';

const STATUS_STYLES: Record<string, string> = {
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-gray-100 text-gray-800',
  error: 'bg-red-100 text-red-800',
};

export default function AdminExportsPage() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [resource, setResource] = useState<ExportResource>('audit');
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [rowLimit, setRowLimit] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const result = await apiCall<{ jobs: ExportJob[]; activeCount: number }>('/exports/jobs/list', { method: 'GET' });
      setJobs(result.jobs);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
    const interval = setInterval(loadJobs, 5_000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const startExport = async () => {
    setDownloading('starting');
    abortRef.current = new AbortController();

    try {
      const params = new URLSearchParams();
      params.set('format', format);
      if (dateFrom) params.set('startDate', String(new Date(dateFrom).getTime()));
      if (dateTo) params.set('endDate', String(new Date(dateTo).getTime()));
      if (rowLimit) params.set('limit', rowLimit);

      const url = `/api/v1/exports/${resource}/stream?${params}`;

      const response = await fetch(url, {
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Export failed: ${response.statusText}`);
      }

      const exportId = response.headers.get('X-Export-Id');
      if (exportId) {
        setDownloading(exportId);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.length;
      }

      const blob = new Blob(chunks);
      const ext = format === 'csv' ? 'csv' : 'jsonl';
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${resource}-export-${Date.now()}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

      toast.success(`Export complete: ${(totalBytes / 1024).toFixed(1)} KB downloaded`);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        toast.info('Export cancelled');
      } else {
        console.error(error);
        toast.error('Export failed');
      }
    } finally {
      setDownloading(null);
      abortRef.current = null;
      void loadJobs();
    }
  };

  const cancelDownload = () => {
    abortRef.current?.abort();
  };

  const cancelServerExport = async (exportId: string) => {
    try {
      await apiCall(`/exports/${exportId}`, { method: 'DELETE' });
      toast.success('Export cancelled');
      void loadJobs();
    } catch (error) {
      console.error(error);
      toast.error('Failed to cancel export');
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950 dark:text-white">Streaming Exports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Export large datasets without memory constraints using streaming downloads.
          </p>
        </div>
        <Button variant="outline" onClick={loadJobs} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Export Form */}
      <div className="rounded-md border border-gray-200 p-4 dark:border-gray-800">
        <h2 className="mb-4 text-base font-medium">New Export</h2>
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="resource">Resource</Label>
            <select
              id="resource"
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950"
              value={resource}
              onChange={(e) => setResource(e.target.value as ExportResource)}
            >
              <option value="audit">Audit Logs</option>
              <option value="payments">Payments</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="format">Format</Label>
            <select
              id="format"
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-sm dark:border-gray-800 dark:bg-gray-950"
              value={format}
              onChange={(e) => setFormat(e.target.value as ExportFormat)}
            >
              <option value="csv">CSV</option>
              <option value="jsonl">JSON Lines</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dateFrom">From</Label>
            <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dateTo">To</Label>
            <Input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <div className="flex gap-2">
            {downloading ? (
              <Button variant="destructive" onClick={cancelDownload}>
                <StopCircle className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            ) : (
              <Button onClick={startExport}>
                <Download className="mr-2 h-4 w-4" />
                Export
              </Button>
            )}
          </div>
        </div>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rowLimit">Row Limit (optional)</Label>
            <Input
              id="rowLimit"
              type="number"
              value={rowLimit}
              onChange={(e) => setRowLimit(e.target.value)}
              placeholder="Leave empty for all rows"
            />
          </div>
        </div>

        {downloading && (
          <div className="mt-4 flex items-center gap-3 rounded-md bg-blue-50 p-3 dark:bg-blue-950/30">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <span className="text-sm text-blue-800 dark:text-blue-200">
              Downloading... Streaming data from server.
            </span>
          </div>
        )}
      </div>

      {/* Export Jobs */}
      <div>
        <h2 className="mb-3 text-base font-medium">Recent Exports</h2>
        <div className="overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-gray-50 text-left text-gray-600 dark:bg-gray-900 dark:text-gray-300">
              <tr>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Format</th>
                <th className="px-4 py-3 font-medium">Rows</th>
                <th className="px-4 py-3 font-medium">Started</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-gray-200 dark:border-gray-800">
                  <td className="px-4 py-3">
                    <Badge className={STATUS_STYLES[job.status]}>
                      {job.status === 'running' && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                      {job.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant="outline">
                      <FileText className="mr-1 h-3 w-3" />
                      {job.format.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">{job.rowsProcessed.toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs">{new Date(job.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs">
                    {job.completedAt
                      ? `${((job.completedAt - job.startedAt) / 1000).toFixed(1)}s`
                      : 'In progress'}
                  </td>
                  <td className="px-4 py-3">
                    {job.status === 'running' && (
                      <Button size="sm" variant="ghost" onClick={() => cancelServerExport(job.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobs.length === 0 && (
            <div className="py-10 text-center text-sm text-muted-foreground">No export jobs</div>
          )}
        </div>
      </div>
    </div>
  );
}
