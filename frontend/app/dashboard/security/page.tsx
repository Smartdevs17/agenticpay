"use client";

import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api/v1";

// ── Types ─────────────────────────────────────────────────────────────────────

type VulnerabilitySeverity = "critical" | "high" | "medium" | "low" | "info";
type VulnerabilityStatus = "open" | "in_progress" | "resolved" | "accepted" | "false_positive";
type ScanType = "sast" | "dast" | "dependency" | "smart_contract";

interface Vulnerability {
  id: string;
  title: string;
  description: string;
  severity: VulnerabilitySeverity;
  status: VulnerabilityStatus;
  scanType: ScanType;
  location: string;
  lineNumber?: number;
  cveId?: string;
  cvssScore?: number;
  remediation: string;
  assignedTo?: string;
  slaDueAt: string;
  resolvedAt?: string;
  detectedAt: string;
}

interface SecurityScore {
  overall: number;
  sast: number;
  dast: number;
  dependency: number;
  smartContract: number;
  trend: "improving" | "stable" | "degrading";
  lastCalculatedAt: string;
}

interface ScanReport {
  id: string;
  scanType: ScanType;
  triggeredBy: string;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  vulnerabilitiesFound: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function severityColor(s: VulnerabilitySeverity): string {
  const map: Record<VulnerabilitySeverity, string> = {
    critical: "bg-red-100 text-red-800",
    high: "bg-orange-100 text-orange-800",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-blue-100 text-blue-700",
    info: "bg-gray-100 text-gray-600",
  };
  return map[s];
}

function statusColor(s: VulnerabilityStatus): string {
  const map: Record<VulnerabilityStatus, string> = {
    open: "bg-red-50 text-red-700",
    in_progress: "bg-yellow-50 text-yellow-700",
    resolved: "bg-green-50 text-green-700",
    accepted: "bg-gray-50 text-gray-600",
    false_positive: "bg-gray-50 text-gray-500",
  };
  return map[s];
}

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}

