'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

interface ValidationReport {
  id: string;
  status: string;
  simulationPassed: boolean;
  smokeTestsPassed: boolean;
  adminPreserved: boolean;
  proxyAdminValid: boolean;
  implementationVerified: boolean;
  failures?: string[];
  durationMs?: number;
  createdAt: string;
}

interface UpgradeRecord {
  id: string;
  contractName: string;
  platform: string;
  network: string;
  proxyAddress: string;
  newImplementation: string;
  status: string;
  deployedAt: string | null;
  latestReport: ValidationReport | null;
  createdAt: string;
}

export default function UpgradeSafetyPage() {
  const t = useTranslations('upgradeSafety');
  const [upgrades, setUpgrades] = useState<UpgradeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/contracts/upgrade/history`);
      if (!res.ok) throw new Error('Failed to load upgrade history');
      const data = (await res.json()) as { upgrades: UpgradeRecord[] };
      setUpgrades(data.upgrades ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void fetchHistory()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <SummaryCard
          title={t('passed')}
          value={upgrades.filter((u) => u.status === 'passed').length}
          icon={<CheckCircle2 className="h-4 w-4 text-green-600" />}
        />
        <SummaryCard
          title={t('failed')}
          value={upgrades.filter((u) => u.status === 'failed').length}
          icon={<XCircle className="h-4 w-4 text-red-600" />}
        />
        <SummaryCard
          title={t('rolledBack')}
          value={upgrades.filter((u) => u.status === 'rolled_back').length}
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('history')}</CardTitle>
          <CardDescription>{t('historyDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {upgrades.length === 0 && !loading && (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          )}
          {upgrades.map((upgrade) => (
            <div key={upgrade.id} className="rounded-lg border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {upgrade.contractName} · {upgrade.network}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {upgrade.proxyAddress}
                  </p>
                </div>
                <StatusBadge status={upgrade.status} />
              </div>

              {upgrade.latestReport && (
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <Check label={t('simulation')} ok={upgrade.latestReport.simulationPassed} />
                  <Check label={t('smokeTests')} ok={upgrade.latestReport.smokeTestsPassed} />
                  <Check label={t('adminPreserved')} ok={upgrade.latestReport.adminPreserved} />
                  <Check label={t('proxyAdmin')} ok={upgrade.latestReport.proxyAdminValid} />
                  <Check label={t('implementation')} ok={upgrade.latestReport.implementationVerified} />
                </div>
              )}

              {upgrade.latestReport?.failures?.length ? (
                <ul className="text-xs text-red-600 list-disc ps-4">
                  {upgrade.latestReport.failures.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              ) : null}

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {new Date(upgrade.createdAt).toLocaleString()}
                {upgrade.latestReport?.durationMs != null && (
                  <span>· {upgrade.latestReport.durationMs}ms</span>
                )}
              </div>
            </div>
          ))}
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
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    passed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    rolled_back: 'bg-amber-100 text-amber-800',
    pending: 'bg-gray-100 text-gray-800',
    running: 'bg-blue-100 text-blue-800',
  };
  return (
    <Badge className={styles[status] ?? 'bg-gray-100 text-gray-800'} variant="outline">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function Check({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1">
      {ok ? (
        <Shield className="h-3 w-3 text-green-600" />
      ) : (
        <AlertTriangle className="h-3 w-3 text-red-600" />
      )}
      <span>{label}</span>
    </div>
  );
}
