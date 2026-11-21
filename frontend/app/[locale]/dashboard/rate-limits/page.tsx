'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts';
import { Activity, AlertTriangle, CheckCircle2, ShieldAlert, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types (mirror backend response shapes)
// ---------------------------------------------------------------------------

interface RateLimitSummary {
  windowMs: number;
  total: number;
  blocked: number;
  allowRate: number;
  byTier: Record<string, { total: number; blocked: number }>;
  byEndpoint: Record<string, { total: number; blocked: number }>;
}

interface TopBlockedEntry {
  key: string;
  tier: string;
  count: number;
}

interface TrendBucket {
  timestamp: string;
  total: number;
  blocked: number;
  allowed: number;
}

interface PerKeyEntry {
  key: string;
  tier: string;
  total: number;
  blocked: number;
  allowRate: number;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

const BASE = '/api/v1/rate-limit';

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const TIER_COLORS: Record<string, string> = {
  free: '#64748b',
  pro: '#3b82f6',
  enterprise: '#8b5cf6',
};

export default function RateLimitsPage() {
  const [summary, setSummary] = useState<RateLimitSummary | null>(null);
  const [topBlocked, setTopBlocked] = useState<TopBlockedEntry[]>([]);
  const [trends, setTrends] = useState<TrendBucket[]>([]);
  const [perKey, setPerKey] = useState<PerKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowMs, setWindowMs] = useState(60_000);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, tb, tr, pk] = await Promise.all([
        fetchJSON<RateLimitSummary>(`${BASE}/analytics?windowMs=${windowMs}`),
        fetchJSON<TopBlockedEntry[]>(`${BASE}/analytics/top-blocked?windowMs=${windowMs}&limit=10`),
        fetchJSON<TrendBucket[]>(`${BASE}/analytics/trends?windowMs=${windowMs}&buckets=12`),
        fetchJSON<PerKeyEntry[]>(`${BASE}/analytics/per-key?windowMs=${windowMs}&limit=20`),
      ]);
      setSummary(s);
      setTopBlocked(tb);
      setTrends(tr);
      setPerKey(pk);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rate-limit data');
    } finally {
      setLoading(false);
    }
  }, [windowMs]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const tierRows = summary
    ? Object.entries(summary.byTier).map(([tier, counts]) => ({
        tier,
        ...counts,
        blockRate: counts.total > 0 ? ((counts.blocked / counts.total) * 100).toFixed(1) : '0.0',
      }))
    : [];

  const endpointRows = summary
    ? Object.entries(summary.byEndpoint).map(([endpoint, counts]) => ({
        endpoint,
        ...counts,
      }))
    : [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Rate Limit Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Per-tenant usage, block rates, and sustained-overuse detection
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={windowMs}
            onChange={(e) => setWindowMs(Number(e.target.value))}
            className="text-sm border rounded-md px-2 py-1 bg-white dark:bg-gray-800 dark:border-gray-700"
          >
            <option value={60_000}>Last 1 min</option>
            <option value={5 * 60_000}>Last 5 min</option>
            <option value={15 * 60_000}>Last 15 min</option>
            <option value={60 * 60_000}>Last 1 hour</option>
          </select>

          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={<Activity className="h-5 w-5 text-blue-500" />}
            label="Total Requests"
            value={summary.total.toLocaleString()}
          />
          <StatCard
            icon={<CheckCircle2 className="h-5 w-5 text-green-500" />}
            label="Allow Rate"
            value={`${(summary.allowRate * 100).toFixed(1)}%`}
          />
          <StatCard
            icon={<AlertTriangle className="h-5 w-5 text-amber-500" />}
            label="Blocked"
            value={summary.blocked.toLocaleString()}
          />
          <StatCard
            icon={<ShieldAlert className="h-5 w-5 text-red-500" />}
            label="Block Rate"
            value={`${summary.total > 0 ? ((summary.blocked / summary.total) * 100).toFixed(1) : 0}%`}
          />
        </div>
      )}

      {/* Trends chart */}
      {trends.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  labelFormatter={(v) => new Date(v as string).toLocaleTimeString()}
                />
                <Legend />
                <Line type="monotone" dataKey="allowed" stroke="#22c55e" strokeWidth={2} dot={false} name="Allowed" />
                <Line type="monotone" dataKey="blocked" stroke="#ef4444" strokeWidth={2} dot={false} name="Blocked" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By tier */}
        {tierRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">By Tier</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={tierRows}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                  <XAxis dataKey="tier" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="total" name="Total" fill="#3b82f6" />
                  <Bar dataKey="blocked" name="Blocked" fill="#ef4444" />
                </BarChart>
              </ResponsiveContainer>

              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <th className="pb-2 font-medium">Tier</th>
                    <th className="pb-2 font-medium text-right">Total</th>
                    <th className="pb-2 font-medium text-right">Blocked</th>
                    <th className="pb-2 font-medium text-right">Block %</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map((row) => (
                    <tr key={row.tier} className="border-b dark:border-gray-800 last:border-0">
                      <td className="py-2 capitalize">
                        <span
                          className="inline-block w-2 h-2 rounded-full mr-2"
                          style={{ background: TIER_COLORS[row.tier] ?? '#9ca3af' }}
                        />
                        {row.tier}
                      </td>
                      <td className="py-2 text-right">{row.total}</td>
                      <td className="py-2 text-right text-red-600 dark:text-red-400">{row.blocked}</td>
                      <td className="py-2 text-right">{row.blockRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Top blocked keys */}
        {topBlocked.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Top Blocked Clients</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                    <th className="pb-2 font-medium">Client Key</th>
                    <th className="pb-2 font-medium">Tier</th>
                    <th className="pb-2 font-medium text-right">Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {topBlocked.map((row) => (
                    <tr key={row.key} className="border-b dark:border-gray-800 last:border-0">
                      <td className="py-2 font-mono text-xs truncate max-w-[180px]" title={row.key}>
                        {row.key.length > 24 ? `${row.key.slice(0, 24)}…` : row.key}
                      </td>
                      <td className="py-2 capitalize">{row.tier}</td>
                      <td className="py-2 text-right text-red-600 dark:text-red-400">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* By endpoint */}
      {endpointRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Endpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={endpointRows} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis dataKey="endpoint" type="category" tick={{ fontSize: 10 }} width={120} />
                <Tooltip />
                <Legend />
                <Bar dataKey="total" name="Total" fill="#3b82f6" />
                <Bar dataKey="blocked" name="Blocked" fill="#ef4444" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-key table */}
      {perKey.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Per-Client Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400 border-b dark:border-gray-700">
                  <th className="pb-2 font-medium">Client Key</th>
                  <th className="pb-2 font-medium">Tier</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                  <th className="pb-2 font-medium text-right">Blocked</th>
                  <th className="pb-2 font-medium text-right">Allow Rate</th>
                  <th className="pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {perKey.map((row) => {
                  const sustainedRisk = row.total >= 20 && row.allowRate < 0.2;
                  return (
                    <tr key={row.key} className="border-b dark:border-gray-800 last:border-0">
                      <td className="py-2 font-mono text-xs truncate max-w-[200px]" title={row.key}>
                        {row.key.length > 30 ? `${row.key.slice(0, 30)}…` : row.key}
                      </td>
                      <td className="py-2 capitalize">{row.tier}</td>
                      <td className="py-2 text-right">{row.total}</td>
                      <td className="py-2 text-right text-red-600 dark:text-red-400">{row.blocked}</td>
                      <td className="py-2 text-right">{(row.allowRate * 100).toFixed(1)}%</td>
                      <td className="py-2 text-right">
                        {sustainedRisk ? (
                          <span className="inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400 font-medium">
                            <ShieldAlert className="h-3 w-3" /> Overuse
                          </span>
                        ) : (
                          <span className="text-xs text-green-600 dark:text-green-400">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {!loading && !error && summary?.total === 0 && (
        <div className="text-center py-12 text-gray-400">
          No rate-limit events recorded in the selected window.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
