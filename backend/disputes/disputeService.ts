import crypto from "crypto";
import { prisma } from "../src/lib/prisma.js";
import { DisputeError } from "../src/middleware/errorHandler.js";
import type {
  CreateDisputeDto,
  Dispute,
  DisputeAnalytics,
  DisputeMessage,
  Evidence,
  ResolutionOutcome,
} from "./disputeModel.js";

const RESPONSE_HOURS = 72;
const ESCALATION_HOURS = 168;

// Disputes still "in play" — a payment can only have one of these open at
// once (see create()'s duplicate check).
const ACTIVE_STATUSES = ["awaiting_response", "under_review", "escalated"] as const;

function addHours(hours: number): Date {
  return new Date(Date.now() + hours * 3600_000);
}

interface UploadedFile {
  url: string;
  name: string;
  size: number;
  description?: string;
}

/** Row shape as Prisma returns it — Decimal/Date fields, JSON columns as unknown. */
type DisputeRow = Awaited<ReturnType<typeof prisma.dispute.findUniqueOrThrow>>;

/** Maps a Prisma Dispute row onto the public Dispute shape disputeModel.ts declares. */
function toDispute(row: DisputeRow): Dispute {
  return {
    id: row.id,
    paymentId: row.paymentId,
    projectId: row.projectId ?? undefined,
    invoiceId: row.invoiceId ?? undefined,
    filedBy: row.filedBy,
    respondentId: row.respondentId,
    arbitratorId: row.arbitratorId ?? undefined,
    status: row.status,
    reason: row.reason,
    amount: Number(row.amount),
    currency: row.currency,
    description: row.description,
    evidence: (row.evidence as unknown as Evidence[]) ?? [],
    messages: (row.messages as unknown as DisputeMessage[]) ?? [],
    resolution: row.resolution as ResolutionOutcome,
    resolutionNote: row.resolutionNote ?? undefined,
    refundAmount: row.refundAmount ? Number(row.refundAmount) : undefined,
    responseDeadline: row.responseDeadline.toISOString(),
    escalationDeadline: row.escalationDeadline.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  };
}

async function getOwnedDispute(tenantId: string, id: string) {
  const dispute = await prisma.dispute.findFirst({ where: { id, tenantId } });
  if (!dispute) {
    throw new DisputeError("Dispute not found", "DISPUTE_NOT_FOUND", 404);
  }
  return dispute;
}

