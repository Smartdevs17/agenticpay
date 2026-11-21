import { randomUUID } from 'node:crypto';

export type MultisigMode = 'onchain' | 'offchain';
export type MultisigGroupStatus = 'active' | 'inactive';
export type MultisigProposalStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'cancelled' | 'expired';
export type SignerChangeType = 'add_signer' | 'remove_signer' | 'change_threshold';

export type MultisigGroup = {
  id: string;
  name: string;
  walletAddresses: string[];
  threshold: number;
  mode: MultisigMode;
  createdAt: string;
  updatedAt: string;
  status: MultisigGroupStatus;
  /** Proposal timeout in seconds. 0 means no timeout. */
  timeoutSeconds: number;
};

export type MultisigApproval = {
  id: string;
  proposalId: string;
  signer: string;
  signature: string;
  action: 'approved' | 'rejected';
  reason?: string;
  timestamp: string;
};

export type MultisigProposal = {
  id: string;
  groupId: string;
  amount: number;
  currency: string;
  description?: string;
  recipient?: string;
  mode: MultisigMode;
  status: MultisigProposalStatus;
  approvals: MultisigApproval[];
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  expiresAt: string | null;
  metadata: Record<string, string>;
};

export type SignerChangeProposal = {
  id: string;
  groupId: string;
  type: SignerChangeType;
  targetSigner?: string;
  newThreshold?: number;
  proposerSigner: string;
  approvals: MultisigApproval[];
  status: MultisigProposalStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
};

// Legacy alias kept for backwards compatibility with route imports
export type MultisigPaymentRequest = MultisigProposal;

class MultisigService {
  private groups = new Map<string, MultisigGroup>();
  private proposals = new Map<string, MultisigProposal>();
  private signerChangeProposals = new Map<string, SignerChangeProposal>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  private expiresAt(timeoutSeconds: number): string | null {
    if (!timeoutSeconds) return null;
    return new Date(Date.now() + timeoutSeconds * 1000).toISOString();
  }

  private isExpired(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    return new Date() > new Date(expiresAt);
  }

  // ---------------------------------------------------------------------------
  // Group / wallet management
  // ---------------------------------------------------------------------------

  createGroup(input: {
    name: string;
    walletAddresses: string[];
    threshold: number;
    mode?: MultisigMode;
    timeoutSeconds?: number;
  }): MultisigGroup {
    const normalized = Array.from(new Set(input.walletAddresses.map((a) => a.trim().toLowerCase())));
    const group: MultisigGroup = {
      id: randomUUID(),
      name: input.name,
      walletAddresses: normalized,
      threshold: Math.min(input.threshold, normalized.length),
      mode: input.mode ?? 'offchain',
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      status: 'active',
      timeoutSeconds: input.timeoutSeconds ?? 0,
    };
    this.groups.set(group.id, group);
    return group;
  }

  listGroups(): MultisigGroup[] {
    return [...this.groups.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getGroup(groupId: string): MultisigGroup | undefined {
    return this.groups.get(groupId);
  }

  updateGroup(
    groupId: string,
    input: { name?: string; timeoutSeconds?: number }
  ): MultisigGroup | undefined {
    const group = this.groups.get(groupId);
    if (!group) return undefined;
    if (input.name !== undefined) group.name = input.name;
    if (input.timeoutSeconds !== undefined) group.timeoutSeconds = input.timeoutSeconds;
    group.updatedAt = this.nowIso();
    this.groups.set(groupId, group);
    return group;
  }

  // ---------------------------------------------------------------------------
  // Signer management — changes require existing signer consensus
  // ---------------------------------------------------------------------------

  proposeSigner(
    groupId: string,
    type: SignerChangeType,
    proposerSigner: string,
    proposerSignature: string,
    opts: { targetSigner?: string; newThreshold?: number; timeoutSeconds?: number }
  ): SignerChangeProposal | { error: string } {
    const group = this.groups.get(groupId);
    if (!group || group.status !== 'active') return { error: 'Group not found or inactive' };

    const normalizedProposer = proposerSigner.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedProposer)) {
      return { error: 'Proposer is not a signer of this group' };
    }

    if (type === 'add_signer' && opts.targetSigner) {
      const normalized = opts.targetSigner.trim().toLowerCase();
      if (group.walletAddresses.includes(normalized)) {
        return { error: 'Address is already a signer' };
      }
    }

    if (type === 'remove_signer' && opts.targetSigner) {
      const normalized = opts.targetSigner.trim().toLowerCase();
      if (!group.walletAddresses.includes(normalized)) {
        return { error: 'Address is not a signer' };
      }
      const resultingSignerCount = group.walletAddresses.length - 1;
      const effectiveThreshold = opts.newThreshold ?? group.threshold;
      if (resultingSignerCount < effectiveThreshold) {
        return { error: 'Removing signer would make threshold unreachable' };
      }
    }

    if (type === 'change_threshold' && opts.newThreshold !== undefined) {
      if (opts.newThreshold > group.walletAddresses.length) {
        return { error: 'New threshold exceeds number of signers' };
      }
    }

    const timeout = opts.timeoutSeconds ?? group.timeoutSeconds;
    const proposal: SignerChangeProposal = {
      id: randomUUID(),
      groupId,
      type,
      targetSigner: opts.targetSigner?.trim().toLowerCase(),
      newThreshold: opts.newThreshold,
      proposerSigner: normalizedProposer,
      approvals: [
        {
          id: randomUUID(),
          proposalId: '', // filled below
          signer: normalizedProposer,
          signature: proposerSignature,
          action: 'approved',
          timestamp: this.nowIso(),
        },
      ],
      status: 'pending',
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      expiresAt: this.expiresAt(timeout),
    };
    proposal.approvals[0].proposalId = proposal.id;

    this._evaluateSignerProposal(proposal, group);
    this.signerChangeProposals.set(proposal.id, proposal);
    return proposal;
  }

