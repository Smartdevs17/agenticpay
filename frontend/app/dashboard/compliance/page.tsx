'use client';

import React, { useEffect, useState, useCallback } from 'react';

// ─── Types (mirrors backend) ──────────────────────────────────────────────────

type JurisdictionCode = 'US' | 'EU' | 'UK' | 'SG' | 'AU' | 'GLOBAL';
type AlertStatus = 'open' | 'acknowledged' | 'resolved';
type AlertSeverity = 'info' | 'warning' | 'critical';

interface ComplianceDashboardMetrics {
  totalUsers: number;
  verifiedUsers: number;
  kycVerificationRate: number;
  amlFlags: number;
  amlFlagRate: number;
  highRiskTransactions: number;
  sanctionsHits: number;
  pepHits: number;
  openAlerts: number;
  criticalAlerts: number;
  generatedAt: string;
}

interface ComplianceMetric {
  metric: string;
  value: number;
  previousValue: number;
  changePercent: number;
  jurisdiction: JurisdictionCode;
  status: 'pass' | 'warn' | 'critical';
  timestamp: string;
}

interface JurisdictionStatus {
  jurisdiction: JurisdictionCode;
  overallStatus: 'compliant' | 'review_required' | 'non_compliant';
  kycComplianceRate: number;
  amlFlagRate: number;
  transactionVolume: number;
  highRiskCount: number;
  lastChecked: string;
}

