'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  FunnelChart,
  Funnel,
  LabelList,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Download,
  TrendingUp,
  Wifi,
  WifiOff,
  BarChart3,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────

interface WsMetrics {
  activeConnections: number;
  acceptedConnections: number;
  rejectedConnections: number;
  rejectedByIpLimit: number;
  rejectedByAuthFailure: number;
  idleDisconnections: number;
  messagesIn: number;
  messagesOut: number;
}

// ── Original types (mirrored from backend analytics.ts) ────────────────────

interface FunnelStep {
  stage: string;
  count: number;
  amount: number;
  conversionRate: number;
}

interface RevenuePoint {
  timestamp: string;
  revenue: number;
  count: number;
  network: string;
}

interface AnomalyAlert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  detectedAt: string;
}

interface SegmentBreakdown {
  label: string;
  count: number;
  amount: number;
  percentage: number;
}

interface AnalyticsSummary {
  totalRevenue: number;
  totalPayments: number;
  successRate: number;
  avgPaymentAmount: number;
}

interface AnalyticsSnapshot {
  funnel: FunnelStep[];
  revenue: RevenuePoint[];
  anomalies: AnomalyAlert[];
  byNetwork: SegmentBreakdown[];
  byCurrency: SegmentBreakdown[];
  summary: AnalyticsSummary;
  generatedAt: string;
}

interface MerchantPercentile {
  volumePercentile: number;
  successRatePercentile: number;
  avgAmountPercentile: number;
  note: string;
}

// ── Constants ──────────────────────────────────────────────────────────────

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const WS_URL = API_URL.replace(/^http/, 'ws').replace(/\/api.*$/, '') + '/ws';

const SEVERITY_COLOR: Record<string, string> = {
  info: 'bg-blue-50 border-blue-200 text-blue-800',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  critical: 'bg-red-50 border-red-200 text-red-800',
};

