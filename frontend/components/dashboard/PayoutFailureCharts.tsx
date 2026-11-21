'use client';

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export interface PayoutFailureChartsProps {
  trend: Array<{ period: string; failures: number }>;
  breakdown: Array<{ code: string; count: number }>;
  colors: string[];
}

export default function PayoutFailureCharts({
  trend,
  breakdown,
  colors,
}: PayoutFailureChartsProps) {
  return (
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
                    <Cell key={entry.code} fill={colors[index % colors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
