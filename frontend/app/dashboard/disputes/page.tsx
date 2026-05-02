"use client";

import { useState } from "react";
import Link from "next/link";
import { useDisputes } from "@/lib/hooks/useDisputes";
import {
  disputeStatusConfig,
  disputeReasonLabels,
} from "@/lib/mock-data/disputes";
import type { DisputeStatus } from "@/types/disputes";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  ChevronRight,
  Plus,
  Filter,
} from "lucide-react";

const STATUS_TABS: { label: string; value: DisputeStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Awaiting Response", value: "awaiting_response" },
  { label: "Under Review", value: "under_review" },
  { label: "Escalated", value: "escalated" },
  { label: "Resolved", value: "resolved" },
  { label: "Dismissed", value: "dismissed" },
];

function StatusBadge({ status }: { status: DisputeStatus }) {
  const cfg = disputeStatusConfig[status];
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}

function formatTimeLeft(deadline: string): string {
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return "Overdue";
  const hours = Math.floor(diff / 3600000);
  if (hours < 24) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

function DisputeCardSkeleton() {
  return (
    <Card className="animate-pulse">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function DisputesPage() {
  const { disputes, loading, error } = useDisputes();
  const [activeTab, setActiveTab] = useState<DisputeStatus | "all">("all");

  const filtered =
    activeTab === "all"
      ? disputes
      : disputes.filter((d) => d.status === activeTab);

  const stats = {
    total: disputes.length,
    open: disputes.filter((d) =>
      ["awaiting_response", "under_review", "escalated"].includes(d.status)
    ).length,
    resolved: disputes.filter((d) => d.status === "resolved").length,
    escalated: disputes.filter((d) => d.status === "escalated").length,
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Disputes</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage payment disputes and arbitration requests
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/disputes/new">
            <Plus className="mr-2 h-4 w-4" />
            File Dispute
          </Link>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Total", value: stats.total, icon: Filter, color: "text-foreground" },
          {
            label: "Open",
            value: stats.open,
            icon: Clock,
            color: "text-orange-600",
          },
          {
            label: "Escalated",
            value: stats.escalated,
            icon: AlertTriangle,
            color: "text-red-600",
          },
          {
            label: "Resolved",
            value: stats.resolved,
            icon: CheckCircle,
            color: "text-green-600",
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <s.icon className={`h-5 w-5 ${s.color}`} />
              <div>
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-xl font-bold">{s.value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Dispute list */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <DisputeCardSkeleton key={i} />)
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="p-12 flex flex-col items-center text-center">
              <CheckCircle className="h-12 w-12 text-muted-foreground mb-3 opacity-40" />
              <p className="font-medium text-muted-foreground">No disputes found</p>
              <p className="text-sm text-muted-foreground mt-1">
                {activeTab === "all"
                  ? "You have no disputes. File one if a payment issue arises."
                  : `No disputes with status "${disputeStatusConfig[activeTab as DisputeStatus]?.label}"`}
              </p>
            </CardContent>
          </Card>
        ) : (
          filtered.map((dispute) => (
            <Link key={dispute.id} href={`/dashboard/disputes/${dispute.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer border hover:border-primary/30">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-mono text-muted-foreground">
                          #{dispute.id}
                        </span>
                        <StatusBadge status={dispute.status} />
                      </div>
                      <p className="font-medium text-sm truncate">
                        {disputeReasonLabels[dispute.reason]}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                        {dispute.description}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        <span>
                          {dispute.amount} {dispute.currency}
                        </span>
                        {["awaiting_response", "under_review"].includes(
                          dispute.status
                        ) && (
                          <span className="flex items-center gap-1 text-orange-600">
                            <Clock className="h-3 w-3" />
                            {formatTimeLeft(dispute.responseDeadline)}
                          </span>
                        )}
                        <span>
                          {new Date(dispute.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-1" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
