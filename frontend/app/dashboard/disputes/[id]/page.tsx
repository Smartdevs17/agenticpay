"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useDisputeById } from "@/lib/hooks/useDisputes";
import {
  disputeStatusConfig,
  disputeReasonLabels,
} from "@/lib/mock-data/disputes";
import type { ResolutionOutcome } from "@/types/disputes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  FileText,
  MessageSquare,
  Upload,
  Clock,
  User,
  Bot,
  CheckCircle2,
  AlertTriangle,
  X,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const cfg =
    disputeStatusConfig[status as keyof typeof disputeStatusConfig] ?? {
      label: status,
      color: "text-gray-600",
      bg: "bg-gray-100",
    };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.bg} ${cfg.color}`}
    >
      {cfg.label}
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const MOCK_CURRENT_USER = "user_001"; // In production: get from auth store

export default function DisputeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const { dispute, loading, error, setDispute } = useDisputeById(id);

  const [responseText, setResponseText] = useState("");
  const [respondSubmitting, setRespondSubmitting] = useState(false);
  const [evidenceDesc, setEvidenceDesc] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceSubmitting, setEvidenceSubmitting] = useState(false);

  // Resolve modal state (arbitrator)
  const [resolveOpen, setResolveOpen] = useState(false);
  const [outcome, setOutcome] = useState<ResolutionOutcome>("full_refund");
  const [resolveNote, setResolveNote] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [resolveSubmitting, setResolveSubmitting] = useState(false);

  async function handleRespond() {
    if (!responseText.trim() || !dispute) return;
    setRespondSubmitting(true);
    // In production: call respondToDispute from useDisputes hook
    await new Promise((r) => setTimeout(r, 800));
    const msg = {
      id: `msg_${Date.now()}`,
      disputeId: dispute.id,
      senderId: MOCK_CURRENT_USER,
      senderRole: "payee" as const,
      content: responseText,
      timestamp: new Date().toISOString(),
    };
    setDispute({
      ...dispute,
      status: "under_review",
      messages: [...dispute.messages, msg],
    });
    setResponseText("");
    setRespondSubmitting(false);
  }

  async function handleEvidenceSubmit() {
    if (!evidenceFile || !evidenceDesc.trim() || !dispute) return;
    setEvidenceSubmitting(true);
    await new Promise((r) => setTimeout(r, 600));
    const ev = {
      id: `ev_${Date.now()}`,
      disputeId: dispute.id,
      submittedBy: MOCK_CURRENT_USER,
      fileUrl: URL.createObjectURL(evidenceFile),
      fileName: evidenceFile.name,
      fileType: evidenceFile.type,
      fileSize: evidenceFile.size,
      description: evidenceDesc,
      timestamp: new Date().toISOString(),
      hash: `mock_${Date.now()}`,
    };
    setDispute({ ...dispute, evidence: [...dispute.evidence, ev] });
    setEvidenceFile(null);
    setEvidenceDesc("");
    setEvidenceSubmitting(false);
  }

  async function handleResolve() {
    if (!resolveNote.trim() || !dispute) return;
    setResolveSubmitting(true);
    await new Promise((r) => setTimeout(r, 800));
    setDispute({
      ...dispute,
      status: outcome === "dismissed" ? "dismissed" : "resolved",
      resolution: outcome,
      resolutionNote: resolveNote,
      refundAmount: refundAmount ? parseFloat(refundAmount) : undefined,
      resolvedAt: new Date().toISOString(),
    });
    setResolveOpen(false);
    setResolveSubmitting(false);
  }

  const isParty =
    dispute?.filedBy === MOCK_CURRENT_USER ||
    dispute?.respondentId === MOCK_CURRENT_USER;
  const isRespondent = dispute?.respondentId === MOCK_CURRENT_USER;
  const canRespond =
    isRespondent &&
    ["awaiting_response", "under_review"].includes(dispute?.status ?? "");
  const isClosed =
    dispute?.status === "resolved" || dispute?.status === "dismissed";

  if (loading) {
    return (
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !dispute) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Card>
          <CardContent className="p-12 text-center">
            <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-3 opacity-50" />
            <p className="font-medium">Dispute not found</p>
            <Button variant="outline" className="mt-4" asChild>
              <Link href="/dashboard/disputes">Back to Disputes</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const deadline = new Date(dispute.responseDeadline);
  const hoursLeft = Math.floor((deadline.getTime() - Date.now()) / 3600000);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link
            href="/dashboard/disputes"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Disputes
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-mono">{dispute.id}</h1>
            <StatusBadge status={dispute.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            Filed {timeAgo(dispute.createdAt)} ·{" "}
            {disputeReasonLabels[dispute.reason]}
          </p>
        </div>
        {/* Arbitrator resolve button */}
        {!isClosed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setResolveOpen(true)}
          >
            Resolve
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: main info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Details */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold">
                Dispute Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Payment ID</p>
                  <p className="font-mono font-medium">{dispute.paymentId}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Amount</p>
                  <p className="font-bold text-base">
                    {dispute.amount} {dispute.currency}
                  </p>
                </div>
                {dispute.projectId && (
                  <div>
                    <p className="text-muted-foreground text-xs">Project</p>
                    <p className="font-mono">{dispute.projectId}</p>
                  </div>
                )}
                {dispute.invoiceId && (
                  <div>
                    <p className="text-muted-foreground text-xs">Invoice</p>
                    <p className="font-mono">{dispute.invoiceId}</p>
                  </div>
                )}
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Description</p>
                <p className="text-sm leading-relaxed">{dispute.description}</p>
              </div>

              {isClosed && (
                <div className="rounded-lg bg-muted/50 border p-4">
                  <p className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">
                    Resolution
                  </p>
                  <p className="text-sm font-medium capitalize">
                    {dispute.resolution.replace(/_/g, " ")}
                  </p>
                  {dispute.refundAmount && (
                    <p className="text-sm text-muted-foreground">
                      Refund: {dispute.refundAmount} {dispute.currency}
                    </p>
                  )}
                  {dispute.resolutionNote && (
                    <p className="text-sm mt-2 text-muted-foreground">
                      {dispute.resolutionNote}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline / Messages */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {dispute.messages.map((msg) => (
                  <div key={msg.id} className="flex gap-3">
                    <div className="flex-shrink-0 mt-0.5">
                      {msg.senderRole === "system" ? (
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium capitalize">
                          {msg.senderRole === "system" ? "System" : msg.senderRole}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(msg.timestamp)}
                        </span>
                      </div>
                      <p className="text-sm mt-0.5 text-muted-foreground">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Response box */}
              {canRespond && (
                <div className="mt-6 pt-4 border-t space-y-3">
                  <p className="text-sm font-medium">Your Response</p>
                  <textarea
                    rows={4}
                    placeholder="Provide your response to this dispute..."
                    value={responseText}
                    onChange={(e) => setResponseText(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <Button
                    onClick={handleRespond}
                    disabled={!responseText.trim() || respondSubmitting}
                    size="sm"
                  >
                    {respondSubmitting ? "Sending..." : "Submit Response"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: sidebar */}
        <div className="space-y-5">
          {/* Deadlines */}
          {!isClosed && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Deadlines
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">
                    Response Deadline
                  </p>
                  <p
                    className={`font-medium ${hoursLeft < 12 ? "text-destructive" : ""}`}
                  >
                    {deadline.toLocaleDateString()} at{" "}
                    {deadline.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {hoursLeft > 0 ? `${hoursLeft}h remaining` : "Overdue"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    Escalation Deadline
                  </p>
                  <p className="font-medium">
                    {new Date(dispute.escalationDeadline).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Evidence */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" /> Evidence ({dispute.evidence.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dispute.evidence.length === 0 && (
                <p className="text-xs text-muted-foreground">No evidence uploaded yet.</p>
              )}
              {dispute.evidence.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-2 p-2 rounded border bg-muted/30"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <a
                      href={ev.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium hover:underline truncate block"
                    >
                      {ev.fileName}
                    </a>
                    <p className="text-xs text-muted-foreground">
                      {ev.description}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {timeAgo(ev.timestamp)}
                    </p>
                  </div>
                </div>
              ))}

              {/* Upload new evidence */}
              {!isClosed && isParty && (
                <div className="pt-2 border-t space-y-2">
                  <p className="text-xs font-medium">Add Evidence</p>
                  <input
                    type="file"
                    id="sidebarEvidenceUpload"
                    className="hidden"
                    onChange={(e) => setEvidenceFile(e.target.files?.[0] ?? null)}
                  />
                  {evidenceFile ? (
                    <div className="flex items-center gap-2 text-xs">
                      <FileText className="h-3.5 w-3.5" />
                      <span className="truncate flex-1">{evidenceFile.name}</span>
                      <button onClick={() => setEvidenceFile(null)}>
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() =>
                        document
                          .getElementById("sidebarEvidenceUpload")
                          ?.click()
                      }
                    >
                      <Upload className="h-3.5 w-3.5 mr-1" />
                      Choose File
                    </Button>
                  )}
                  {evidenceFile && (
                    <>
                      <input
                        className="w-full text-xs border rounded px-2 py-1.5 bg-background"
                        placeholder="Brief description..."
                        value={evidenceDesc}
                        onChange={(e) => setEvidenceDesc(e.target.value)}
                      />
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!evidenceDesc.trim() || evidenceSubmitting}
                        onClick={handleEvidenceSubmit}
                      >
                        {evidenceSubmitting ? "Uploading..." : "Upload"}
                      </Button>
                    </>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Resolve Modal */}
      {resolveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Resolve Dispute</CardTitle>
              <button onClick={() => setResolveOpen(false)}>
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Outcome</label>
                <select
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value as ResolutionOutcome)}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                >
                  <option value="full_refund">Full Refund to Payer</option>
                  <option value="partial_refund">Partial Refund</option>
                  <option value="release_to_payee">Release to Payee</option>
                  <option value="dismissed">Dismiss Dispute</option>
                </select>
              </div>

              {outcome === "partial_refund" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">
                    Refund Amount ({dispute.currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    max={dispute.amount}
                    step="0.01"
                    placeholder={`0 â€“ ${dispute.amount}`}
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Resolution Note *</label>
                <textarea
                  rows={3}
                  placeholder="Explain your decision..."
                  value={resolveNote}
                  onChange={(e) => setResolveNote(e.target.value)}
                  className="w-full border rounded-md px-3 py-2 text-sm bg-background resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setResolveOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!resolveNote.trim() || resolveSubmitting}
                  onClick={handleResolve}
                >
                  {resolveSubmitting ? "Resolving..." : "Confirm Resolution"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}


