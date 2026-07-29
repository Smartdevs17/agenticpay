'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FileText, RadioTower, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ComplianceDashboard = {
  generatedAt: string;
  complianceScore: number;
  compliant: boolean;
  lastRunAt: string;
  checks: { total: number; passed: number; warned: number; failed: number; complianceScore: number };
  alerts: { open: number; critical: number; high: number; recent: Array<{ id: string; title: string; severity: string; status: string }> };
  regulatoryMonitoring: {
    sources: number;
    updates: number;
    recentUpdates: Array<{ id: string; title: string; jurisdiction: string; severity: string; detectedAt: string }>;
  };
  topRisks: Array<{ id: string; title: string; status: string; severity: string; evidence: string }>;
  requiredActions: string[];
};

const fallbackDashboard: ComplianceDashboard = {
  generatedAt: new Date().toISOString(),
  complianceScore: 0,
  compliant: false,
  lastRunAt: '',
  checks: { total: 0, passed: 0, warned: 0, failed: 0, complianceScore: 0 },
  alerts: { open: 0, critical: 0, high: 0, recent: [] },
  regulatoryMonitoring: { sources: 0, updates: 0, recentUpdates: [] },
  topRisks: [],
  requiredActions: ['Compliance API is not reachable from the frontend environment.'],
};

export default function ComplianceDashboardPage() {
  const [dashboard, setDashboard] = useState<ComplianceDashboard>(fallbackDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch('/api/v1/compliance/dashboard')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Compliance API returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (!mounted) return;
        setDashboard(payload.data ?? payload);
        setError(null);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setDashboard(fallbackDashboard);
        setError(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const statusTone = dashboard.compliant ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50';

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Compliance Dashboard</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Automated checks, regulatory monitoring, reporting, alerts, and audit evidence.
          </p>
        </div>
        <div className={`rounded-full px-4 py-2 text-sm font-semibold ${statusTone}`}>
          {loading ? 'Loading…' : dashboard.compliant ? 'Compliant' : 'Action required'}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard title="Compliance Score" value={`${dashboard.complianceScore}%`} icon={<ShieldCheck className="h-5 w-5 text-blue-600" />} />
        <MetricCard title="Checks Passed" value={`${dashboard.checks.passed}/${dashboard.checks.total}`} icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />} />
        <MetricCard title="Open Alerts" value={dashboard.alerts.open} icon={<AlertTriangle className="h-5 w-5 text-amber-600" />} />
        <MetricCard title="Regulatory Updates" value={dashboard.regulatoryMonitoring.updates} icon={<RadioTower className="h-5 w-5 text-purple-600" />} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Compliance Risks</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.topRisks.length === 0 ? (
              <p className="text-sm text-gray-500">No failing or warning checks in the latest run.</p>
            ) : (
              <div className="space-y-3">
                {dashboard.topRisks.map((risk) => (
                  <div key={risk.id} className="rounded-lg border border-gray-100 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-gray-900">{risk.title}</p>
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs uppercase text-gray-700">{risk.severity}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{risk.evidence}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Required Actions</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.requiredActions.length === 0 ? (
              <p className="text-sm text-gray-500">No open actions.</p>
            ) : (
              <ul className="space-y-3">
                {dashboard.requiredActions.map((action) => (
                  <li key={action} className="flex gap-3 text-sm text-gray-700">
                    <FileText className="mt-0.5 h-4 w-4 flex-none text-blue-600" />
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard.alerts.recent.length === 0 ? (
              <p className="text-sm text-gray-500">No open compliance alerts.</p>
            ) : (
              <div className="space-y-3">
                {dashboard.alerts.recent.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                    <span className="text-sm font-medium text-gray-900">{alert.title}</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-xs text-amber-700">{alert.severity}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Regulatory Monitoring</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-gray-600">
              {dashboard.regulatoryMonitoring.sources} source(s) configured. Last run:{' '}
              {dashboard.lastRunAt ? new Date(dashboard.lastRunAt).toLocaleString() : 'not run yet'}.
            </p>
            {dashboard.regulatoryMonitoring.recentUpdates.length === 0 ? (
              <p className="text-sm text-gray-500">No regulatory updates captured yet.</p>
            ) : (
              <div className="space-y-3">
                {dashboard.regulatoryMonitoring.recentUpdates.map((update) => (
                  <div key={update.id} className="rounded-lg border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-900">{update.title}</p>
                    <p className="text-xs text-gray-500">{update.jurisdiction} · {update.severity}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({ title, value, icon }: { title: string; value: string | number; icon: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-gray-900">{value}</div>
      </CardContent>
    </Card>
  );
}
