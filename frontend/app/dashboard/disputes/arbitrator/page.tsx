"use client";

import { useState } from "react";
import Link from "next/link";
import { useDisputes } from "@/lib/hooks/useDisputes";
import {
  disputeStatusConfig,
  disputeReasonLabels,
} from "@/lib/mock-data/disputes";
import type { DisputeStatus } from "@/types/disputes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  Clock,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  TrendingUp,
  Users,
  RefreshCw,
} from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}
function StatCard({ title, value, sub, icon: Icon, color }: StatCardProps) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-4">
        <div className={`p-2 rounded-lg bg-muted ${color ?? ""}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

const STATUS_ORDER: DisputeStatus[] = [
  "escalated",
  "awaiting_response",
  "under_review",
  "pending",
  "resolved",
  "dismissed",
];

const PRIORITY_STATUSES = ["escalated", "awaiting_response"];

export default function ArbitratorDashboardPage() {
  const { disputes, loading, refetch } = useDisputes();
  const [filterStatus, setFilterStatus] = useState<DisputeStatus | "all">("all");
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // Analytics
  const total = disputes.length;
  const open = disputes.filter((d) =>
    ["awaiting_response", "under_review", "escalated", "pending"].includes(d.status)
  ).length;
  const escalated = disputes.filter((d) => d.status === "escalated").length;
  const resolved = disputes.filter((d) => d.status === "resolved").length;
  const totalRefunded = disputes.reduce((sum, d) => sum + (d.refundAmount ?? 0), 0);
  const escalationRate = total > 0 ? ((escalated / total) * 100).toFixed(1) : "0";

  const reasonCounts = disputes.reduce(
    (acc, d) => {
      acc[d.reason] = (acc[d.reason] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

  // Filter + sort
  const filtered = disputes
    .filter((d) => filterStatus === "all" || d.status === filterStatus)
    .sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.status);
      const bi = STATUS_ORDER.indexOf(b.status);
      if (ai !== bi) return ai - bi;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  const priorityQueue = filtered.filter((d) =>
    PRIORITY_STATUSES.includes(d.status)
  );
  const otherQueue = filtered.filter(
    (d) => !PRIORITY_STATUSES.includes(d.status)
  );

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const h = Math.floor(diff / 3600000);
    if (h < 1) return "just now";
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function hoursUntil(dateStr: string) {
    const h = Math.floor(
      (new Date(dateStr).getTime() - Date.now()) / 3600000
    );
    if (h < 0) return "Overdue";
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Arbitrator Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review and resolve payment disputes
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Analytics cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard title="Total Disputes" value={total} icon={BarChart3} />
        <StatCard
          title="Open"
          value={open}
          icon={Clock}
          color="text-orange-600"
        />
        <StatCard
          title="Escalated"
          value={escalated}
          icon={AlertTriangle}
          color="text-red-600"
          sub="Needs urgent review"
        />
        <StatCard
          title="Resolved"
          value={resolved}
          icon={CheckCircle}
          color="text-green-600"
        />
        <StatCard
          title="Escalation Rate"
          value={`${escalationRate}%`}
          icon={TrendingUp}
          sub="Of all disputes"
        />
        <StatCard
          title="Total Refunded"
          value={`${totalRefunded.toFixed(0)} USDC`}
          icon={Users}
        />
      </div>

      {/* Top reason + status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">By Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {STATUS_ORDER.map((status) => {
                const count = disputes.filter((d) => d.status === status).length;
                const pct = total > 0 ? (count / total) * 100 : 0;
                const cfg = disputeStatusConfig[status];
                return (
                  <div key={status} className="flex items-center gap-3">
                    <span
                      className={`text-xs font-medium w-32 ${cfg.color}`}
                    >
                      {cfg.label}
                    </span>
                    <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${cfg.bg.replace("bg-", "bg-").replace("-100", "-400")}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">
              By Dispute Reason
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(disputeReasonLabels).map(([key, label]) => {
                const count = reasonCounts[key] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs font-medium w-40 truncate">
                      {label}
                    </span>
                    <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary/50"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Dispute Queue</h2>
          <div className="flex gap-2 flex-wrap">
            {(["all", ...STATUS_ORDER] as (DisputeStatus | "all")[]).map(
              (s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                    filterStatus === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {s === "all"
                    ? "All"
                    : disputeStatusConfig[s as DisputeStatus].label}
                </button>
              )
            )}
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : (
          <>
            {priorityQueue.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-destructive uppercase tracking-wide mb-2">
                  ⚠  Priority â€” Requires Immediate Attention
                </p>
                <div className="space-y-2">
                  {priorityQueue.map((d) => (
                    <Link
                      key={d.id}
                      href={`/dashboard/disputes/${d.id}`}
                      className="block"
                    >
                      <Card className="border-destructive/30 hover:shadow-md transition-shadow cursor-pointer">
                        <CardContent className="p-4 flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-xs text-muted-foreground">
                                {d.id}
                              </span>
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded-full ${disputeStatusConfig[d.status].bg} ${disputeStatusConfig[d.status].color}`}
                              >
                                {disputeStatusConfig[d.status].label}
                              </span>
                            </div>
                            <p className="text-sm font-medium">
                              {disputeReasonLabels[d.reason]}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {d.description}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold">
                              {d.amount} {d.currency}
                            </p>
                            <p className="text-xs text-destructive">
                              Deadline: {hoursUntil(d.responseDeadline)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {timeAgo(d.createdAt)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {otherQueue.length > 0 && (
              <div>
                {priorityQueue.length > 0 && (
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    Other Disputes
                  </p>
                )}
                <div className="space-y-2">
                  {otherQueue.map((d) => (
                    <Link
                      key={d.id}
                      href={`/dashboard/disputes/${d.id}`}
                      className="block"
                    >
                      <Card className="hover:shadow-md transition-shadow cursor-pointer">
                        <CardContent className="p-4 flex items-center gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-mono text-xs text-muted-foreground">
                                {d.id}
                              </span>
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded-full ${disputeStatusConfig[d.status].bg} ${disputeStatusConfig[d.status].color}`}
                              >
                                {disputeStatusConfig[d.status].label}
                              </span>
                            </div>
                            <p className="text-sm font-medium">
                              {disputeReasonLabels[d.reason]}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-bold">
                              {d.amount} {d.currency}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {timeAgo(d.createdAt)}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <Card>
                <CardContent className="p-12 text-center">
                  <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3 opacity-50" />
                  <p className="font-medium text-muted-foreground">
                    No disputes in this queue
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}


