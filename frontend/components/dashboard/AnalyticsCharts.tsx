'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export interface AnalyticsChartsProps {
  revenueForChart: Array<{ time: string; revenue: number; count?: number }>;
  funnelForChart: Array<{ name: string; value: number; fill?: string }>;
  byNetwork: Array<{ label: string; count: number; amount?: number; percentage: number }>;
  byCurrency: Array<{ label: string; count: number; amount?: number; percentage: number }>;
  colors: string[];
}

export default function AnalyticsCharts({
  revenueForChart,
  funnelForChart,
  byNetwork,
  byCurrency,
  colors,
}: AnalyticsChartsProps) {
  return (
    <div className="space-y-6">
      {/* Top Charts: Revenue Time-Series and Payment Funnel */}
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

      {/* Bottom Charts: Network and Currency Segmentation */}
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
                    <Cell key={i} fill={colors[i % colors.length]} />
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
                    <Cell key={i} fill={colors[i % colors.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
