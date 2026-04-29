import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

const disputes = new Map();

const RESPONSE_HOURS = 72;
const ESCALATION_HOURS = 168;

function addHours(hours: number) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

export const disputeService = {
  async create(dto, filedBy) {
    if (!dto.description || dto.description.length < 20) {
      throw new Error("Description must be at least 20 characters");
    }

    const existing = Array.from(disputes.values()).find(
      (d) =>
        d.paymentId === dto.paymentId &&
        ["awaiting_response", "under_review", "escalated"].includes(d.status)
    );

    if (existing) throw new Error("Active dispute already exists");

    const dispute = {
      id: uuidv4(),
      ...dto,
      filedBy,
      status: "awaiting_response",
      evidence: [],
      messages: [],
      responseDeadline: addHours(RESPONSE_HOURS),
      escalationDeadline: addHours(ESCALATION_HOURS),
      createdAt: new Date().toISOString(),
    };

    disputes.set(dispute.id, dispute);

    console.log(`Notify ${dto.respondentId}: New dispute`);

    return dispute;
  },

  async respond(id, userId, content) {
    const d = disputes.get(id);
    if (!d) throw new Error("Not found");

    d.messages.push({
      id: uuidv4(),
      senderId: userId,
      content,
      timestamp: new Date().toISOString(),
    });

    d.status = "under_review";
    return d;
  },

  async addEvidence(id, userId, file) {
    const d = disputes.get(id);
    if (!d) throw new Error("Not found");

    const hash = crypto
      .createHash("sha256")
      .update(`${file.name}-${file.size}-${Date.now()}`)
      .digest("hex");

    const ev = {
      id: uuidv4(),
      fileUrl: file.url,
      fileName: file.name,
      fileSize: file.size,
      description: file.description,
      hash,
      timestamp: new Date().toISOString(),
    };

    d.evidence.push(ev);
    return ev;
  },

  async resolve(id, user, payload) {
    if (user.role !== "arbitrator") {
      throw new Error("Forbidden");
    }

    const d = disputes.get(id);
    if (!d) throw new Error("Not found");

    d.status = payload.outcome === "dismissed" ? "dismissed" : "resolved";
    d.resolution = payload.outcome;
    d.resolutionNote = payload.note;

    return d;
  },

  async processEscalations() {
    const now = new Date();
    let count = 0;

    for (const d of disputes.values()) {
      if (
        d.status === "awaiting_response" &&
        new Date(d.responseDeadline) < now
      ) {
        d.status = "escalated";
        count++;
      }
    }

    return count;
  },
};