'use client';

import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, Clock, Folder, CheckCircle2, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { DashboardStatsSkeleton } from '@/components/ui/loading-skeletons';
import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';

type CategoryAnalytics = {
  category: string;
  totalAmount: number;
};

type CategoryTrend = {
  month: string;
  [key: string]: number | string;
};

export default function DashboardPage() {
  const { stats, recentActivity, payments, loading } = useDashboardData();
  const [analytics, setAnalytics] = useState<CategoryAnalytics[] | null>(null);
  const [trends, setTrends] = useState<CategoryTrend[]>([]);

  useEffect(() => {
    if (payments.length === 0) {
      return;
    }

    api.categories.getAnalytics(payments).then((data: { analytics: CategoryAnalytics[]; trends: CategoryTrend[] }) => {
      setAnalytics(data.analytics);
      setTrends(data.trends);
    });
  }, [payments]);

  const distributionData = analytics
    ? analytics.map((a) => ({
        name: a.category,
        value: a.totalAmount,
        color: {
          subscription: '#3b82f6',
          invoice: '#10b981',
          donation: '#f59e0b',
          refund: '#ef4444',
          payroll: '#8b5cf6',
          software: '#06b6d4',
          infrastructure: '#6366f1',
          uncategorized: '#94a3b8',
        }[a.category] || '#94a3b8'
      })).filter((a) => a.value > 0)
    : [
        { name: 'Completed Projects', value: 65, color: '#10b981' },
        { name: 'Pending Payments', value: 20, color: '#f59e0b' },
        { name: 'Active Contracts', value: 15, color: '#3b82f6' },
      ];

  const trendData = trends.length > 0 ? trends : [
    { month: 'Jan', revenue: 12400, earnings: 9800 },
    { month: 'Feb', revenue: 15200, earnings: 11300 },
    { month: 'Mar', revenue: 18900, earnings: 14500 },
    { month: 'Apr', revenue: 22100, earnings: 16800 },
    { month: 'May', revenue: 19800, earnings: 15200 },
    { month: 'Jun', revenue: 25400, earnings: 20100 },
  ];

  const comparisonData = [
    { period: 'This Month', revenue: 25400, projects: 18 },
    { period: 'Last Month', revenue: 19800, projects: 14 },
    { period: 'This Quarter', revenue: 68200, projects: 47 },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
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
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
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
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  Category Trends
                  <TrendingUp className="h-5 w-5 text-green-600" />
                </div>
                {trends.length > 0 && <Badge variant="secondary">Live Data</Badge>}
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
                  {trends.length > 0 ? (
                    Object.keys(trends[0]).filter(k => k !== 'month').map((cat, idx) => (
                      <Line
                        key={cat}
                        type="monotone"
                        dataKey={cat}
                        stroke={[
                          '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
                          '#8b5cf6', '#06b6d4', '#6366f1', '#94a3b8'
                        ][idx % 8]}
                        strokeWidth={3}
                        name={cat.charAt(0).toUpperCase() + cat.slice(1)}
                      />
                    ))
                  ) : (
                    <>
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
                    </>
                  )}
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
              <CardTitle className="flex items-center justify-between">
                Spending Distribution
                {analytics && <Badge variant="secondary">Live Data</Badge>}
              </CardTitle>
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

      {/* 3. Bar Chart - Comparison */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Performance Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="period" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" fill="#3b82f6" name="Revenue ($)" radius={4} />
                <Bar dataKey="projects" fill="#10b981" name="Projects" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
      >
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
