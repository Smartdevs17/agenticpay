'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface BridgeHealth {
  totalMessages: number;
  successRate: number;
  averageLatencyMs: number;
  stuckCount: number;
  pendingAlerts: number;
  byProvider: Record<string, number>;
  byStatus: Record<string, number>;
}

interface ProviderStats {
  provider: string;
  volume: number;
  successRate: number;
  averageLatencyMs: number;
}

interface BridgeAnalytics {
  volume: number;
  successRate: number;
  averageLatencyMs: number;
  byProvider: ProviderStats[];
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export default function BridgeMonitoringPage() {
  const t = useTranslations('bridgeMonitor');
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [analytics, setAnalytics] = useState<BridgeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthRes, analyticsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/bridge/monitor/health`),
        fetch(`${API_BASE}/api/v1/bridge/monitor/analytics?days=30`),
      ]);

      if (!healthRes.ok || !analyticsRes.ok) {
        throw new Error('Failed to load bridge monitoring data');
      }

      setHealth(await healthRes.json());
      setAnalytics(await analyticsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title={t('totalMessages')}
          value={health?.totalMessages ?? 0}
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
        />
        <MetricCard
          title={t('successRate')}
          value={formatPercent(health?.successRate ?? 0)}
          icon={<CheckCircle2 className="h-4 w-4 text-blue-600" />}
        />
        <MetricCard
          title={t('avgLatency')}
          value={formatLatency(health?.averageLatencyMs ?? 0)}
          icon={<Clock className="h-4 w-4 text-amber-600" />}
        />
        <MetricCard
          title={t('stuckMessages')}
          value={health?.stuckCount ?? 0}
          icon={<AlertTriangle className="h-4 w-4 text-red-600" />}
          highlight={(health?.stuckCount ?? 0) > 0}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('byProvider')}</CardTitle>
            <CardDescription>{t('health')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(analytics?.byProvider ?? []).map((provider) => (
                <div
                  key={provider.provider}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="font-medium capitalize">{provider.provider}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('volume')}: {provider.volume} · {t('successRate')}:{' '}
                      {formatPercent(provider.successRate)}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {formatLatency(provider.averageLatencyMs)}
                  </span>
                </div>
              ))}
              {!analytics?.byProvider?.length && !loading && (
                <p className="text-sm text-muted-foreground">No bridge activity recorded yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('pendingAlerts')}</CardTitle>
            <CardDescription>
              {health?.pendingAlerts ?? 0} unacknowledged alert(s)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {health?.byStatus && Object.keys(health.byStatus).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(health.byStatus).map(([status, count]) => (
                  <div key={status} className="flex justify-between text-sm">
                    <span className="capitalize">{status.replace(/_/g, ' ')}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No status breakdown available.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  icon,
  highlight = false,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? 'border-red-300' : undefined}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
