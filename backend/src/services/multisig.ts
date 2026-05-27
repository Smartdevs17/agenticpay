import { randomUUID } from 'node:crypto';

export type MultisigMode = 'onchain' | 'offchain';
export type MultisigGroupStatus = 'active' | 'inactive';
export type MultisigPaymentStatus = 'pending' | 'approved' | 'executed' | 'rejected';

export type MultisigGroup = {
  id: string;
  name: string;
  walletAddresses: string[];
  threshold: number;
  mode: MultisigMode;
  createdAt: string;
  updatedAt: string;
  status: MultisigGroupStatus;
};

export type MultisigApproval = {
  id: string;
  paymentId: string;
  signer: string;
  signature: string;
  timestamp: string;
};

export type MultisigPaymentRequest = {
  id: string;
  groupId: string;
  amount: number;
  currency: string;
  description?: string;
  mode: MultisigMode;
  status: MultisigPaymentStatus;
  approvals: MultisigApproval[];
  createdAt: string;
  updatedAt: string;
  executedAt: string | null;
  metadata: Record<string, string>;
};

class MultisigService {
  private groups = new Map<string, MultisigGroup>();
  private payments = new Map<string, MultisigPaymentRequest>();

  private nowIso(): string {
    return new Date().toISOString();
  }

  createGroup(input: {
    name: string;
    walletAddresses: string[];
    threshold: number;
    mode?: MultisigMode;
  }): MultisigGroup {
    const normalized = Array.from(new Set(input.walletAddresses.map((address) => address.trim().toLowerCase())));
    const group: MultisigGroup = {
      id: randomUUID(),
      name: input.name,
      walletAddresses: normalized,
      threshold: Math.min(input.threshold, normalized.length),
      mode: input.mode ?? 'offchain',
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      status: 'active',
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

  createPayment(input: {
    groupId: string;
    amount: number;
    currency: string;
    description?: string;
    mode?: MultisigMode;
    metadata?: Record<string, string>;
  }): MultisigPaymentRequest | undefined {
    const group = this.groups.get(input.groupId);
    if (!group) {
      return undefined;
    }

    const payment: MultisigPaymentRequest = {
      id: randomUUID(),
      groupId: input.groupId,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency.toUpperCase(),
      description: input.description,
      mode: input.mode ?? group.mode,
      status: 'pending',
      approvals: [],
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      executedAt: null,
      metadata: input.metadata ?? {},
    };

    this.payments.set(payment.id, payment);
    return payment;
  }

  listPayments(): MultisigPaymentRequest[] {
    return [...this.payments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getPayment(paymentId: string): MultisigPaymentRequest | undefined {
    return this.payments.get(paymentId);
  }

  approvePayment(paymentId: string, signer: string, signature: string): MultisigPaymentRequest | undefined {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return undefined;
    }

    const group = this.groups.get(payment.groupId);
    if (!group || group.status !== 'active') {
      return undefined;
    }

    const normalizedSigner = signer.trim().toLowerCase();
    if (!group.walletAddresses.includes(normalizedSigner)) {
      return undefined;
    }

    if (payment.approvals.some((approval) => approval.signer === normalizedSigner)) {
      return payment;
    }

    payment.approvals.push({
      id: randomUUID(),
      paymentId: payment.id,
      signer: normalizedSigner,
      signature,
      timestamp: this.nowIso(),
    });
    payment.updatedAt = this.nowIso();

    const uniqueSignerCount = new Set(payment.approvals.map((approval) => approval.signer)).size;
    if (uniqueSignerCount >= group.threshold && payment.status === 'pending') {
      payment.status = 'executed';
      payment.executedAt = this.nowIso();
    } else if (uniqueSignerCount >= group.threshold) {
      payment.status = 'approved';
    }

    this.payments.set(payment.id, payment);
    return payment;
  }
}

export const multisigService = new MultisigService();
