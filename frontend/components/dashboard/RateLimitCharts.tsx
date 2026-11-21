'use client';

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

export interface RateLimitChartsProps {
  trends: Array<{ timestamp: string; total: number; allowed: number; blocked: number }>;
  tierRows: Array<{ tier: string; total: number; blocked: number; blockRate: string }>;
  tierColors: Record<string, string>;
  topBlocked: Array<{ key: string; tier: string; count: number }>;
  endpointRows: Array<{ endpoint: string; total: number; blocked: number }>;
}

export default function RateLimitCharts({
  trends,
  tierRows,
  tierColors,
  topBlocked,
  endpointRows,
}: RateLimitChartsProps) {
  return (
    <div className="space-y-6">
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
                          style={{ background: tierColors[row.tier] ?? '#9ca3af' }}
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
    </div>
  );
}