function trendIcon(trend: SecurityScore["trend"]): string {
  if (trend === "improving") return "↗";
  if (trend === "degrading") return "↘";
  return "→";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

const REMEDIATION_STATUSES: VulnerabilityStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "accepted",
  "false_positive",
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SecurityPage() {
  const [score, setScore] = useState<SecurityScore | null>(null);
  const [vulns, setVulns] = useState<Vulnerability[]>([]);
  const [scans, setScans] = useState<ScanReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "vulnerabilities" | "scans">("overview");
  const [filterSeverity, setFilterSeverity] = useState<VulnerabilitySeverity | "all">("all");
  const [filterStatus, setFilterStatus] = useState<VulnerabilityStatus | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scoreRes, vulnsRes, scansRes] = await Promise.all([
        fetch(`${API_BASE}/security/score`),
        fetch(`${API_BASE}/security/vulnerabilities`),
        fetch(`${API_BASE}/security/scans`),
      ]);

      if (scoreRes.ok) setScore((await scoreRes.json()).data);
      if (vulnsRes.ok) setVulns((await vulnsRes.json()).data ?? []);
      if (scansRes.ok) setScans((await scansRes.json()).data ?? []);
    } catch {
      setError("Failed to load security data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredVulns = vulns.filter((v) => {
    if (filterSeverity !== "all" && v.severity !== filterSeverity) return false;
    if (filterStatus !== "all" && v.status !== filterStatus) return false;
    return true;
  });

  const handleUpdateStatus = async (id: string, status: VulnerabilityStatus) => {
    setUpdatingId(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/security/vulnerabilities/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleAssign = async (id: string) => {
    const assignee = assigneeDrafts[id]?.trim();
    if (!assignee) return;
    setUpdatingId(id);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/security/vulnerabilities/${id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: assignee }),
      });
      if (!res.ok) throw new Error("Failed to assign vulnerability");
      setAssigneeDrafts((prev) => ({ ...prev, [id]: "" }));
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to assign vulnerability");
    } finally {
      setUpdatingId(null);
    }
  };

  const openCritical = vulns.filter((v) => v.severity === "critical" && v.status === "open").length;
  const openHigh = vulns.filter((v) => v.severity === "high" && v.status === "open").length;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Security Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">
            Automated vulnerability scanning and remediation tracking
          </p>
        </div>
        <Button variant="outline" onClick={fetchData} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Score cards */}
      {score && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: "Overall", value: score.overall },
            { label: "SAST", value: score.sast },
            { label: "DAST", value: score.dast },
            { label: "Dependencies", value: score.dependency },
            { label: "Smart Contract", value: score.smartContract },
          ].map(({ label, value }) => (
            <Card key={label} className="p-3 text-center">
              <div className={`text-2xl font-bold ${scoreColor(value)}`}>{value}</div>
              <div className="text-xs text-gray-500 mt-0.5">{label}</div>
            </Card>
          ))}
          <Card className="p-3 text-center">
            <div className={`text-2xl font-bold ${
              score.trend === "improving" ? "text-green-600" : score.trend === "degrading" ? "text-red-600" : "text-gray-600"
            }`}>
              {trendIcon(score.trend)}
            </div>
            <div className="text-xs text-gray-500 mt-0.5 capitalize">{score.trend}</div>
          </Card>
        </div>
      )}

      {/* Alert bar */}
      {(openCritical > 0 || openHigh > 0) && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-red-600 font-bold text-lg">⚠</span>
          <span className="text-sm text-red-700">
            {openCritical > 0 && <><strong>{openCritical}</strong> critical</>}
            {openCritical > 0 && openHigh > 0 && " and "}
            {openHigh > 0 && <><strong>{openHigh}</strong> high</>}
            {" "}vulnerabilit{(openCritical + openHigh) === 1 ? "y" : "ies"} require immediate attention.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700">
        {(["overview", "vulnerabilities", "scans"] as const).map((tab) => (
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
            {tab === "vulnerabilities" && vulns.length > 0 && (
              <span className="ml-1 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                {vulns.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview */}
      {activeTab === "overview" && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
              Open Vulnerabilities by Severity
            </h3>
            {(["critical", "high", "medium", "low", "info"] as VulnerabilitySeverity[]).map(
              (sev) => {
                const count = vulns.filter((v) => v.severity === sev && v.status === "open").length;
                return (
                  <div key={sev} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs px-2 py-0.5 ${severityColor(sev)}`}>
                        {sev}
                      </Badge>
                    </div>
                    <span className="text-sm font-medium text-gray-700">{count}</span>
                  </div>
                );
              }
            )}
          </Card>

          <Card className="p-4">
            <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
              Scan Coverage
            </h3>
            {(["sast", "dast", "dependency", "smart_contract"] as ScanType[]).map((type) => {
              const latestScan = scans
                .filter((s) => s.scanType === type && s.status === "completed")
                .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
              return (
                <div key={type} className="flex items-center justify-between py-1.5">
                  <span className="text-sm text-gray-600 capitalize">{type.replace("_", " ")}</span>
                  {latestScan ? (
                    <span className="text-xs text-gray-500">{formatDate(latestScan.startedAt)}</span>
                  ) : (
                    <span className="text-xs text-gray-400">Not yet scanned</span>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* Vulnerabilities */}
      {activeTab === "vulnerabilities" && (
        <div className="space-y-3">
          {/* Filters */}
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Severity:</span>
              {(["all", "critical", "high", "medium", "low", "info"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterSeverity(s as any)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors capitalize ${
                    filterSeverity === s
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">Status:</span>
              {(["all", "open", "in_progress", "resolved"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s as any)}
                  className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                    filterStatus === s
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {s.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {filteredVulns.length === 0 ? (
            <Card className="p-6 text-center text-gray-400">
              No vulnerabilities match the selected filters.
            </Card>
          ) : (
            filteredVulns.map((v) => (
              <Card key={v.id} className="p-4">
                <div className="flex items-start justify-between flex-wrap gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 dark:text-white">{v.title}</span>
                      <Badge className={`text-xs px-2 py-0.5 ${severityColor(v.severity)}`}>
                        {v.severity}
                      </Badge>
                      <Badge className={`text-xs px-2 py-0.5 ${statusColor(v.status)}`}>
                        {v.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{v.description}</p>
                    <div className="text-xs text-gray-400 mt-1.5 flex flex-wrap gap-3">
                      <span>📍 {v.location}{v.lineNumber ? `:${v.lineNumber}` : ""}</span>
                      {v.cveId && <span>🔗 {v.cveId}</span>}
                      {v.cvssScore && <span>Score: {v.cvssScore}</span>}
                      <span>SLA due: {formatDate(v.slaDueAt)}</span>
                      {v.assignedTo && <span>👤 {v.assignedTo}</span>}
                    </div>
                    <p className="text-xs text-blue-600 mt-1.5">
                      💡 {v.remediation}
                    </p>

                    {/* Remediation controls */}
                    <div className="flex flex-wrap items-center gap-2 mt-3 pt-2 border-t border-gray-100">
                      <select
                        value={v.status}
                        disabled={updatingId === v.id}
                        onChange={(e) => handleUpdateStatus(v.id, e.target.value as VulnerabilityStatus)}
                        className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-600"
                      >
                        {REMEDIATION_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s.replace("_", " ")}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder="Assign to…"
                        value={assigneeDrafts[v.id] ?? ""}
                        onChange={(e) =>
                          setAssigneeDrafts((prev) => ({ ...prev, [v.id]: e.target.value }))
                        }
                        className="text-xs border border-gray-200 rounded-md px-2 py-1 w-28"
                      />
                      <button
                        onClick={() => handleAssign(v.id)}
                        disabled={updatingId === v.id || !assigneeDrafts[v.id]?.trim()}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium disabled:opacity-40"
                      >
                        Assign
                      </button>
                    </div>
                  </div>
                  <Badge className="text-xs bg-gray-100 text-gray-500 capitalize shrink-0">
                    {v.scanType.replace("_", " ")}
                  </Badge>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Scans */}
      {activeTab === "scans" && (
        <div className="space-y-3">
          {scans.length === 0 ? (
            <Card className="p-6 text-center text-gray-400">No scan reports found.</Card>
          ) : (
            scans.map((scan) => (
              <Card key={scan.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900 dark:text-white capitalize">
                        {scan.scanType.replace("_", " ")}
                      </span>
                      <Badge
                        className={`text-xs px-2 py-0.5 ${
                          scan.status === "completed"
                            ? "bg-green-100 text-green-700"
                            : scan.status === "failed"
                            ? "bg-red-100 text-red-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {scan.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {formatDate(scan.startedAt)} · triggered by {scan.triggeredBy}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="font-medium text-gray-700">
                      {scan.vulnerabilitiesFound} findings
                    </div>
                    <div className="text-gray-400 flex gap-1 justify-end mt-0.5">
                      {scan.critical > 0 && <span className="text-red-600">C:{scan.critical}</span>}
                      {scan.high > 0 && <span className="text-orange-600">H:{scan.high}</span>}
                      {scan.medium > 0 && <span className="text-yellow-600">M:{scan.medium}</span>}
                      {scan.low > 0 && <span className="text-blue-500">L:{scan.low}</span>}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
