"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

interface ProfilerStats {
  totalQueries: number;
  slowQueries: number;
  slowPercentage: number;
  avgDurationMs: string;
  p95DurationMs: number;
  slowThresholdMs: number;
}

interface PoolStats {
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
  totalConnections: number;
  maxConnections: number;
  averageAcquireTimeMs: number;
  peakActiveConnections: number;
  poolExhaustionCount: number;
  isExhausted: boolean;
  activeLeases: number;
}

interface SlowQuery {
  query: string;
  durationMs: number;
  timestamp: string;
  source: string;
  signature: string;
}

interface IndexUsage {
  indexName: string;
  table: string;
  columns: string;
  unique: boolean;
  idxScan: number;
  idxTupRead: number;
  idxTupFetch: number;
  sizeBytes: number;
  lastUsed: string | null;
}

interface IndexRecommendation {
  type: "missing" | "unused" | "redundant" | "composite";
  table: string;
  columns: string[];
  reason: string;
  estimatedImpact: string;
  ddl: string;
}

interface TableScan {
  table: string;
  seqScan: number;
  seqTupRead: number;
  estimatedRows: number;
}

interface DbAlert {
  type: string;
  severity: "info" | "warn" | "critical";
  message: string;
  timestamp: string;
}

interface DashboardData {
  profiler: ProfilerStats;
  pool: PoolStats;
  slowThresholdMs: number;
  criticalThresholdMs: number;
}

