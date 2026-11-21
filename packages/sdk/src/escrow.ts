import { AgenticPayClient } from './client.js';

export type EscrowStatus = 'draft' | 'funded' | 'active' | 'completed' | 'disputed' | 'cancelled';

export type EscrowMilestone = {
  id: string;
  title: string;
  description?: string;
  amount: number;
  completionCriteria: string;
  status: 'pending' | 'in_progress' | 'completed' | 'approved';
};

export type Escrow = {
  id: string;
  projectId: string;
  payerId: string;
  payeeId: string;
  currency: string;
  totalAmount: number;
  fundedAmount: number;
  status: EscrowStatus;
  milestones: EscrowMilestone[];
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type CreateEscrowInput = {
  projectId: string;
  payerId: string;
  payeeId: string;
  currency: string;
  totalAmount: number;
  milestones: {
    title: string;
    description?: string;
    amount: number;
    completionCriteria: string;
  }[];
  metadata?: Record<string, string>;
};

export type FundEscrowInput = {
  amount: number;
};

export type DisputeStatus = 'open' | 'responded' | 'resolved' | 'escalated';

export type Dispute = {
  id: string;
  escrowId?: string;
  paymentId?: string;
  raisedBy: string;
  reason: string;
  status: DisputeStatus;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDisputeInput = {
  escrowId?: string;
  paymentId?: string;
  reason: string;
  evidence?: string[];
};

export type DisputeResponseInput = {
  response: string;
  evidence?: string[];
};

export type DisputeResolveInput = {
  resolution: string;
  decision: 'payer' | 'payee' | 'split';
  splitPercentage?: number;
};

export class EscrowApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** Create a new escrow agreement. */
  create(input: CreateEscrowInput) {
    return this.client.post<Escrow>('/escrow', input);
  }

  /** Get escrow details by ID. */
  get(id: string) {
    return this.client.get<Escrow>(`/escrow/${id}`);
  }

  /** Fund an escrow. */
  fund(id: string, input: FundEscrowInput) {
    return this.client.post<Escrow>(`/escrow/${id}/fund`, input);
  }

  /** Confirm a milestone in an escrow. */
  confirmMilestone(escrowId: string, milestoneId: string) {
    return this.client.post<Escrow>(`/escrow/${escrowId}/milestones/${milestoneId}/confirm`);
  }

  /** List escrows for a project. */
  listByProject(projectId: string) {
    return this.client.get<Escrow[]>(`/escrow?projectId=${encodeURIComponent(projectId)}`);
  }
}

export class DisputesApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** File a dispute. */
  create(input: CreateDisputeInput) {
    return this.client.post<Dispute>('/disputes', input);
  }

  /** Get dispute details. */
  get(id: string) {
    return this.client.get<Dispute>(`/disputes/${id}`);
  }

  /** Respond to a dispute. */
  respond(id: string, input: DisputeResponseInput) {
    return this.client.post<Dispute>(`/disputes/${id}/respond`, input);
  }

  /** Resolve a dispute. */
  resolve(id: string, input: DisputeResolveInput) {
    return this.client.post<Dispute>(`/disputes/${id}/resolve`, input);
  }

  /** List disputes. */
  list(params?: { status?: DisputeStatus; limit?: number; offset?: number }) {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return this.client.get<Dispute[]>(`/disputes${suffix}`);
  }
}