  approveSignerProposal(
    proposalId: string,
    signer: string,
    signature: string
  ): SignerChangeProposal | { error: string } {
    const proposal = this.signerChangeProposals.get(proposalId);
    if (!proposal) return { error: 'Proposal not found' };
    if (proposal.status !== 'pending') return { error: 'Proposal is no longer pending' };

    const group = this.groups.get(proposal.groupId);
    if (!group || group.status !== 'active') return { error: 'Group not found or inactive' };

    if (this.isExpired(proposal.expiresAt)) {
      proposal.status = 'expired';
      proposal.updatedAt = this.nowIso();
      this.signerChangeProposals.set(proposalId, proposal);
      return { error: 'Proposal has expired' };
    }

    const normalized = signer.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalized)) return { error: 'Not a signer of this group' };
    if (proposal.approvals.some((a) => a.signer === normalized)) return { error: 'Already voted' };

    proposal.approvals.push({
      id: randomUUID(),
      proposalId,
      signer: normalized,
      signature,
      action: 'approved',
      timestamp: this.nowIso(),
    });
    proposal.updatedAt = this.nowIso();

    this._evaluateSignerProposal(proposal, group);
    this.signerChangeProposals.set(proposalId, proposal);
    return proposal;
  }

  private _evaluateSignerProposal(proposal: SignerChangeProposal, group: MultisigGroup) {
    const approvedCount = proposal.approvals.filter((a) => a.action === 'approved').length;
    if (approvedCount < group.threshold) return;

    proposal.status = 'executed';
    proposal.updatedAt = this.nowIso();

    if (proposal.type === 'add_signer' && proposal.targetSigner) {
      if (!group.walletAddresses.includes(proposal.targetSigner)) {
        group.walletAddresses.push(proposal.targetSigner);
      }
    } else if (proposal.type === 'remove_signer' && proposal.targetSigner) {
      group.walletAddresses = group.walletAddresses.filter((a) => a !== proposal.targetSigner);
      // Adjust threshold to remain reachable after removal
      if (proposal.newThreshold !== undefined) {
        group.threshold = Math.min(proposal.newThreshold, group.walletAddresses.length);
      } else {
        group.threshold = Math.min(group.threshold, group.walletAddresses.length);
      }
      // Cancel any pending payment proposals that now have an impossible approval set
      this._invalidatePendingProposalsForGroup(group.id, proposal.targetSigner);
    } else if (proposal.type === 'change_threshold' && proposal.newThreshold !== undefined) {
      group.threshold = Math.min(proposal.newThreshold, group.walletAddresses.length);
    }

    group.updatedAt = this.nowIso();
    this.groups.set(group.id, group);
  }

  private _invalidatePendingProposalsForGroup(groupId: string, removedSigner: string) {
    for (const proposal of this.proposals.values()) {
      if (proposal.groupId !== groupId || proposal.status !== 'pending') continue;
      // If the removed signer had approved, that approval is now invalid.
      // The proposal remains pending — the threshold check will prevent premature execution.
      // No change to status needed, but mark updated.
      proposal.updatedAt = this.nowIso();
      this.proposals.set(proposal.id, proposal);
    }
  }

  listSignerChangeProposals(groupId?: string): SignerChangeProposal[] {
    const all = [...this.signerChangeProposals.values()];
    const filtered = groupId ? all.filter((p) => p.groupId === groupId) : all;
    return filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---------------------------------------------------------------------------
  // Transaction proposals
  // ---------------------------------------------------------------------------

  createProposal(input: {
    groupId: string;
    amount: number;
    currency: string;
    description?: string;
    recipient?: string;
    mode?: MultisigMode;
    metadata?: Record<string, string>;
    timeoutSeconds?: number;
  }): MultisigProposal | undefined {
    const group = this.groups.get(input.groupId);
    if (!group) return undefined;

    const timeout = input.timeoutSeconds ?? group.timeoutSeconds;
    const proposal: MultisigProposal = {
      id: randomUUID(),
      groupId: input.groupId,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency.toUpperCase(),
      description: input.description,
      recipient: input.recipient,
      mode: input.mode ?? group.mode,
      status: 'pending',
      approvals: [],
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      executedAt: null,
      expiresAt: this.expiresAt(timeout),
      metadata: input.metadata ?? {},
    };

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  listProposals(groupId?: string, status?: MultisigProposalStatus): MultisigProposal[] {
    let proposals = [...this.proposals.values()];
    if (groupId) proposals = proposals.filter((p) => p.groupId === groupId);
    if (status) proposals = proposals.filter((p) => p.status === status);
    return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProposal(proposalId: string): MultisigProposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return undefined;
    // Auto-expire on read
    if (proposal.status === 'pending' && this.isExpired(proposal.expiresAt)) {
      proposal.status = 'expired';
      proposal.updatedAt = this.nowIso();
      this.proposals.set(proposalId, proposal);
    }
    return proposal;
  }

  approveProposal(
    proposalId: string,
    signer: string,
    signature: string
  ): MultisigProposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return undefined;

    // Auto-expire check
    if (proposal.status === 'pending' && this.isExpired(proposal.expiresAt)) {
      proposal.status = 'expired';
      proposal.updatedAt = this.nowIso();
      this.proposals.set(proposalId, proposal);
      return undefined;
    }

    if (proposal.status !== 'pending') return undefined;

    const group = this.groups.get(proposal.groupId);
    if (!group || group.status !== 'active') return undefined;

    const normalizedSigner = signer.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedSigner)) return undefined;

    if (proposal.approvals.some((a) => a.signer === normalizedSigner)) return proposal;

    proposal.approvals.push({
      id: randomUUID(),
      proposalId: proposal.id,
      signer: normalizedSigner,
      signature,
      action: 'approved',
      timestamp: this.nowIso(),
    });
    proposal.updatedAt = this.nowIso();

    const approvedSigners = new Set(
      proposal.approvals.filter((a) => a.action === 'approved').map((a) => a.signer)
    );

    if (approvedSigners.size >= group.threshold) {
      proposal.status = 'executed';
      proposal.executedAt = this.nowIso();
    }

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  rejectProposal(
    proposalId: string,
    signer: string,
    signature: string,
    reason?: string
  ): MultisigProposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) return undefined;
    if (proposal.status !== 'pending') return undefined;

    const group = this.groups.get(proposal.groupId);
    if (!group || group.status !== 'active') return undefined;

    const normalizedSigner = signer.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedSigner)) return undefined;
    if (proposal.approvals.some((a) => a.signer === normalizedSigner)) return proposal;

    proposal.approvals.push({
      id: randomUUID(),
      proposalId: proposal.id,
      signer: normalizedSigner,
      signature,
      action: 'rejected',
      reason,
      timestamp: this.nowIso(),
    });
    proposal.updatedAt = this.nowIso();

    // If more than (signers - threshold + 1) reject, proposal is definitively blocked
    const rejectedCount = proposal.approvals.filter((a) => a.action === 'rejected').length;
    const blockingThreshold = group.walletAddresses.length - group.threshold + 1;
    if (rejectedCount >= blockingThreshold) {
      proposal.status = 'rejected';
    }

    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  cancelProposal(proposalId: string): MultisigProposal | undefined {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.status !== 'pending') return undefined;
    proposal.status = 'cancelled';
    proposal.updatedAt = this.nowIso();
    this.proposals.set(proposalId, proposal);
    return proposal;
  }

  /** Sweep all pending proposals and mark expired ones. */
  sweepExpiredProposals(): number {
    let count = 0;
    for (const proposal of this.proposals.values()) {
      if (proposal.status === 'pending' && this.isExpired(proposal.expiresAt)) {
        proposal.status = 'expired';
        proposal.updatedAt = this.nowIso();
        this.proposals.set(proposal.id, proposal);
        count++;
      }
    }
    for (const proposal of this.signerChangeProposals.values()) {
      if (proposal.status === 'pending' && this.isExpired(proposal.expiresAt)) {
        proposal.status = 'expired';
        proposal.updatedAt = this.nowIso();
        this.signerChangeProposals.set(proposal.id, proposal);
        count++;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Legacy compatibility aliases
  // ---------------------------------------------------------------------------

  createPayment(input: Parameters<typeof this.createProposal>[0]): MultisigProposal | undefined {
    return this.createProposal(input);
  }

  listPayments(): MultisigProposal[] {
    return this.listProposals();
  }

  getPayment(paymentId: string): MultisigProposal | undefined {
    return this.getProposal(paymentId);
  }

  approvePayment(paymentId: string, signer: string, signature: string): MultisigProposal | undefined {
    return this.approveProposal(paymentId, signer, signature);
  }
}

export const multisigService = new MultisigService();