export default function DatabasePage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [slowQueries, setSlowQueries] = useState<SlowQuery[]>([]);
  const [indexStats, setIndexStats] = useState<IndexUsage[]>([]);
  const [recommendations, setRecommendations] = useState<IndexRecommendation[]>([]);
  const [tableScans, setTableScans] = useState<TableScan[]>([]);
  const [alerts, setAlerts] = useState<DbAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "queries" | "indexes" | "alerts">("overview");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [statsRes, indexRes, recRes, tableRes, alertRes] = await Promise.all([
        fetch(`${API_BASE}/database/stats`),
        fetch(`${API_BASE}/database/index-stats`),
        fetch(`${API_BASE}/database/index-recommendations`),
        fetch(`${API_BASE}/database/table-scans`),
        fetch(`${API_BASE}/database/alerts`),
      ]);

      if (statsRes.ok) {
        const data = await statsRes.json();
        setDashboard(data.data);
        setSlowQueries(data.data.recentSlow || []);
      }
      if (indexRes.ok) { const data = await indexRes.json(); setIndexStats(data.data); }
      if (recRes.ok) { const data = await recRes.json(); setRecommendations(data.data); }
      if (tableRes.ok) { const data = await tableRes.json(); setTableScans(data.data); }
      if (alertRes.ok) { const data = await alertRes.json(); setAlerts(data.data); }
    } catch (err) {
      console.error("Failed to fetch database stats:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    if (!autoRefresh) return;
    const interval = setInterval(fetchAll, 30_000);
    return () => clearInterval(interval);
  }, [fetchAll, autoRefresh]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warnAlerts = alerts.filter((a) => a.severity === "warn");

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Database Performance</h1>
          <p className="text-sm text-gray-600">
            Query monitoring, index analysis, and slow query detection
          </p>
        </div>
        <div className="flex items-center gap-3">
          {criticalAlerts.length > 0 && (
            <Badge variant="destructive">{criticalAlerts.length} critical</Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setAutoRefresh(!autoRefresh)}>
            {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchAll}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-2 border-b pb-2">
        {(["overview", "queries", "indexes", "alerts"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-t ${
              activeTab === tab
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab === "overview" && "Overview"}
            {tab === "queries" && `Slow Queries (${slowQueries.length})`}
            {tab === "indexes" && `Indexes (${recommendations.length} recs)`}
            {tab === "alerts" && `Alerts (${alerts.length})`}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <>
          {/* Summary cards */}
          {dashboard && (
            <div className="grid grid-cols-4 gap-4">
              <Card className="p-4">
                <p className="text-2xl font-bold text-gray-900">{dashboard.profiler.totalQueries}</p>
                <p className="text-sm text-gray-500">Total Queries</p>
              </Card>
              <Card className="p-4">
                <p className="text-2xl font-bold text-amber-600">{dashboard.profiler.slowQueries}</p>
                <p className="text-sm text-gray-500">Slow Queries ({dashboard.profiler.slowPercentage.toFixed(1)}%)</p>
              </Card>
              <Card className="p-4">
                <p className="text-2xl font-bold text-gray-900">{dashboard.profiler.avgDurationMs}ms</p>
                <p className="text-sm text-gray-500">Avg Duration</p>
              </Card>
              <Card className="p-4">
                <p className="text-2xl font-bold text-blue-600">{dashboard.profiler.p95DurationMs}ms</p>
                <p className="text-sm text-gray-500">P95 Duration</p>
              </Card>
            </div>
          )}

          {/* Pool stats */}
          {dashboard && (
            <Card className="p-4">
              <h3 className="mb-3 font-medium text-gray-900">Connection Pool</h3>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <p className="text-lg font-bold text-gray-900">{dashboard.pool.activeConnections}</p>
                  <p className="text-xs text-gray-500">Active</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{dashboard.pool.idleConnections}</p>
                  <p className="text-xs text-gray-500">Idle</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{dashboard.pool.waitingClients}</p>
                  <p className="text-xs text-gray-500">Waiting</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-gray-900">{dashboard.pool.averageAcquireTimeMs}ms</p>
                  <p className="text-xs text-gray-500">Avg Acquire</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                <span>Peak: {dashboard.pool.peakActiveConnections}</span>
                <span>Max: {dashboard.pool.maxConnections}</span>
                <span>Exhaustions: {dashboard.pool.poolExhaustionCount}</span>
                <span>Leases: {dashboard.pool.activeLeases}</span>
              </div>
            </Card>
          )}

          {/* Recent slow queries */}
          <Card className="p-4">
            <h3 className="mb-3 font-medium text-gray-900">Recent Slow Queries</h3>
            {slowQueries.length === 0 ? (
              <p className="text-sm text-gray-500">No slow queries detected</p>
            ) : (
              <div className="space-y-2">
                {slowQueries.slice(0, 5).map((q, i) => (
                  <div key={i} className="rounded border p-2 text-sm">
                    <div className="flex items-center justify-between">
                      <Badge variant={q.durationMs > (dashboard?.criticalThresholdMs || 2000) ? "destructive" : "secondary"}>
                        {q.durationMs.toFixed(0)}ms
                      </Badge>
                      <span className="text-xs text-gray-400">{q.source}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-gray-700 truncate">{q.query}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Table scans */}
          <Card className="p-4">
            <h3 className="mb-3 font-medium text-gray-900">Sequential Scans (High-Risk Tables)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-2 font-medium">Table</th>
                    <th className="pb-2 font-medium">Seq Scans</th>
                    <th className="pb-2 font-medium">Rows Read</th>
                    <th className="pb-2 font-medium">Est. Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {tableScans
                    .filter((t) => t.seqScan > 10)
                    .slice(0, 10)
                    .map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 font-medium text-gray-900">{t.table}</td>
                        <td className="py-2">
                          <Badge variant={t.seqScan > 1000 ? "destructive" : t.seqScan > 100 ? "secondary" : "default"}>
                            {t.seqScan.toLocaleString()}
                          </Badge>
                        </td>
                        <td className="py-2 text-gray-700">{t.seqTupRead.toLocaleString()}</td>
                        <td className="py-2 text-gray-700">{t.estimatedRows.toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {activeTab === "queries" && (
        <Card className="p-4">
          <h3 className="mb-3 font-medium text-gray-900">All Slow Queries</h3>
          {slowQueries.length === 0 ? (
            <p className="text-sm text-gray-500">No slow queries detected</p>
          ) : (
            <div className="space-y-2">
              {slowQueries.map((q, i) => (
                <div key={i} className="rounded border p-3">
                  <div className="flex items-center justify-between">
                    <Badge variant={q.durationMs > (dashboard?.criticalThresholdMs || 2000) ? "destructive" : "secondary"}>
                      {q.durationMs.toFixed(0)}ms
                    </Badge>
                    <div className="flex items-center gap-2 text-xs text-gray-400">
                      <span>{q.source}</span>
                      <span>{new Date(q.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <p className="mt-1 font-mono text-xs text-gray-700 break-all">{q.query}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {activeTab === "indexes" && (
        <div className="space-y-4">
          {/* Index recommendations */}
          <Card className="p-4">
            <h3 className="mb-3 font-medium text-gray-900">Index Recommendations</h3>
            {recommendations.length === 0 ? (
              <p className="text-sm text-gray-500">No recommendations</p>
            ) : (
              <div className="space-y-3">
                {recommendations.map((r, i) => (
                  <div key={i} className="rounded border p-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          r.type === "missing" ? "destructive" :
                          r.type === "unused" ? "secondary" :
                          "default"
                        }
                      >
                        {r.type}
                      </Badge>
                      <span className="font-medium text-gray-900">{r.table}</span>
                      {r.columns.length > 0 && (
                        <span className="text-sm text-gray-500">({r.columns.join(", ")})</span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-700">{r.reason}</p>
                    <p className="text-xs text-gray-500">{r.estimatedImpact}</p>
                    <pre className="mt-2 rounded bg-gray-50 p-2 text-xs font-mono text-gray-600 overflow-x-auto">
                      {r.ddl}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Current index usage stats */}
          <Card className="p-4">
            <h3 className="mb-3 font-medium text-gray-900">Index Usage Statistics</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-gray-500">
                    <th className="pb-2 font-medium">Table</th>
                    <th className="pb-2 font-medium">Index</th>
                    <th className="pb-2 font-medium">Scans</th>
                    <th className="pb-2 font-medium">Tuples Read</th>
                    <th className="pb-2 font-medium">Size</th>
                    <th className="pb-2 font-medium">Unique</th>
                  </tr>
                </thead>
                <tbody>
                  {indexStats.map((idx, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 font-medium text-gray-900">{idx.table}</td>
                      <td className="py-2 font-mono text-xs text-gray-700">{idx.indexName}</td>
                      <td className="py-2">
                        <Badge variant={idx.idxScan === 0 ? "destructive" : "default"}>
                          {idx.idxScan}
                        </Badge>
                      </td>
                      <td className="py-2 text-gray-700">{idx.idxTupRead.toLocaleString()}</td>
                      <td className="py-2 text-gray-700">{(idx.sizeBytes / 1024).toFixed(0)} KB</td>
                      <td className="py-2 text-gray-700">{idx.unique ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "alerts" && (
        <Card className="p-4">
          <h3 className="mb-3 font-medium text-gray-900">Database Alerts</h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-gray-500">No alerts</p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-3 rounded border p-3">
                  <Badge
                    variant={a.severity === "critical" ? "destructive" : a.severity === "warn" ? "secondary" : "default"}
                    className="shrink-0"
                  >
                    {a.severity}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">{a.message}</p>
                    <p className="text-xs text-gray-500">
                      {new Date(a.timestamp).toLocaleString()} — {a.type}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}