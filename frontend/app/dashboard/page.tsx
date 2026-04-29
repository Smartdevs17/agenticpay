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
          <p className="text-gray-600 mt-1 dark:text-gray-400">Welcome back! Here&apos;s your overview.</p>
        </div>
        <DashboardStatsSkeleton />
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          </CardContent>
        </Card>
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
        <p className="text-gray-600 mt-1 dark:text-gray-400">Welcome back! Here&apos;s your overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[{
          title: 'Total Earnings', icon: <DollarSign className="h-4 w-4 text-gray-400" />, value: stats.totalEarnings, subtitle: 'All time', color: 'text-green-600', extraIcon: <TrendingUp className="h-3 w-3" />
        }, {
          title: 'Pending Payments', icon: <Clock className="h-4 w-4 text-gray-400" />, value: stats.pendingPayments, subtitle: 'Awaiting approval', color: 'text-yellow-600'
        }, {
          title: 'Active Projects', icon: <Folder className="h-4 w-4 text-gray-400" />, value: stats.activeProjects, subtitle: 'In progress', color: 'text-blue-600'
        }, {
          title: 'Completed', icon: <CheckCircle2 className="h-4 w-4 text-gray-400" />, value: stats.completedProjects, subtitle: 'Projects done', color: 'text-gray-600'
        }].map((stat, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + idx * 0.1 }}
          >
            <Card className="hover:shadow-lg transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-600">{stat.title}</CardTitle>
                {stat.icon}
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                {stat.extraIcon ? (
                  <p className={`text-xs ${stat.color} mt-1 flex items-center gap-1`}>
                    {stat.extraIcon} {stat.subtitle}
                  </p>
                ) : (
                  <p className={`text-xs ${stat.color} mt-1`}>{stat.subtitle}</p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))}
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">Welcome back! Here&apos;s your overview.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Line Chart - Trends */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Revenue Trends
                <TrendingUp className="h-5 w-5 text-green-600" />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    strokeWidth={3}
                    name="Revenue"
                  />
                  <Line
                    type="monotone"
                    dataKey="earnings"
                    stroke="#10b981"
                    strokeWidth={3}
                    name="Earnings"
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>

        {/* 2. Pie Chart - Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.7 }}
        >
          <Card>
            <CardHeader>
              <CardTitle>Portfolio Distribution</CardTitle>
            </CardHeader>
            <CardContent className="flex justify-center">
              <ResponsiveContainer width="100%" height={320}>
                <PieChart>
                  <Pie
                    data={distributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                  >
                    {distributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </motion.div>
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
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent activity found.</p>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {recentActivity.map((activity, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-4 p-3 bg-green-50 dark:bg-green-950/50 rounded-lg border border-green-100 dark:border-green-900"
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
      </motion.div>
    </div>
  );
}
