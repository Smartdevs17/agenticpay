"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  retrying: number;
  dlq: number;
  priorityBreakdown: {
    critical: number;
    high: number;
    normal: number;
    low: number;
  };
}

interface QueueMetrics {
  totalEnqueued: number;
  totalCompleted: number;
  totalFailed: number;
  totalDlq: number;
  totalRetried: number;
  avgProcessingTimeMs: number;
  processingTimeSamples: number;
  priorityDistribution: Record<string, number>;
  perQueueLatency: Record<string, { count: number; totalMs: number }>;
}

interface DlqEntry {
  job: {
    id: string;
    queue: string;
    priority: string;
    lastError: string;
    createdAt: string;
    failedAt: string;
  };
  failedAt: string;
  failureReason: string;
  originalQueue: string;
}

interface RateLimitStatus {
  maxTokens: number;
  remaining: number;
  usage: number;
}

type Tab = "overview" | "dlq" | "rate-limits" | "metrics";

export default function JobsDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [metrics, setMetrics] = useState<QueueMetrics | null>(null);
  const [dlq, setDlq] = useState<DlqEntry[]>([]);
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitStatus>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, metricsRes, dlqRes, rlRes] = await Promise.allSettled([
        fetch(`${API_BASE}/queue/stats`),
        fetch(`${API_BASE}/queue/metrics`),
        fetch(`${API_BASE}/queue/dlq`),
        fetch(`${API_BASE}/queue/rate-limits`),
      ]);

      if (statsRes.status === "fulfilled" && statsRes.value.ok) {
        const body = await statsRes.value.json();
        setStats(body.data);
      }
      if (metricsRes.status === "fulfilled" && metricsRes.value.ok) {
        const body = await metricsRes.value.json();
        setMetrics(body.data);
      }
      if (dlqRes.status === "fulfilled" && dlqRes.value.ok) {
        const body = await dlqRes.value.json();
        setDlq(body.data || []);
      }
      if (rlRes.status === "fulfilled" && rlRes.value.ok) {
        const body = await rlRes.value.json();
        setRateLimits(body.data || {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleReplayDlq = async (jobId: string) => {
    await fetch(`${API_BASE}/queue/dlq/${jobId}/replay`, { method: "POST" });
    fetchData();
  };

  const handleReplayAllDlq = async () => {
    await fetch(`${API_BASE}/queue/dlq/replay-all`, { method: "POST" });
    fetchData();
  };

  const handleClearDlq = async () => {
    await fetch(`${API_BASE}/queue/dlq/clear`, { method: "DELETE" });
    fetchData();
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "dlq", label: `Dead Letter Queue (${dlq.length})` },
    { key: "rate-limits", label: "Rate Limits" },
    { key: "metrics", label: "Metrics" },
  ];

  const priorityColors: Record<string, string> = {
    critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    high: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    normal: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    low: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
  };

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    processing: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    failed: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    retrying: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    dlq: "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900",
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Jobs & Queue Monitoring</h1>
          <p className="text-sm text-muted-foreground">
            Background job processing with priority tiers and rate limiting
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <div className="flex gap-1 border-b pb-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === tab.key
                ? "bg-background border border-b-0 border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <Card className="p-4 border-red-500 bg-red-50 dark:bg-red-950">
          <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>
        </Card>
      )}

      {activeTab === "overview" && stats && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </Card>
            <Card className="p-4 text-center border-yellow-300">
              <p className="text-2xl font-bold text-yellow-600">{stats.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </Card>
            <Card className="p-4 text-center border-blue-300">
              <p className="text-2xl font-bold text-blue-600">{stats.processing}</p>
              <p className="text-xs text-muted-foreground">Processing</p>
            </Card>
            <Card className="p-4 text-center border-green-300">
              <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </Card>
            <Card className="p-4 text-center border-red-300">
              <p className="text-2xl font-bold text-red-600">{stats.failed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </Card>
            <Card className="p-4 text-center border-purple-300">
              <p className="text-2xl font-bold text-purple-600">{stats.retrying}</p>
              <p className="text-xs text-muted-foreground">Retrying</p>
            </Card>
            <Card className="p-4 text-center border-gray-900 dark:border-gray-100">
              <p className="text-2xl font-bold">{stats.dlq}</p>
              <p className="text-xs text-muted-foreground">DLQ</p>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Priority Distribution</h3>
            <div className="space-y-2">
              {(Object.entries(stats.priorityBreakdown) as [string, number][]).map(([priority, count]) => (
                <div key={priority} className="flex items-center gap-3">
                  <Badge className={priorityColors[priority] || ""}>{priority}</Badge>
                  <div className="flex-1 bg-secondary rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono w-12 text-right">{count}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {activeTab === "dlq" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleReplayAllDlq} disabled={dlq.length === 0}>
              Replay All
            </Button>
            <Button variant="destructive" size="sm" onClick={handleClearDlq} disabled={dlq.length === 0}>
              Clear DLQ
            </Button>
          </div>

          {dlq.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              Dead letter queue is empty
            </Card>
          ) : (
            <div className="space-y-2">
              {dlq.map((entry) => (
                <Card key={entry.job.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{entry.job.id}</span>
                        <Badge className={priorityColors[entry.job.priority] || ""}>
                          {entry.job.priority}
                        </Badge>
                        <Badge variant="outline">{entry.originalQueue}</Badge>
                      </div>
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {entry.failureReason}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Failed at {new Date(entry.failedAt).toLocaleString()}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => handleReplayDlq(entry.job.id)}>
                      Replay
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "rate-limits" && (
        <div className="grid gap-4">
          {Object.keys(rateLimits).length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              No rate limiters configured
            </Card>
          ) : (
            Object.entries(rateLimits).map(([queue, rl]) => (
              <Card key={queue} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold">{queue}</h3>
                  <Badge variant={rl.remaining > 0 ? "default" : "destructive"}>
                    {rl.remaining > 0 ? "Active" : "Exhausted"}
                  </Badge>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Capacity</span>
                    <span className="font-mono">{rl.maxTokens}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Remaining</span>
                    <span className="font-mono">{Math.round(rl.remaining)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Current Usage</span>
                    <span className="font-mono">{Math.round(rl.usage)}</span>
                  </div>
                  <div className="bg-secondary rounded-full h-3 overflow-hidden mt-2">
                    <div
                      className={`h-full transition-all duration-500 ${
                        rl.remaining / rl.maxTokens < 0.2
                          ? "bg-red-500"
                          : rl.remaining / rl.maxTokens < 0.5
                          ? "bg-yellow-500"
                          : "bg-green-500"
                      }`}
                      style={{ width: `${(rl.usage / rl.maxTokens) * 100}%` }}
                    />
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {activeTab === "metrics" && metrics && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold">{metrics.totalEnqueued.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Total Enqueued</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{metrics.totalCompleted.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{metrics.totalFailed}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </Card>
            <Card className="p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{metrics.totalRetried}</p>
              <p className="text-xs text-muted-foreground">Retried</p>
            </Card>
          </div>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Average Processing Time</h3>
            <p className="text-3xl font-mono">
              {metrics.avgProcessingTimeMs.toFixed(1)} ms
            </p>
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold mb-3">Per-Queue Latency</h3>
            <div className="space-y-3">
              {Object.entries(metrics.perQueueLatency).map(([queue, data]) => (
                <div key={queue} className="flex items-center justify-between border-b pb-2 last:border-0">
                  <div>
                    <Badge variant="outline">{queue}</Badge>
                    <span className="text-sm text-muted-foreground ml-2">
                      {data.count} samples
                    </span>
                  </div>
                  <span className="font-mono text-sm">
                    {(data.totalMs / data.count).toFixed(1)} ms avg
                  </span>
                </div>
              ))}
              {Object.keys(metrics.perQueueLatency).length === 0 && (
                <p className="text-sm text-muted-foreground">No latency data yet</p>
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}