interface ComplianceAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  message: string;
  jurisdiction: JurisdictionCode;
  triggeredAt: string;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function postJSON<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, status }: { label: string; value: string | number; sub?: string; status?: 'pass' | 'warn' | 'critical' }) {
  const borderColor = status === 'critical' ? 'border-red-500' : status === 'warn' ? 'border-yellow-500' : 'border-green-500';
  const textColor = status === 'critical' ? 'text-red-600' : status === 'warn' ? 'text-yellow-600' : 'text-green-600';

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 ${borderColor}`}>
      <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${textColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const classes: Record<AlertSeverity, string> = {
    critical: 'bg-red-100 text-red-800',
    warning: 'bg-yellow-100 text-yellow-800',
    info: 'bg-blue-100 text-blue-800',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes[severity]}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: 'compliant' | 'review_required' | 'non_compliant' | AlertStatus }) {
  const classes: Record<string, string> = {
    compliant: 'bg-green-100 text-green-800',
    review_required: 'bg-yellow-100 text-yellow-800',
    non_compliant: 'bg-red-100 text-red-800',
    open: 'bg-red-100 text-red-800',
    acknowledged: 'bg-yellow-100 text-yellow-800',
    resolved: 'bg-green-100 text-green-800',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes[status] ?? 'bg-gray-100 text-gray-800'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

// ─── Main dashboard component ─────────────────────────────────────────────────

export default function ComplianceDashboardPage() {
  const [metrics, setMetrics] = useState<ComplianceDashboardMetrics | null>(null);
  const [complianceMetrics, setComplianceMetrics] = useState<ComplianceMetric[]>([]);
  const [jurisdictions, setJurisdictions] = useState<JurisdictionStatus[]>([]);
  const [alerts, setAlerts] = useState<ComplianceAlert[]>([]);
  const [selectedJurisdiction, setSelectedJurisdiction] = useState<JurisdictionCode>('GLOBAL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [reportRequesting, setReportRequesting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [dashRes, metricsRes, jurisdRes, alertsRes] = await Promise.all([
        fetchJSON<{ data: { metrics: ComplianceDashboardMetrics } }>('/compliance/dashboard'),
        fetchJSON<{ data: ComplianceMetric[] }>(`/compliance/metrics?jurisdiction=${selectedJurisdiction}`),
        fetchJSON<{ data: JurisdictionStatus[] }>('/compliance/jurisdictions'),
        fetchJSON<{ data: ComplianceAlert[] }>('/compliance/alerts?status=open'),
      ]);

      setMetrics(dashRes.data.metrics);
      setComplianceMetrics(metricsRes.data);
      setJurisdictions(jurisdRes.data);
      setAlerts(alertsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compliance data');
    } finally {
      setLoading(false);
    }
  }, [selectedJurisdiction]);

  useEffect(() => {
    void loadData();
    // Auto-refresh every 60 seconds for real-time monitoring
    const interval = setInterval(() => void loadData(), 60_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleEvaluateThresholds = async () => {
    setEvaluating(true);
    try {
      await postJSON('/compliance/alerts/evaluate');
      await loadData();
    } finally {
      setEvaluating(false);
    }
  };

  const handleRequestReport = async () => {
    const period = new Date().toISOString().slice(0, 7); // e.g. "2026-07"
    setReportRequesting(true);
    try {
      await postJSON('/compliance/reports', { period, jurisdiction: selectedJurisdiction });
      alert(`Compliance report for ${period} (${selectedJurisdiction}) requested successfully.`);
    } finally {
      setReportRequesting(false);
    }
  };

  const handleAcknowledgeAlert = async (id: string) => {
    await postJSON(`/compliance/alerts/${id}/acknowledge`, { userId: 'current-user' });
    await loadData();
  };

  const handleExportCSV = () => {
    window.open(`${API_BASE}/compliance/export/csv?jurisdiction=${selectedJurisdiction}`, '_blank');
  };

  if (loading && !metrics) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="ml-3 text-gray-600">Loading compliance data…</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Compliance Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Real-time regulatory monitoring · Last updated: {metrics?.generatedAt ? new Date(metrics.generatedAt).toLocaleTimeString() : '—'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Jurisdiction selector */}
          <select
            value={selectedJurisdiction}
            onChange={(e) => setSelectedJurisdiction(e.target.value as JurisdictionCode)}
            className="rounded-md border border-gray-300 bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Select jurisdiction"
          >
            {(['GLOBAL', 'US', 'EU', 'UK', 'SG', 'AU'] as JurisdictionCode[]).map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>

          <button
            onClick={handleEvaluateThresholds}
            disabled={evaluating}
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Evaluate thresholds"
          >
            {evaluating ? 'Evaluating…' : 'Evaluate Thresholds'}
          </button>

          <button
            onClick={handleRequestReport}
            disabled={reportRequesting}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Generate compliance report"
          >
            {reportRequesting ? 'Requesting…' : 'Generate Report'}
          </button>

          <button
            onClick={handleExportCSV}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Export CSV"
          >
            Export CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4 border border-red-200" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* KPI cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
          <MetricCard
            label="KYC Verification Rate"
            value={`${metrics.kycVerificationRate.toFixed(1)}%`}
            sub={`${metrics.verifiedUsers.toLocaleString()} / ${metrics.totalUsers.toLocaleString()} users`}
            status={metrics.kycVerificationRate >= 90 ? 'pass' : metrics.kycVerificationRate >= 80 ? 'warn' : 'critical'}
          />
          <MetricCard
            label="AML Flag Rate"
            value={`${metrics.amlFlagRate.toFixed(2)}%`}
            sub={`${metrics.amlFlags.toLocaleString()} flags`}
            status={metrics.amlFlagRate < 1.5 ? 'pass' : metrics.amlFlagRate < 3 ? 'warn' : 'critical'}
          />
          <MetricCard
            label="High-Risk Transactions"
            value={metrics.highRiskTransactions.toLocaleString()}
            sub="Flagged for enhanced review"
            status={metrics.highRiskTransactions < 200 ? 'pass' : metrics.highRiskTransactions < 400 ? 'warn' : 'critical'}
          />
          <MetricCard
            label="Open Alerts"
            value={metrics.openAlerts}
            sub={`${metrics.criticalAlerts} critical`}
            status={metrics.criticalAlerts > 0 ? 'critical' : metrics.openAlerts > 5 ? 'warn' : 'pass'}
          />
          <MetricCard label="Sanctions Hits" value={metrics.sanctionsHits} status={metrics.sanctionsHits === 0 ? 'pass' : 'critical'} />
          <MetricCard label="PEP Hits" value={metrics.pepHits} sub="Politically Exposed Persons" status={metrics.pepHits < 5 ? 'pass' : 'warn'} />
          <MetricCard label="Total Users" value={metrics.totalUsers.toLocaleString()} />
          <MetricCard label="Verified Users" value={metrics.verifiedUsers.toLocaleString()} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Compliance metrics table */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Real-time Metrics — {selectedJurisdiction}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" aria-label="Compliance metrics">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Metric</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Value</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Change</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {complianceMetrics.map((m) => (
                  <tr key={m.metric}>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{m.metric.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{m.value.toFixed(3)}</td>
                    <td className={`px-4 py-3 text-sm text-right ${m.changePercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {m.changePercent >= 0 ? '+' : ''}{m.changePercent.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                        ${m.status === 'pass' ? 'bg-green-100 text-green-800' : m.status === 'warn' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                        {m.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {complianceMetrics.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-4 text-sm text-gray-500 text-center">No metrics available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Jurisdiction status */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Multi-Jurisdiction Status</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" aria-label="Jurisdiction compliance status">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Jurisdiction</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">KYC Rate</th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">AML Rate</th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {jurisdictions.map((j) => (
                  <tr key={j.jurisdiction}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{j.jurisdiction}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{j.kycComplianceRate.toFixed(1)}%</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{j.amlFlagRate.toFixed(2)}%</td>
                    <td className="px-4 py-3"><StatusBadge status={j.overallStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Open alerts */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">
            Open Alerts
            {alerts.length > 0 && (
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                {alerts.length}
              </span>
            )}
          </h2>
        </div>
        {alerts.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No open alerts — all thresholds within acceptable limits.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-label="Open compliance alerts">
            {alerts.map((alert) => (
              <li key={alert.id} className="px-4 py-4 flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <SeverityBadge severity={alert.severity} />
                    <span className="text-xs text-gray-500">{alert.jurisdiction}</span>
                    <span className="text-xs text-gray-400">{new Date(alert.triggeredAt).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-gray-900 dark:text-gray-100">{alert.message}</p>
                </div>
                <button
                  onClick={() => handleAcknowledgeAlert(alert.id)}
                  className="shrink-0 text-xs text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:underline"
                  aria-label={`Acknowledge alert ${alert.id}`}
                >
                  Acknowledge
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
