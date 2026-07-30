"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

type ExportFormat = "json" | "csv" | "pdf";
type ExportStatus = "queued" | "processing" | "completed" | "failed" | "expired";
type ExportScope =
  | "full_account"
  | "payments"
  | "invoices"
  | "subscriptions"
  | "projects"
  | "analytics";
type ScheduleFrequency = "daily" | "weekly" | "monthly";

interface ExportJob {
  id: string;
  userId: string;
  format: ExportFormat;
  scope: ExportScope[];
  status: ExportStatus;
  anonymise: boolean;
  isGdprRequest: boolean;
  downloadUrl?: string;
  fileSizeBytes?: number;
  rowCount?: number;
  requestedAt: string;
  completedAt?: string;
  expiresAt?: string;
}

interface ScheduledExport {
  id: string;
  format: ExportFormat;
  scope: ExportScope[];
  frequency: ScheduleFrequency;
  anonymise: boolean;
  deliveryEmail: string;
  enabled: boolean;
  nextRunAt: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: ExportStatus): string {
  const map: Record<ExportStatus, string> = {
    queued: "bg-gray-100 text-gray-700",
    processing: "bg-yellow-100 text-yellow-700",
    completed: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    expired: "bg-gray-200 text-gray-400",
  };
  return map[s];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const SCOPES: ExportScope[] = [
  "full_account",
  "payments",
  "invoices",
  "subscriptions",
  "projects",
  "analytics",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ExportPage() {
  const [exports, setExports] = useState<ExportJob[]>([]);
  const [schedules, setSchedules] = useState<ScheduledExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"exports" | "schedules">("exports");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // New export form
  const [newFormat, setNewFormat] = useState<ExportFormat>("json");
  const [newScope, setNewScope] = useState<ExportScope[]>(["full_account"]);
  const [newAnonymise, setNewAnonymise] = useState(false);
  const [newGdpr, setNewGdpr] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // New schedule form
  const [schedFormat, setSchedFormat] = useState<ExportFormat>("csv");
  const [schedScope, setSchedScope] = useState<ExportScope[]>(["payments"]);
  const [schedFreq, setSchedFreq] = useState<ScheduleFrequency>("weekly");
  const [schedEmail, setSchedEmail] = useState("");
  const [schedAnonymise, setSchedAnonymise] = useState(false);
  const [schedSubmitting, setSchedSubmitting] = useState(false);

  const demoUserId = "demo-user-001";

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [exportsRes, schedulesRes] = await Promise.all([
        fetch(`${API_BASE}/data-export/user/${demoUserId}`),
        fetch(`${API_BASE}/data-export/schedules/user/${demoUserId}`),
      ]);

      if (exportsRes.ok) setExports((await exportsRes.json()).data ?? []);
      if (schedulesRes.ok) setSchedules((await schedulesRes.json()).data ?? []);
    } catch {
      setError("Failed to load export data.");
    } finally {
      setLoading(false);
    }
  }, [demoUserId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreateExport = async () => {
    if (newScope.length === 0) {
      setError("Select at least one data scope.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/data-export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: demoUserId,
          format: newFormat,
          scope: newScope,
          anonymise: newAnonymise,
          isGdprRequest: newGdpr,
          deliveryEmail: newEmail || undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccess(`Export queued (ID: ${data.data.id})`);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create export");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSchedule = async () => {
    if (!schedEmail) {
      setError("Delivery email is required for schedules.");
      return;
    }
    setSchedSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/data-export/schedules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: demoUserId,
          format: schedFormat,
          scope: schedScope,
          frequency: schedFreq,
          anonymise: schedAnonymise,
          deliveryEmail: schedEmail,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSuccess("Scheduled export created!");
      setSchedEmail("");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create schedule");
    } finally {
      setSchedSubmitting(false);
    }
  };

  const handleToggleScope = (
    scope: ExportScope,
    current: ExportScope[],
    setter: (v: ExportScope[]) => void,
  ) => {
    setter(
      current.includes(scope) ? current.filter((s) => s !== scope) : [...current, scope],
    );
  };

  const handleDeleteExport = async (id: string) => {
    if (!confirm("Delete this export?")) return;
    try {
      await fetch(`${API_BASE}/data-export/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: demoUserId }),
      });
      await fetchData();
    } catch {
      setError("Failed to delete export.");
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Data Export</h1>
        <p className="text-sm text-gray-500 mt-1">
          Export your data in JSON, CSV, or PDF format. GDPR-compliant portability included.
        </p>
      </div>

      {/* Alerts */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
          <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
          {success}
          <button className="ml-2 underline" onClick={() => setSuccess(null)}>Dismiss</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["exports", "schedules"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
              activeTab === tab
                ? "border-b-2 border-blue-500 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Exports tab */}
      {activeTab === "exports" && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Create form */}
          <Card className="p-4 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-200">New Export</h2>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Format</label>
              <div className="flex gap-2">
                {(["json", "csv", "pdf"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setNewFormat(f)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium uppercase transition-colors ${
                      newFormat === f ? "bg-blue-500 text-white border-blue-500" : "border-gray-200 text-gray-600"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Data Scope</label>
              <div className="flex flex-wrap gap-1.5">
                {SCOPES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleToggleScope(s, newScope, setNewScope)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                      newScope.includes(s)
                        ? "bg-blue-100 text-blue-700 border-blue-300"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newAnonymise}
                  onChange={(e) => setNewAnonymise(e.target.checked)}
                  className="rounded"
                />
                Anonymise personal data
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newGdpr}
                  onChange={(e) => setNewGdpr(e.target.checked)}
                  className="rounded"
                />
                GDPR portability request
              </label>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Delivery email (optional)
              </label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="text-sm"
              />
            </div>

            <Button
              onClick={handleCreateExport}
              disabled={submitting || newScope.length === 0}
              className="w-full"
            >
              {submitting ? "Queuing…" : "Queue Export"}
            </Button>
          </Card>

          {/* Export history */}
          <div className="space-y-2">
            <h2 className="font-semibold text-gray-800 dark:text-gray-200">Export History</h2>
            {loading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : exports.length === 0 ? (
              <Card className="p-6 text-center text-gray-400">No exports yet.</Card>
            ) : (
              exports.map((exp) => (
                <Card key={exp.id} className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={`text-xs px-2 py-0.5 ${statusColor(exp.status)}`}>
                          {exp.status}
                        </Badge>
                        <span className="text-xs font-medium uppercase text-gray-500">
                          {exp.format}
                        </span>
                        {exp.isGdprRequest && (
                          <Badge className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5">
                            GDPR
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {exp.scope.map((s) => s.replace("_", " ")).join(", ")}
                      </div>
                      {exp.rowCount != null && (
                        <div className="text-xs text-gray-400 mt-0.5">
                          {exp.rowCount} rows · {formatBytes(exp.fileSizeBytes ?? 0)}
                        </div>
                      )}
                      <div className="text-xs text-gray-400">
                        {formatDate(exp.requestedAt)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 ml-2 shrink-0">
                      {exp.status === "completed" && exp.downloadUrl && (
                        <a
                          href={exp.downloadUrl}
                          className="text-xs text-blue-600 underline"
                          download
                        >
                          Download
                        </a>
                      )}
                      <button
                        onClick={() => handleDeleteExport(exp.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      {/* Schedules tab */}
      {activeTab === "schedules" && (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Create schedule form */}
          <Card className="p-4 space-y-4">
            <h2 className="font-semibold text-gray-800 dark:text-gray-200">New Schedule</h2>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Format</label>
              <div className="flex gap-2">
                {(["json", "csv", "pdf"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSchedFormat(f)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium uppercase transition-colors ${
                      schedFormat === f ? "bg-blue-500 text-white border-blue-500" : "border-gray-200 text-gray-600"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Frequency</label>
              <div className="flex gap-2">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setSchedFreq(f)}
                    className={`text-xs px-3 py-1.5 rounded-lg border font-medium capitalize transition-colors ${
                      schedFreq === f ? "bg-blue-500 text-white border-blue-500" : "border-gray-200 text-gray-600"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Data Scope</label>
              <div className="flex flex-wrap gap-1.5">
                {SCOPES.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleToggleScope(s, schedScope, setSchedScope)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                      schedScope.includes(s)
                        ? "bg-blue-100 text-blue-700 border-blue-300"
                        : "border-gray-200 text-gray-500"
                    }`}
                  >
                    {s.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Delivery email *</label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={schedEmail}
                onChange={(e) => setSchedEmail(e.target.value)}
                className="text-sm"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={schedAnonymise}
                onChange={(e) => setSchedAnonymise(e.target.checked)}
                className="rounded"
              />
              Anonymise personal data
            </label>

            <Button
              onClick={handleCreateSchedule}
              disabled={schedSubmitting || !schedEmail}
              className="w-full"
            >
              {schedSubmitting ? "Creating…" : "Create Schedule"}
            </Button>
          </Card>

          {/* Schedule list */}
          <div className="space-y-2">
            <h2 className="font-semibold text-gray-800 dark:text-gray-200">Active Schedules</h2>
            {schedules.length === 0 ? (
              <Card className="p-6 text-center text-gray-400">No schedules configured.</Card>
            ) : (
              schedules.map((sched) => (
                <Card key={sched.id} className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-gray-800 capitalize">
                          {sched.frequency}
                        </span>
                        <Badge className="text-xs bg-gray-100 text-gray-500 uppercase px-2 py-0.5">
                          {sched.format}
                        </Badge>
                        {sched.enabled ? (
                          <Badge className="text-xs bg-green-100 text-green-700 px-2 py-0.5">Active</Badge>
                        ) : (
                          <Badge className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5">Paused</Badge>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {sched.scope.map((s) => s.replace("_", " ")).join(", ")}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        📧 {sched.deliveryEmail}
                      </div>
                      <div className="text-xs text-gray-400">
                        Next: {formatDate(sched.nextRunAt)}
                      </div>
                    </div>
                  </div>
                </Card>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
