"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDisputes } from "@/lib/hooks/useDisputes";
import type { CreateDisputeForm, DisputeReason } from "@/types/disputes";
import { disputeReasonLabels } from "@/lib/mock-data/disputes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, AlertTriangle, Upload, X, FileText } from "lucide-react";
import Link from "next/link";

const REASONS = Object.entries(disputeReasonLabels) as [DisputeReason, string][];

interface EvidenceFile {
  file: File;
  description: string;
  preview?: string;
}

export default function NewDisputePage() {
  const router = useRouter();
  const { createDispute } = useDisputes();

  const [form, setForm] = useState<Partial<CreateDisputeForm>>({
    currency: "USDC",
  });
  const [evidenceFiles, setEvidenceFiles] = useState<EvidenceFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!form.paymentId?.trim()) e.paymentId = "Payment ID is required";
    if (!form.respondentId?.trim()) e.respondentId = "Respondent ID is required";
    if (!form.reason) e.reason = "Please select a reason";
    if (!form.amount || form.amount <= 0) e.amount = "Enter a valid amount";
    if (!form.description?.trim() || form.description.length < 20)
      e.description = "Provide a description (at least 20 characters)";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const newFiles: EvidenceFile[] = Array.from(files)
      .slice(0, 5 - evidenceFiles.length)
      .map((file) => ({ file, description: "" }));
    setEvidenceFiles((prev) => [...prev, ...newFiles]);
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const dispute = await createDispute(form as CreateDisputeForm);
      router.push(`/dashboard/disputes/${dispute.id}`);
    } catch (e) {
      setErrors({ submit: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      {/* Back */}
      <Link
        href="/dashboard/disputes"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Disputes
      </Link>

      <div>
        <h1 className="text-2xl font-bold">File a Dispute</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Disputes are reviewed by our arbitration team. Provide as much detail
          as possible to expedite resolution.
        </p>
      </div>

      {/* Info banner */}
      <div className="flex gap-3 rounded-lg bg-amber-50 border border-amber-200 p-4">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium mb-1">Before filing</p>
          <p>
            Funds remain in escrow during dispute review. The respondent has{" "}
            <strong>72 hours</strong> to reply before the case is escalated.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="paymentId">Payment ID *</Label>
              <Input
                id="paymentId"
                placeholder="pay_abc123"
                value={form.paymentId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, paymentId: e.target.value }))
                }
              />
              {errors.paymentId && (
                <p className="text-xs text-destructive">{errors.paymentId}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="respondentId">Respondent (Payee) ID *</Label>
              <Input
                id="respondentId"
                placeholder="user_xyz"
                value={form.respondentId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, respondentId: e.target.value }))
                }
              />
              {errors.respondentId && (
                <p className="text-xs text-destructive">{errors.respondentId}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">Disputed Amount *</Label>
              <div className="flex gap-2">
                <Input
                  id="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amount ?? ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, amount: parseFloat(e.target.value) }))
                  }
                  className="flex-1"
                />
                <Select
                  value={form.currency ?? "USDC"}
                  onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USDC">USDC</SelectItem>
                    <SelectItem value="USDT">USDT</SelectItem>
                    <SelectItem value="ETH">ETH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {errors.amount && (
                <p className="text-xs text-destructive">{errors.amount}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason *</Label>
              <Select
                value={form.reason ?? ""}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, reason: v as DisputeReason }))
                }
              >
                <SelectTrigger id="reason">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {REASONS.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.reason && (
                <p className="text-xs text-destructive">{errors.reason}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description *</Label>
            <textarea
              id="description"
              rows={4}
              placeholder="Describe the issue in detail. Include dates, agreed deliverables, and what went wrong..."
              value={form.description ?? ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
            />
            <div className="flex justify-between">
              {errors.description && (
                <p className="text-xs text-destructive">{errors.description}</p>
              )}
              <p className="text-xs text-muted-foreground ml-auto">
                {form.description?.length ?? 0} chars
              </p>
            </div>
          </div>

          {/* Optional link fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="projectId">Project ID (optional)</Label>
              <Input
                id="projectId"
                placeholder="proj_abc"
                value={form.projectId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, projectId: e.target.value || undefined }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoiceId">Invoice ID (optional)</Label>
              <Input
                id="invoiceId"
                placeholder="inv_abc"
                value={form.invoiceId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, invoiceId: e.target.value || undefined }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Evidence Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evidence (optional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
              dragOver
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/30 hover:border-muted-foreground/50"
            }`}
          >
            <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium">Drop files here or click to upload</p>
            <p className="text-xs text-muted-foreground mt-1">
              PDF, images, documents â€” up to 5 files, 10MB each
            </p>
            <input
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt"
              className="hidden"
              id="evidenceUpload"
              onChange={(e) => handleFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() => document.getElementById("evidenceUpload")?.click()}
            >
              Choose Files
            </Button>
          </div>

          {evidenceFiles.length > 0 && (
            <div className="space-y-2">
              {evidenceFiles.map((ef, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 rounded-md border bg-muted/30"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{ef.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(ef.file.size / 1024).toFixed(0)} KB
                    </p>
                    <Input
                      placeholder="Describe this file..."
                      value={ef.description}
                      onChange={(e) =>
                        setEvidenceFiles((prev) =>
                          prev.map((f, j) =>
                            j === i ? { ...f, description: e.target.value } : f
                          )
                        )
                      }
                      className="mt-2 text-sm h-8"
                    />
                  </div>
                  <button
                    onClick={() =>
                      setEvidenceFiles((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {errors.submit && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">
          {errors.submit}
        </div>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="outline" asChild>
          <Link href="/dashboard/disputes">Cancel</Link>
        </Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Filing..." : "File Dispute"}
        </Button>
      </div>
    </div>
  );
}


