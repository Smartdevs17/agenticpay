'use client';

import React, { useCallback, useEffect, useState } from 'react';

// ─── Types (mirrors backend services/pci-dss.ts) ─────────────────────────────

type ControlStatus = 'in_place' | 'not_in_place' | 'not_tested' | 'not_applicable';
type RequirementStatus = 'compliant' | 'in_place_with_deficiencies' | 'non_compliant' | 'not_applicable';
type Priority = 'high' | 'medium' | 'low';

interface PciDssGap {
  controlId: string;
  controlTitle: string;
  requirementId: number;
  requirementTitle: string;
  status: Exclude<ControlStatus, 'in_place'>;
  priority: Priority;
  reference: string;
  remediation: string;
}

interface PciDssControl {
  id: string;
  title: string;
  status: ControlStatus;
  priority: Priority;
  reference: string;
}

interface PciDssRequirement {
  id: number;
  title: string;
  category: string;
  weight: number;
  status: RequirementStatus;
  compliancePercent: number;
  controls: PciDssControl[];
  gaps: PciDssGap[];
}

interface PciDssDashboard {
  version: string;
  generatedAt: string;
  overallScore: number;
  overallStatus: RequirementStatus;
  requirementStatusCounts: Record<RequirementStatus, number>;
  controlStatusCounts: Record<ControlStatus, number>;
  evidenceCoverage: number;
  requirements: PciDssRequirement[];
  gaps: PciDssGap[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

const STATUS_STYLES: Record<string, string> = {
  compliant: 'bg-green-100 text-green-800',
  in_place: 'bg-green-100 text-green-800',
  in_place_with_deficiencies: 'bg-yellow-100 text-yellow-800',
  not_tested: 'bg-gray-100 text-gray-800',
  non_compliant: 'bg-red-100 text-red-800',
  not_in_place: 'bg-red-100 text-red-800',
  not_applicable: 'bg-gray-100 text-gray-500',
};

const PRIORITY_STYLES: Record<Priority, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-800',
};

function Badge({ value }: { value: string }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[value] ?? 'bg-gray-100 text-gray-800'}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export default function PciDssDashboardPage() {
  const [dashboard, setDashboard] = useState<PciDssDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/pci-dss/dashboard`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const body = (await res.json()) as { data: PciDssDashboard };
      setDashboard(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PCI DSS dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        <span className="ml-3 text-gray-600">Loading PCI DSS dashboard…</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">PCI DSS Compliance Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            PCI DSS v{dashboard?.version} · Evidence coverage {dashboard?.evidenceCoverage ?? 0}%
          </p>
        </div>
        <button
          onClick={() => void loadData()}
          className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-sm font-medium rounded-md text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-4 border border-red-200" role="alert">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {dashboard && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-blue-500">
              <p className="text-sm text-gray-500 dark:text-gray-400">Overall Score</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">{dashboard.overallScore}%</p>
              <div className="mt-2"><Badge value={dashboard.overallStatus} /></div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-green-500">
              <p className="text-sm text-gray-500 dark:text-gray-400">Compliant Requirements</p>
              <p className="mt-1 text-2xl font-semibold text-green-600">{dashboard.requirementStatusCounts.compliant}</p>
              <p className="text-xs text-gray-400 mt-1">of {dashboard.requirements.length}</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-red-500">
              <p className="text-sm text-gray-500 dark:text-gray-400">Non-compliant</p>
              <p className="mt-1 text-2xl font-semibold text-red-600">{dashboard.requirementStatusCounts.non_compliant}</p>
              <p className="text-xs text-gray-400 mt-1">requirements</p>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 border-l-4 border-yellow-500">
              <p className="text-sm text-gray-500 dark:text-gray-400">Open Gaps</p>
              <p className="mt-1 text-2xl font-semibold text-yellow-600">{dashboard.gaps.length}</p>
              <p className="text-xs text-gray-400 mt-1">
                {dashboard.controlStatusCounts.not_in_place} not in place
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden mb-8">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Requirements</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700" aria-label="PCI DSS requirements">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">#</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Requirement</th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Compliance</th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                  {dashboard.requirements.map((requirement) => (
                    <tr key={requirement.id}>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{requirement.id}</td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{requirement.title}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                        {requirement.compliancePercent.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3"><Badge value={requirement.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-lg shadow overflow-hidden">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">Remediation Gaps</h2>
            </div>
            {dashboard.gaps.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                No open gaps — all in-scope controls are in place.
              </div>
            ) : (
              <ul className="divide-y divide-gray-200 dark:divide-gray-700" aria-label="PCI DSS gaps">
                {dashboard.gaps.map((gap) => (
                  <li key={gap.controlId} className="px-4 py-4">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLES[gap.priority]}`}>
                        {gap.priority}
                      </span>
                      <span className="text-xs text-gray-500">Req {gap.requirementId} · {gap.controlId}</span>
                      <Badge value={gap.status} />
                    </div>
                    <p className="text-sm text-gray-900 dark:text-gray-100">{gap.controlTitle}</p>
                    <p className="text-xs text-gray-500 mt-1">{gap.remediation} ({gap.reference})</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