const TIME_PRESETS = [
  { label: '1h', hours: 1 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
] as const;

// ── Component ──────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsSnapshot | null>(null);
  const [percentiles, setPercentiles] = useState<MerchantPercentile | null>(null);
  const [wsMetrics, setWsMetrics] = useState<WsMetrics | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [hours, setHours] = useState<number>(24);

  const applySnapshot = useCallback((snapshot: AnalyticsSnapshot) => {
    setData(snapshot);
    setLastUpdated(new Date().toLocaleTimeString());
  }, []);

  const fetchSnapshot = useCallback(
    (selectedHours: number) => {
      fetch(`${API_URL}/api/v1/analytics?hours=${selectedHours}`)
        .then((r) => r.json())
        .then(applySnapshot)
        .catch(console.error);

      fetch(`${API_URL}/api/v1/analytics/percentiles?hours=${selectedHours}`)
        .then((r) => r.json())
        .then(setPercentiles)
        .catch(console.error);

      fetch(`${API_URL}/api/v1/websocket/metrics`)
        .then((r) => r.json())
        .then((m: WsMetrics) => setWsMetrics(m))
        .catch(console.error);
    },
    [applySnapshot],
  );

  // Fetch when time period changes
  useEffect(() => {
    fetchSnapshot(hours);
  }, [hours, fetchSnapshot]);

  // Subscribe to real-time updates via WebSocket
  useEffect(() => {
    let ws: WebSocket;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(WS_URL);
        ws.onopen = () => setWsConnected(true);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === 'analytics:update' && msg.payload) {
              applySnapshot(msg.payload as AnalyticsSnapshot);
            }
          } catch {
            // ignore malformed frames
          }
        };
        ws.onclose = () => {
          setWsConnected(false);
          reconnectTimeout = setTimeout(connect, 5000);
        };
        ws.onerror = () => ws.close();
      } catch {
        reconnectTimeout = setTimeout(connect, 5000);
      }
    }

    connect();
    return () => {
      clearTimeout(reconnectTimeout);
      ws?.close();
    };
  }, [applySnapshot]);

  const handleExport = () => {
    window.open(`${API_URL}/api/v1/analytics/export?hours=${hours}`, '_blank');
  };

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Activity className="h-8 w-8 animate-pulse text-blue-600 mx-auto mb-2" />
          <p className="text-gray-500">Loading analytics…</p>
        </div>
      </div>
    );
  }

  const { funnel, revenue, anomalies, byNetwork, byCurrency, summary } = data;

  const revenueForChart = revenue.map((p) => ({
    time: p.timestamp.slice(11, 16) || p.timestamp.slice(0, 10),
    revenue: Math.round(p.revenue * 100) / 100,
    count: p.count,
  }));

  const funnelForChart = funnel.map((s) => ({
    name: s.stage.charAt(0).toUpperCase() + s.stage.slice(1),
    value: s.count,
    fill: s.stage === 'completed' ? '#10b981' : s.stage === 'failed' ? '#ef4444' : '#3b82f6',
  }));

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Payment Analytics</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Real-time metrics, funnel analysis, and anomaly detection
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Time period selector */}
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 p-1">
            {TIME_PRESETS.map((preset) => (
              <Button
                key={preset.hours}
                size="sm"
                variant={hours === preset.hours ? 'default' : 'ghost'}
                onClick={() => setHours(preset.hours)}
                className="h-7 px-3 text-xs"
              >
                {preset.label}
              </Button>
            ))}
          </div>

          {/* Export CSV */}
          <Button size="sm" variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>

          {/* Live status */}
          <div className="flex items-center gap-2 text-sm">
            {wsConnected ? (
              <span className="flex items-center gap-1 text-green-600">
                <Wifi className="h-4 w-4" /> Live
              </span>
            ) : (
              <span className="flex items-center gap-1 text-gray-400">
                <WifiOff className="h-4 w-4" /> Offline
              </span>
            )}
            {lastUpdated && <span className="text-gray-400 text-xs">Updated {lastUpdated}</span>}
          </div>
        </div>
      </div>

      {/* Anomaly Alerts */}
      {anomalies.length > 0 && (
        <div className="space-y-2">
          {anomalies.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start gap-3 p-3 rounded-lg border text-sm ${SEVERITY_COLOR[alert.severity]}`}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium capitalize">{alert.type.replace(/_/g, ' ')}</p>
                <p className="opacity-80">{alert.message}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.totalRevenue.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-1">
              Last {hours < 24 ? `${hours}h` : hours === 24 ? '24 hours' : hours === 168 ? '7 days' : '30 days'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Total Payments</CardTitle>
            <Activity className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.totalPayments}</p>
            <p className="text-xs text-gray-500 mt-1">All statuses</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Success Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{(summary.successRate * 100).toFixed(1)}%</p>
            <p className="text-xs text-gray-500 mt-1">Completed payments</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-600">Avg Payment</CardTitle>
            <TrendingUp className="h-4 w-4 text-gray-400" aria-hidden="true" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.avgPaymentAmount.toFixed(2)}</p>
            <p className="text-xs text-gray-500 mt-1">Completed only</p>
          </CardContent>
        </Card>
      </div>

      {/* WebSocket Connection Metrics */}
      {wsMetrics && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base font-semibold">WebSocket Connections</CardTitle>
            {wsConnected ? (
              <Wifi className="h-4 w-4 text-green-500" aria-hidden="true" />
            ) : (
              <WifiOff className="h-4 w-4 text-gray-400" aria-hidden="true" />
            )}
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Active</p>
                <p className="text-xl font-bold text-green-600">{wsMetrics.activeConnections}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Accepted</p>
                <p className="text-xl font-bold">{wsMetrics.acceptedConnections}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">IP Rejected</p>
                <p className="text-xl font-bold text-amber-600">{wsMetrics.rejectedByIpLimit}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Auth Rejected</p>
                <p className="text-xl font-bold text-red-600">{wsMetrics.rejectedByAuthFailure}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Time-Series */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={revenueForChart}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#revenueGrad)"
                  name="Revenue"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Payment Funnel */}
        <Card>
          <CardHeader>
            <CardTitle>Payment Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <FunnelChart>
                <Tooltip formatter={(v: number) => [`${v} payments`]} />
                <Funnel dataKey="value" data={funnelForChart} isAnimationActive>
                  <LabelList position="center" fill="#fff" stroke="none" dataKey="name" />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Network Segmentation */}
        <Card>
          <CardHeader>
            <CardTitle>By Network</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byNetwork} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="label" width={70} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" name="Payments" radius={4}>
                  {byNetwork.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Currency Segmentation */}
        <Card>
          <CardHeader>
            <CardTitle>By Currency</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={byCurrency}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ label, percentage }: { label: string; percentage: number }) =>
                    `${label} ${(percentage * 100).toFixed(0)}%`
                  }
                >
                  {byCurrency.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Merchant Percentile Card */}
      {percentiles && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              Industry Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
              ⚠ {percentiles.note}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { label: 'Volume', value: percentiles.volumePercentile },
                { label: 'Success Rate', value: percentiles.successRatePercentile },
                { label: 'Avg Payment', value: percentiles.avgAmountPercentile },
              ].map(({ label, value }) => (
                <div key={label} className="text-center p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <p className="text-3xl font-bold text-blue-600">{value}th</p>
                  <p className="text-sm text-gray-500 mt-1">percentile</p>
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mt-1">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