export const disputeService = {
  /**
   * Files a new dispute against a payment. amount/currency are always
   * derived from the referenced Payment record rather than trusted from
   * the caller, so a dispute can't claim a different amount than what was
   * actually paid.
   */
  async create(dto: CreateDisputeDto, filedBy: string, tenantId: string): Promise<Dispute> {
    if (!dto.description || dto.description.length < 20) {
      throw new DisputeError(
        "Description must be at least 20 characters",
        "DISPUTE_DESCRIPTION_TOO_SHORT",
        400,
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { id: dto.paymentId, tenantId },
    });
    if (!payment) {
      throw new DisputeError("Payment not found", "DISPUTE_PAYMENT_NOT_FOUND", 404);
    }

    const existing = await prisma.dispute.findFirst({
      where: { paymentId: dto.paymentId, tenantId, status: { in: [...ACTIVE_STATUSES] } },
    });
    if (existing) {
      throw new DisputeError(
        "An active dispute already exists for this payment",
        "DISPUTE_ALREADY_ACTIVE",
        409,
      );
    }

    const row = await prisma.dispute.create({
      data: {
        tenantId,
        paymentId: dto.paymentId,
        projectId: dto.projectId ?? null,
        invoiceId: dto.invoiceId ?? null,
        filedBy,
        respondentId: dto.respondentId,
        status: "awaiting_response",
        reason: dto.reason,
        amount: payment.amount,
        currency: payment.currency,
        description: dto.description,
        evidence: [],
        messages: [],
        responseDeadline: addHours(RESPONSE_HOURS),
        escalationDeadline: addHours(ESCALATION_HOURS),
      },
    });

    // TODO(#816 follow-up): route through the real notification service
    // (see backend/payments/routing/notification-service.ts) instead of a
    // log line once this dispute flow has a resolved notification channel
    // for the respondent's own tenant/preferences.
    console.log(`[disputes] Notify ${dto.respondentId}: new dispute filed on payment ${dto.paymentId}`);

    return toDispute(row);
  },

  async respond(id: string, tenantId: string, senderId: string, content: string): Promise<Dispute> {
    const existing = await getOwnedDispute(tenantId, id);

    const messages = [...((existing.messages as unknown as DisputeMessage[]) ?? [])];
    messages.push({
      id: crypto.randomUUID(),
      disputeId: id,
      senderId,
      senderRole: senderId === existing.respondentId ? "payee" : "payer",
      content,
      timestamp: new Date().toISOString(),
    });

    const row = await prisma.dispute.update({
      where: { id },
      data: { messages, status: "under_review" },
    });

    return toDispute(row);
  },

  async addEvidence(id: string, tenantId: string, submittedBy: string, file: UploadedFile): Promise<Evidence> {
    const existing = await getOwnedDispute(tenantId, id);

    const hash = crypto
      .createHash("sha256")
      .update(`${file.name}-${file.size}-${Date.now()}`)
      .digest("hex");

    const entry: Evidence = {
      id: crypto.randomUUID(),
      disputeId: id,
      submittedBy,
      fileUrl: file.url,
      fileName: file.name,
      fileType: file.name.split(".").pop() ?? "unknown",
      fileSize: file.size,
      description: file.description ?? "",
      timestamp: new Date().toISOString(),
      hash,
    };

    const evidence = [...((existing.evidence as unknown as Evidence[]) ?? []), entry];
    await prisma.dispute.update({ where: { id }, data: { evidence } });

    return entry;
  },

  async resolve(
    id: string,
    tenantId: string,
    user: { id: string; role: string },
    payload: { outcome: ResolutionOutcome; resolutionNote: string; refundAmount?: number },
  ): Promise<Dispute> {
    if (user.role !== "arbitrator") {
      throw new DisputeError("Only an arbitrator can resolve a dispute", "DISPUTE_FORBIDDEN", 403);
    }

    await getOwnedDispute(tenantId, id);

    const row = await prisma.dispute.update({
      where: { id },
      data: {
        status: payload.outcome === "dismissed" ? "dismissed" : "resolved",
        resolution: payload.outcome,
        resolutionNote: payload.resolutionNote,
        refundAmount: payload.refundAmount ?? null,
        arbitratorId: user.id,
        resolvedAt: new Date(),
      },
    });

    return toDispute(row);
  },

  /**
   * Auto-escalates disputes whose respondent missed the response deadline.
   * Run on a schedule — see backend/src/config/scheduled-tasks.ts's
   * "dispute-escalation" task.
   */
  async processEscalations(): Promise<number> {
    const result = await prisma.dispute.updateMany({
      where: { status: "awaiting_response", responseDeadline: { lt: new Date() } },
      data: { status: "escalated" },
    });
    return result.count;
  },

  async getAnalytics(tenantId: string): Promise<DisputeAnalytics> {
    const disputes = await prisma.dispute.findMany({ where: { tenantId } });

    const byStatus: DisputeAnalytics["byStatus"] = {
      pending: 0,
      awaiting_response: 0,
      under_review: 0,
      resolved: 0,
      escalated: 0,
      dismissed: 0,
    };
    const byReason: DisputeAnalytics["byReason"] = {
      service_not_delivered: 0,
      partial_delivery: 0,
      quality_issue: 0,
      unauthorized_charge: 0,
      duplicate_charge: 0,
      other: 0,
    };

    let totalRefunded = 0;
    let resolvedCount = 0;
    let escalatedCount = 0;
    let totalResolutionDays = 0;

    for (const d of disputes) {
      byStatus[d.status as keyof typeof byStatus] += 1;
      byReason[d.reason as keyof typeof byReason] += 1;
      if (d.refundAmount) totalRefunded += Number(d.refundAmount);
      if (d.status === "escalated" || d.resolvedAt === null && d.escalationDeadline < new Date()) {
        escalatedCount += 1;
      }
      if (d.resolvedAt) {
        resolvedCount += 1;
        totalResolutionDays += (d.resolvedAt.getTime() - d.createdAt.getTime()) / 86_400_000;
      }
    }

    return {
      total: disputes.length,
      byStatus,
      byReason,
      averageResolutionDays: resolvedCount > 0 ? totalResolutionDays / resolvedCount : 0,
      totalRefunded,
      escalationRate: disputes.length > 0 ? escalatedCount / disputes.length : 0,
    };
  },
};
