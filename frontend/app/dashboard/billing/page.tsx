"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaymentAttempt {
  id: string;
  attemptNumber: number;
  scheduledAt: string;
  executedAt?: string;
  status: "pending" | "succeeded" | "failed";
  failureCategory?: string;
  failureMessage?: string;
  paymentMethodId: string;
}

interface RetryRecord {
  id: string;
  paymentId: string;
  userId: string;
  originalAmount: number;
  currency: string;
  status: "pending" | "scheduled" | "in_progress" | "succeeded" | "failed" | "abandoned";
  attempts: PaymentAttempt[];
  currentAttemptNumber: number;
  maxAttempts: number;
  nextRetryAt?: string;
  dunningStep: number;
  paymentMethodFallbackChain: string[];
  createdAt: string;
  updatedAt: string;
}

interface RetryStats {
  total: number;
  pending: number;
  scheduled: number;
  succeeded: number;
  failed: number;
  abandoned: number;
  recoveryRate: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(status: RetryRecord["status"]): string {
  const map: Record<RetryRecord["status"], string> = {
    pending: "bg-gray-100 text-gray-700",
    scheduled: "bg-blue-100 text-blue-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    succeeded: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    abandoned: "bg-gray-200 text-gray-500",
  };
  return map[status] ?? "bg-gray-100 text-gray-700";
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BillingPage() {
  const [retries, setRetries] = useState<RetryRecord[]>([]);
  const [stats, setStats] = useState<RetryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Demo userId — in production this comes from the auth context
  const demoUserId = "demo-user-001";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [retriesRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/payments/retry/user/${demoUserId}`),
        fetch(`${API_BASE}/payments/retry/stats`),
      ]);

      if (retriesRes.ok) {
        const data = await retriesRes.json();
        setRetries(data.data ?? []);
      }

      if (statsRes.ok) {
        const data = await statsRes.json();
        setStats(data.data);
      }
    } catch {
      setError("Failed to load billing data. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [demoUserId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRetryNow = async (retryId: string) => {
    setActionLoading(retryId);
    try {
      const res = await fetch(`${API_BASE}/payments/retry/${retryId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to execute retry");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleAbandon = async (retryId: string) => {
    if (!confirm("Are you sure you want to abandon this payment retry?")) return;
    setActionLoading(retryId);
    try {
      const res = await fetch(`${API_BASE}/payments/retry/${retryId}/abandon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to abandon retry");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const selected = retries.find((r) => r.id === selectedId);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Billing & Payments</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage failed payments and retry schedules
          </p>
        </div>
        <Button variant="outline" onClick={fetchData} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          {[
            { label: "Total", value: stats.total, color: "text-gray-900" },
            { label: "Scheduled", value: stats.scheduled, color: "text-blue-600" },
            { label: "Succeeded", value: stats.succeeded, color: "text-green-600" },
            { label: "Abandoned", value: stats.abandoned, color: "text-gray-500" },
            { label: "Failed", value: stats.failed, color: "text-red-600" },
            { label: "Pending", value: stats.pending, color: "text-yellow-600" },
            {
              label: "Recovery Rate",
              value: `${stats.recoveryRate}%`,
              color: stats.recoveryRate >= 60 ? "text-green-600" : "text-red-500",
            },
          ].map(({ label, value, color }) => (
            <Card key={label} className="p-3 text-center">
              <div className={`text-xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Retry list */}
        <div className="space-y-2">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            Payment Retries
          </h2>
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : retries.length === 0 ? (
            <Card className="p-6 text-center text-gray-400">
              No payment retries found.
            </Card>
          ) : (
            retries.map((retry) => (
              <Card
                key={retry.id}
                className={`p-4 cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 ${
                  selectedId === retry.id ? "ring-2 ring-blue-500" : ""
                }`}
                onClick={() => setSelectedId(retry.id === selectedId ? null : retry.id)}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-400 truncate">
                        {retry.paymentId}
                      </span>
                      <Badge
                        className={`text-xs px-1.5 py-0.5 rounded-full ${statusColor(retry.status)}`}
                      >
                        {retry.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
                      {formatCurrency(retry.originalAmount, retry.currency)}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      Attempt {retry.currentAttemptNumber}/{retry.maxAttempts}
                      {retry.nextRetryAt && (
                        <> · Next retry: {formatDate(retry.nextRetryAt)}</>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 ml-3 shrink-0">
                    {["scheduled", "pending"].includes(retry.status) && (
                      <Button
                        size="sm"
                        className="text-xs h-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetryNow(retry.id);
                        }}
                        disabled={actionLoading === retry.id}
                      >
                        Retry Now
                      </Button>
                    )}
                    {!["succeeded", "abandoned"].includes(retry.status) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7 text-red-500 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAbandon(retry.id);
                        }}
                        disabled={actionLoading === retry.id}
                      >
                        Abandon
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* Detail panel */}
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-2">
            Attempt History
          </h2>
          {!selected ? (
            <Card className="p-6 text-center text-gray-400">
              Select a retry to see its attempt history.
            </Card>
          ) : (
            <Card className="p-4 space-y-3">
              <div className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">Payment ID:</span>{" "}
                {selected.paymentId}
              </div>
              <div className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">Fallback methods:</span>{" "}
                {selected.paymentMethodFallbackChain.join(", ")}
              </div>
              <div className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">Dunning step:</span>{" "}
                {selected.dunningStep}
              </div>
              <hr className="border-gray-100 dark:border-gray-700" />
              {selected.attempts.length === 0 ? (
                <p className="text-xs text-gray-400">No attempts yet.</p>
              ) : (
                <div className="space-y-2">
                  {selected.attempts.map((attempt) => (
                    <div
                      key={attempt.id}
                      className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-2.5"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Attempt #{attempt.attemptNumber}</span>
                        <Badge
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            attempt.status === "succeeded"
                              ? "bg-green-100 text-green-700"
                              : attempt.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {attempt.status}
                        </Badge>
                      </div>
                      <div className="text-gray-500 mt-1">
                        Method: {attempt.paymentMethodId}
                      </div>
                      {attempt.failureCategory && (
                        <div className="text-red-500 mt-0.5">
                          {attempt.failureCategory}: {attempt.failureMessage}
                        </div>
                      )}
                      <div className="text-gray-400 mt-0.5">
                        {attempt.executedAt ? formatDate(attempt.executedAt) : "Pending"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
