'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle, Calendar, Loader2, RefreshCw } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  buildErrorBreakdown,
  buildFailureTrend,
  formatAmount,
  formatPercent,
  isoDateDaysAgo,
  isoToday,
  rankMerchantsByFailureRate,
  severityVariant,
  type PayoutFailureAnalytics,
} from '@/lib/analytics/payout-failures';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const TENANT_ID = 'default';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

export default function PayoutFailureAnalyticsPage() {
  const [dateFrom, setDateFrom] = useState(() => isoDateDaysAgo(30));
  const [dateTo, setDateTo] = useState(() => isoToday());
  const [analytics, setAnalytics] = useState<PayoutFailureAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = useCallback((): void => {
    const params = new URLSearchParams({ dateFrom, dateTo });

    fetch(`${API_URL}/api/v1/reports/payout-failure-analytics?${params.toString()}`, {
      headers: { 'x-tenant-id': TENANT_ID },
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.message ?? `Request failed with status ${response.status}`);
        }
        return response.json();
      })
      .then((payload: { analytics?: PayoutFailureAnalytics }) => {
        setAnalytics(payload.analytics ?? null);
        setError(null);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unknown error');
        setAnalytics(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [dateFrom, dateTo]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  const trend = useMemo(() => buildFailureTrend(analytics), [analytics]);
  const breakdown = useMemo(() => buildErrorBreakdown(analytics), [analytics]);
  const merchants = useMemo(() => rankMerchantsByFailureRate(analytics, 10), [analytics]);
  const totals = analytics?.totals;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payout Failure Analytics</h1>
          <p className="text-muted-foreground">
            Failure rate, root causes and worst performing merchants for the selected period.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchAnalytics();
          }}
          disabled={loading}
        >
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" /> Date Range
          </CardTitle>
          <CardDescription>Both dates are inclusive and interpreted as UTC days.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="date-from">From</Label>
              <Input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-to">To</Label>
              <Input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                className="w-full"
                onClick={() => {
                  setLoading(true);
                  fetchAnalytics();
                }}
                disabled={loading || !dateFrom || !dateTo}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                <span className="ms-2">Apply</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Failed to load payout failure analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totals?.totalPayouts ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed payouts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-destructive">{totals?.failedPayouts ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Failure rate</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatPercent(totals?.failureRate ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Failed amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{formatAmount(totals?.failedAmount ?? 0)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Failures over time</CardTitle>
            <CardDescription>Failed payouts per day across the selected range.</CardDescription>
          </CardHeader>
          <CardContent>
            {trend.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No payout activity yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="failures"
                    stroke="#ef4444"
                    fill="#ef4444"
                    fillOpacity={0.15}
                    name="Failures"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Failures by root cause</CardTitle>
            <CardDescription>Classified error codes for the failed payouts.</CardDescription>
          </CardHeader>
          <CardContent>
            {breakdown.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No failures to classify.</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={breakdown}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="code" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" name="Failures">
                    {breakdown.map((entry, index) => (
                      <Cell key={entry.code} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Merchants by failure rate</CardTitle>
          <CardDescription>Failure rate is measured against every payout in the range.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Merchant</TableHead>
                <TableHead>Payouts</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>Failure rate</TableHead>
                <TableHead>Failed amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {merchants.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No merchant activity yet.
                  </TableCell>
                </TableRow>
              ) : (
                merchants.map((merchant) => (
                  <TableRow key={`${merchant.merchantId}-${merchant.asset}`}>
                    <TableCell className="font-mono text-xs">{merchant.merchantId}</TableCell>
                    <TableCell>{merchant.totalPayouts}</TableCell>
                    <TableCell>{merchant.failedPayouts}</TableCell>
                    <TableCell>{formatPercent(merchant.failureRate)}</TableCell>
                    <TableCell>{formatAmount(merchant.failedAmount)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent failures</CardTitle>
          <CardDescription>Most recent failed payouts with their classified root cause.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Occurred</TableHead>
                <TableHead>Merchant</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Attempt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(analytics?.failures ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    No failures in this period.
                  </TableCell>
                </TableRow>
              ) : (
                (analytics?.failures ?? []).map((failure) => (
                  <TableRow key={failure.id}>
                    <TableCell>{new Date(failure.occurredAt).toISOString().slice(0, 10)}</TableCell>
                    <TableCell className="font-mono text-xs">{failure.merchantId}</TableCell>
                    <TableCell>{failure.asset}</TableCell>
                    <TableCell className="font-mono text-xs">{failure.errorCode}</TableCell>
                    <TableCell>
                      <Badge variant={severityVariant(failure.severity)}>{failure.severity}</Badge>
                    </TableCell>
                    <TableCell>{formatAmount(failure.amount)}</TableCell>
                    <TableCell>{failure.attempt}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
