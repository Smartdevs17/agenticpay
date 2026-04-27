import type { Dispute, DisputeStatus, DisputeReason } from "@/types/disputes";

export const mockDisputes: Dispute[] = [
  {
    id: "dsp_001",
    paymentId: "pay_abc123",
    projectId: "proj_001",
    filedBy: "user_001",
    respondentId: "user_002",
    status: "awaiting_response",
    reason: "service_not_delivered",
    amount: 1500,
    currency: "USDC",
    description:
      "The AI agent was supposed to complete data analysis within 48 hours. It has been 5 days with no output delivered.",
    evidence: [
      {
        id: "ev_001",
        disputeId: "dsp_001",
        submittedBy: "user_001",
        fileUrl: "#",
        fileName: "contract_terms.pdf",
        fileType: "application/pdf",
        fileSize: 245000,
        description: "Original project contract showing delivery timeline",
        timestamp: "2025-04-20T10:30:00Z",
        hash: "abc123def456",
      },
    ],
    messages: [
      {
        id: "msg_001",
        disputeId: "dsp_001",
        senderId: "system",
        senderRole: "system",
        content:
          "Dispute filed by payer. Reason: service not delivered. Respondent has 3 days to respond.",
        timestamp: "2025-04-20T10:30:00Z",
      },
    ],
    resolution: "pending",
    responseDeadline: "2025-04-23T10:30:00Z",
    escalationDeadline: "2025-04-27T10:30:00Z",
    createdAt: "2025-04-20T10:30:00Z",
    updatedAt: "2025-04-20T10:30:00Z",
  },
  {
    id: "dsp_002",
    paymentId: "pay_def456",
    invoiceId: "inv_003",
    filedBy: "user_003",
    respondentId: "user_001",
    status: "under_review",
    reason: "quality_issue",
    amount: 800,
    currency: "USDC",
    description:
      "The delivered code has multiple bugs and does not meet the specifications outlined in the requirements document.",
    evidence: [],
    messages: [
      {
        id: "msg_002",
        disputeId: "dsp_002",
        senderId: "system",
        senderRole: "system",
        content: "Dispute filed by payer. Reason: quality issue.",
        timestamp: "2025-04-18T14:00:00Z",
      },
      {
        id: "msg_003",
        disputeId: "dsp_002",
        senderId: "user_001",
        senderRole: "payee",
        content:
          "I acknowledge the issues and have deployed fixes. The main features are working. Some edge cases were not in the original spec.",
        timestamp: "2025-04-19T09:00:00Z",
      },
    ],
    resolution: "pending",
    responseDeadline: "2025-04-21T14:00:00Z",
    escalationDeadline: "2025-04-25T14:00:00Z",
    createdAt: "2025-04-18T14:00:00Z",
    updatedAt: "2025-04-19T09:00:00Z",
  },
  {
    id: "dsp_003",
    paymentId: "pay_ghi789",
    filedBy: "user_004",
    respondentId: "user_002",
    status: "resolved",
    reason: "duplicate_charge",
    amount: 200,
    currency: "USDC",
    description: "Charged twice for the same API call batch.",
    evidence: [],
    messages: [],
    resolution: "full_refund",
    resolutionNote:
      "Confirmed duplicate transaction. Full refund processed to payer.",
    refundAmount: 200,
    responseDeadline: "2025-04-15T10:00:00Z",
    escalationDeadline: "2025-04-19T10:00:00Z",
    createdAt: "2025-04-12T10:00:00Z",
    updatedAt: "2025-04-14T16:00:00Z",
    resolvedAt: "2025-04-14T16:00:00Z",
  },
];

export const disputeReasonLabels: Record<DisputeReason, string> = {
  service_not_delivered: "Service Not Delivered",
  partial_delivery: "Partial Delivery",
  quality_issue: "Quality Issue",
  unauthorized_charge: "Unauthorized Charge",
  duplicate_charge: "Duplicate Charge",
  other: "Other",
};

export const disputeStatusConfig: Record<
  DisputeStatus,
  { label: string; color: string; bg: string }
> = {
  pending: { label: "Pending", color: "text-yellow-700", bg: "bg-yellow-100" },
  awaiting_response: {
    label: "Awaiting Response",
    color: "text-orange-700",
    bg: "bg-orange-100",
  },
  under_review: {
    label: "Under Review",
    color: "text-blue-700",
    bg: "bg-blue-100",
  },
  resolved: { label: "Resolved", color: "text-green-700", bg: "bg-green-100" },
  escalated: { label: "Escalated", color: "text-red-700", bg: "bg-red-100" },
  dismissed: {
    label: "Dismissed",
    color: "text-gray-600",
    bg: "bg-gray-100",
  },
};
