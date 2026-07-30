'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Clock, Shield, TrendingUp, CheckCircle2, BarChart3, Layers, Activity } from 'lucide-react';
import { motion } from 'framer-motion';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashboardSummary {
  activeRules: number;
  slaConfigs: number;
  totalEvents: number;
  activeBreaches: number;
  averageBreachRate: number;
}

interface EscalationEvent {
  id: string;
  issueId: string;
  issueType: string;
  severity: string;
  fromLevel: string;
  toLevel: string;
  reason: string;
  createdAt: string;
  acknowledgedAt?: string;
}

interface SLABreach {
  id: string;
  issueId: string;
  issueType: string;
  severity: string;
  breachType: string;
  targetMins: number;
  actualMins: number;
  status: string;
  sla?: { name: string };
}

interface Analytics {
  issueType: string;
  severity: string;
  escalatedCount: number;
  slaBreachCount: number;
  resolvedCount: number;
  slaCompliancePct: number;
  openCount: number;
  atRiskCount: number;
}

// ─── API Helpers ──────────────────────────────────────────────────────────────

const API_BASE = '/api/v1/escalation';

async function fetchDashboard(tenantId: string) {
  const res = await fetch(`${API_BASE}/dashboard?tenantId=${tenantId}`);
  if (!res.ok) throw new Error('Failed to fetch dashboard');
  return res.json();
}

// ─── Components ───────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon,
  color,
  subtitle,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  subtitle?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <Card className="hover:shadow-lg transition-shadow border-l-4" style={{ borderLeftColor: color }}>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-300">{title}</CardTitle>
          <span className="text-gray-400">{icon}</span>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-gray-900 dark:text-white">{value}</div>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
        </CardContent>
      </Card>
    </motion.div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
    medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    high: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[severity] || colors.medium}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    compliant: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    at_risk: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    breached: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    resolved: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] || colors.compliant}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function IssueTypeBadge({ issueType }: { issueType: string }) {
  return (
    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
      {issueType.replace(/_/g, ' ')}
    </span>
  );
}

function ComplianceRing({ percentage }: { percentage: number }) {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;
  const color = percentage >= 95 ? '#10b981' : percentage >= 80 ? '#f59e0b' : '#ef4444';

  return (
    <div className="flex flex-col items-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          className="transition-all duration-1000 ease-out"
        />
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="fill-gray-900 dark:fill-white text-sm font-bold">
          {percentage}%
        </text>
      </svg>
      <span className="text-xs text-gray-500 mt-1">SLA Compliance</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EscalationDashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentEvents, setRecentEvents] = useState<EscalationEvent[]>([]);
  const [activeBreaches, setActiveBreaches] = useState<SLABreach[]>([]);
  const [analytics, setAnalytics] = useState<Analytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tenantId, setTenantId] = useState('default');

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const res = await fetchDashboard(tenantId);
        setSummary(res.data.summary);
        setRecentEvents(res.data.recentEvents || []);
        setActiveBreaches(res.data.activeBreaches || []);
        setAnalytics(res.data.analytics || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [tenantId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Failed to load dashboard</h2>
          <p className="text-gray-500 mt-2">{error}</p>
        </div>
      </div>
    );
  }

  const overallCompliance = analytics.length > 0
    ? Math.round(analytics.reduce((sum, a) => sum + a.slaCompliancePct, 0) / analytics.length)
    : 100;

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Escalation & SLA Dashboard
          </h1>
          <p className="text-gray-600 mt-1 dark:text-gray-400">
            Monitor SLA compliance, active escalations, and breach analytics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
          >
            <option value="default">Default Tenant</option>
          </select>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Active Rules"
          value={summary?.activeRules ?? 0}
          icon={<Layers className="h-5 w-5" />}
          color="#8b5cf6"
          subtitle="Escalation rules"
        />
        <StatCard
          title="SLA Configs"
          value={summary?.slaConfigs ?? 0}
          icon={<Shield className="h-5 w-5" />}
          color="#3b82f6"
          subtitle="Per issue type"
        />
        <StatCard
          title="Active Breaches"
          value={summary?.activeBreaches ?? 0}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="#ef4444"
          subtitle="Needs attention"
        />
        <StatCard
          title="Recent Events"
          value={summary?.totalEvents ?? 0}
          icon={<Activity className="h-5 w-5" />}
          color="#f59e0b"
          subtitle="Last 24h"
        />
        <StatCard
          title="Breach Rate"
          value={`${summary?.averageBreachRate ?? 0}%`}
          icon={<TrendingUp className="h-5 w-5" />}
          color={summary && summary.averageBreachRate > 10 ? '#ef4444' : '#10b981'}
          subtitle="Average"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Compliance Ring */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              SLA Compliance
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <ComplianceRing percentage={overallCompliance} />
          </CardContent>
        </Card>

        {/* Analytics Summary */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              Analytics by Issue Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analytics.length === 0 ? (
              <p className="text-sm text-gray-500 py-4">No analytics data available yet.</p>
            ) : (
              <div className="space-y-4">
                {analytics.slice(0, 5).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <IssueTypeBadge issueType={item.issueType} />
                        <SeverityBadge severity={item.severity} />
                      </div>
                      <div className="h-2 rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className="h-2 rounded-full transition-all duration-500"
                          style={{
                            width: `${item.slaCompliancePct}%`,
                            backgroundColor: item.slaCompliancePct >= 95 ? '#10b981' : item.slaCompliancePct >= 80 ? '#f59e0b' : '#ef4444',
                          }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {item.slaCompliancePct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Breaches */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Active SLA Breaches
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeBreaches.length === 0 ? (
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-2" />
              <p className="text-gray-500">No active SLA breaches — all issues are within SLA</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-800 dark:text-gray-300">
                  <tr>
                    <th className="px-4 py-3">Issue</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Breach Type</th>
                    <th className="px-4 py-3">Target</th>
                    <th className="px-4 py-3">Actual</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeBreaches.map((breach) => (
                    <tr key={breach.id} className="border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-3 font-mono text-xs">{breach.issueId.slice(0, 8)}...</td>
                      <td className="px-4 py-3"><IssueTypeBadge issueType={breach.issueType} /></td>
                      <td className="px-4 py-3"><SeverityBadge severity={breach.severity} /></td>
                      <td className="px-4 py-3 capitalize">{breach.breachType.replace('_', ' ')}</td>
                      <td className="px-4 py-3">{breach.targetMins}m</td>
                      <td className="px-4 py-3 text-red-600 font-medium">{breach.actualMins}m</td>
                      <td className="px-4 py-3"><StatusBadge status={breach.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Escalation Events */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-orange-600" />
            Recent Escalation Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No recent escalation events.</p>
          ) : (
            <div className="space-y-3">
              {recentEvents.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-4 rounded-lg border border-gray-100 p-3 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div className={`p-2 rounded-full ${
                    event.severity === 'critical' ? 'bg-red-100 text-red-600' :
                    event.severity === 'high' ? 'bg-orange-100 text-orange-600' :
                    'bg-blue-100 text-blue-600'
                  }`}>
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <IssueTypeBadge issueType={event.issueType} />
                      <SeverityBadge severity={event.severity} />
                      <span className="text-xs text-gray-400">
                        {event.fromLevel} → {event.toLevel}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{event.reason}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(event.createdAt).toLocaleString()}
                      {event.acknowledgedAt && ' • Acknowledged'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
