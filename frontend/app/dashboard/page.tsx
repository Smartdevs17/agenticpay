'use client';

import { useDashboardData } from '@/lib/hooks/useDashboardData';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DollarSign, Clock, Folder, CheckCircle2, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { DashboardStatsSkeleton } from '@/components/ui/loading-skeletons';

export default function DashboardPage() {
  const { stats, recentActivity, loading } = useDashboardData();

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">Welcome back! Here&apos;s your overview.</p>
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
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Welcome back! Here&apos;s your overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
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

      {/* Recent Activity */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-gray-500 text-sm">No recent activity found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-4">
                {recentActivity.map((activity, idx) => (
                  <div key={idx} className="flex items-center gap-4 p-3 bg-green-50 rounded-lg border border-green-100">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div className="flex-1">
                      <p className="font-medium text-gray-900">{activity.title}</p>
                      <p className="text-sm text-gray-600">{activity.description}</p>
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