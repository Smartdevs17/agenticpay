'use client';

import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, Clock, Folder, CheckCircle2, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { DashboardStatsSkeleton } from '@/components/ui/loading-skeletons';

export default function DashboardPage() {
  const { stats, recentActivity, loading } = useDashboardData();

  const metrics = [
    { title: 'Total Earnings', value: stats.totalEarnings, suffix: ' USD', icon: DollarSign, accent: 'text-emerald-600' },
    { title: 'Pending Payments', value: stats.pendingPayments, suffix: ' USD', icon: Clock, accent: 'text-amber-600' },
    { title: 'Active Projects', value: String(stats.activeProjects), suffix: '', icon: Folder, accent: 'text-blue-600' },
    { title: 'Completed Projects', value: String(stats.completedProjects), suffix: '', icon: CheckCircle2, accent: 'text-violet-600' },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">Welcome back! Here&apos;s your overview.</p>
        </div>
        <DashboardStatsSkeleton />
      </div>
    );
  }

  const totalProjects = stats.completedProjects + stats.activeProjects;
  const completedRate = totalProjects > 0 ? Math.round((stats.completedProjects / totalProjects) * 100) : 0;
  const activeRate = totalProjects > 0 ? Math.round((stats.activeProjects / totalProjects) * 100) : 0;

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">Welcome back! Here&apos;s your overview.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 sm:gap-6">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <motion.div
              key={metric.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">
                    {metric.title}
                  </CardTitle>
                  <Icon className={`h-5 w-5 ${metric.accent}`} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {metric.value}
                    {metric.suffix}
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Performance Snapshot
              <TrendingUp className="h-5 w-5 text-green-600" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SummaryTile label="Completion Rate" value={`${completedRate}%`} />
              <SummaryTile label="Active Load" value={`${stats.activeProjects} open`} />
              <SummaryTile label="Payment Queue" value={`${stats.pendingPayments} USD`} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Portfolio Mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProgressRow label="Completed" percentage={completedRate} color="bg-green-500" />
            <ProgressRow label="Active" percentage={activeRate} color="bg-blue-500" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-gray-500">No recent activity found.</p>
          ) : (
            <div className="space-y-4">
              {recentActivity.map((activity, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-4 rounded-lg border border-green-100 bg-green-50 p-3 dark:border-green-900 dark:bg-green-950/50"
                >
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 dark:text-white">{activity.title}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{activity.description}</p>
                  </div>
                  <span className="text-sm text-gray-500">{activity.time}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function ProgressRow({
  label,
  percentage,
  color,
}: {
  label: string;
  percentage: number;
  color: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-medium text-gray-900 dark:text-white">{percentage}%</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-800">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
