'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Archive, HardDrive, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ArchivalDashboard {
  lastArchiveAt: string | null;
  lastCid: string | null;
  lastSizeBytes: number;
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  chains: Array<{
    chain: string;
    lastBatchDate: string | null;
    lastCid: string | null;
    recordCount: number;
    status: string;
  }>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ArchivalDashboardPage() {
  const [data, setData] = useState<ArchivalDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/archival/dashboard`);
      if (!res.ok) throw new Error('Failed to load archival dashboard');
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDashboard();
  }, [fetchDashboard]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">On-Chain Archival</h1>
          <p className="text-muted-foreground">
            Daily IPFS backups with integrity verification and 7-year retention
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchDashboard()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title="Last Archive"
          value={data?.lastArchiveAt ? new Date(data.lastArchiveAt).toLocaleString() : 'Never'}
          icon={<Archive className="h-4 w-4 text-blue-600" />}
        />
        <SummaryCard
          title="Last Size"
          value={formatBytes(data?.lastSizeBytes ?? 0)}
          icon={<HardDrive className="h-4 w-4 text-purple-600" />}
        />
        <SummaryCard
          title="Completed Batches"
          value={data?.completedBatches ?? 0}
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
        />
        <SummaryCard
          title="Last CID"
          value={data?.lastCid ? `${data.lastCid.slice(0, 12)}…` : '—'}
          icon={<Archive className="h-4 w-4 text-amber-600" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-Chain Status</CardTitle>
          <CardDescription>
            {data?.totalBatches ?? 0} total batches · {data?.failedBatches ?? 0} failed
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {(data?.chains ?? []).map((chain) => (
              <div
                key={chain.chain}
                className="flex items-center justify-between rounded-md border p-3 text-sm"
              >
                <div>
                  <p className="font-medium capitalize">{chain.chain}</p>
                  <p className="text-xs text-muted-foreground">
                    {chain.recordCount} records · {chain.status}
                  </p>
                </div>
                <div className="text-end text-xs text-muted-foreground">
                  <p>{chain.lastBatchDate ? new Date(chain.lastBatchDate).toLocaleDateString() : '—'}</p>
                  <p className="font-mono">{chain.lastCid ? `${chain.lastCid.slice(0, 10)}…` : '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-lg font-bold truncate">{value}</div>
      </CardContent>
    </Card>
  );
}
