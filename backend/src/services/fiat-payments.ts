import { randomUUID } from 'node:crypto';

export type BankVerificationMethod = 'plaid' | 'micro_deposit';
export type BankAccountStatus = 'pending_verification' | 'verified' | 'failed_verification';
export type FiatPaymentMethod = 'ach' | 'wire';
export type FiatPaymentStatus =
  | 'pending_approval'
  | 'processing'
  | 'settled'
  | 'failed'
  | 'returned'
  | 'compliance_hold';

export type BankAccountRecord = {
  id: string;
  accountHolderName: string;
  bankName: string;
  accountNumberMasked: string;
  routingNumber: string;
  verificationMethod: BankVerificationMethod;
  countryCode: string;
  status: BankAccountStatus;
  verifiedAt: string | null;
  createdAt: string;
};

export type FiatPaymentRecipient = {
  name: string;
  accountNumberMasked: string;
  routingNumber: string;
  bankName: string;
  countryCode: string;
  swiftCode?: string;
};

export type FiatPaymentRecord = {
  id: string;
  method: FiatPaymentMethod;
  bankAccountId: string;
  recipient: FiatPaymentRecipient;
  amount: number;
  currency: 'USD';
  feeAmount: number;
  netAmount: number;
  description?: string;
  isInternational: boolean;
  status: FiatPaymentStatus;
  complianceNotes: string[];
  bankReference: string;
  wireInstructions?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  approvedBy: string | null;
};

export type FiatPaymentEvent = {
  id: string;
  paymentId: string;
  eventType: string;
  timestamp: string;
  details?: Record<string, string>;
};

export type ReconciliationReport = {
  generatedAt: string;
  from: string;
  to: string;
  totals: {
    count: number;
    grossAmount: number;
    netAmount: number;
    fees: number;
    returnedAmount: number;
  };
  byMethod: Record<FiatPaymentMethod, { count: number; grossAmount: number; fees: number }>;
  byStatus: Record<FiatPaymentStatus, number>;
  discrepancies: Array<{ paymentId: string; issue: string }>;
};

type CreateBankAccountInput = {
  accountHolderName: string;
  bankName: string;
  accountNumberMasked: string;
  routingNumber: string;
  verificationMethod: BankVerificationMethod;
  countryCode: string;
};

type CreatePaymentInput = {
  method: FiatPaymentMethod;
  bankAccountId: string;
  recipient: FiatPaymentRecipient;
  amount: number;
  currency: 'USD';
  description?: string;
  isInternational: boolean;
  metadata?: Record<string, string>;
};

const HIGH_VALUE_APPROVAL_THRESHOLD_USD = 10_000;

class FiatPaymentsService {
  private bankAccounts = new Map<string, BankAccountRecord>();
  private microDepositChallenges = new Map<string, [number, number]>();
  private payments = new Map<string, FiatPaymentRecord>();
  private events: FiatPaymentEvent[] = [];

  private nowIso(): string {
    return new Date().toISOString();
  }

  private pushEvent(paymentId: string, eventType: string, details?: Record<string, string>): void {
    this.events.push({
      id: randomUUID(),
      paymentId,
      eventType,
      timestamp: this.nowIso(),
      details,
    });
  }

  calculateFee(method: FiatPaymentMethod, amount: number, isInternational: boolean): number {
    if (method === 'ach') {
      return Math.min(25, Number((amount * 0.008).toFixed(2)));
    }

    return isInternational ? 35 : 15;
  }

  createBankAccount(input: CreateBankAccountInput): BankAccountRecord {
    const id = randomUUID();
    const createdAt = this.nowIso();
    const verified = input.verificationMethod === 'plaid';

    const record: BankAccountRecord = {
      id,
      accountHolderName: input.accountHolderName,
      bankName: input.bankName,
      accountNumberMasked: input.accountNumberMasked,
      routingNumber: input.routingNumber,
      verificationMethod: input.verificationMethod,
      countryCode: input.countryCode,
      status: verified ? 'verified' : 'pending_verification',
      verifiedAt: verified ? createdAt : null,
      createdAt,
    };

    this.bankAccounts.set(id, record);

    if (!verified) {
      const first = 11 + Math.floor(Math.random() * 25);
      const second = 37 + Math.floor(Math.random() * 25);
      this.microDepositChallenges.set(id, [first, second]);
    }

    return record;
  }

  getBankAccount(bankAccountId: string): BankAccountRecord | undefined {
    return this.bankAccounts.get(bankAccountId);
  }

  confirmMicroDeposits(bankAccountId: string, amountsInCents: [number, number]): BankAccountRecord | undefined {
    const account = this.bankAccounts.get(bankAccountId);
    if (!account) {
      return undefined;
    }

    const challenge = this.microDepositChallenges.get(bankAccountId);
    if (!challenge) {
      return account;
    }

    const expected = [...challenge].sort((a, b) => a - b);
    const actual = [...amountsInCents].sort((a, b) => a - b);
    const matched = expected[0] === actual[0] && expected[1] === actual[1];

    account.status = matched ? 'verified' : 'failed_verification';
    account.verifiedAt = matched ? this.nowIso() : null;
    this.bankAccounts.set(account.id, account);

    if (matched) {
      this.microDepositChallenges.delete(bankAccountId);
    }

    return account;
  }

  createPayment(input: CreatePaymentInput): FiatPaymentRecord {
    const bankAccount = this.bankAccounts.get(input.bankAccountId);
    if (!bankAccount) {
      throw new Error('BANK_ACCOUNT_NOT_FOUND');
    }

    if (bankAccount.status !== 'verified') {
      throw new Error('BANK_ACCOUNT_NOT_VERIFIED');
    }

    if (input.method === 'wire' && input.isInternational && !input.recipient.swiftCode) {
      throw new Error('INTERNATIONAL_WIRE_REQUIRES_SWIFT');
    }

    const now = this.nowIso();
    const feeAmount = this.calculateFee(input.method, input.amount, input.isInternational);
    const requiresApproval = input.amount >= HIGH_VALUE_APPROVAL_THRESHOLD_USD;
    const complianceHold = input.method === 'wire' && input.isInternational && input.amount >= 50_000;

    const payment: FiatPaymentRecord = {
      id: randomUUID(),
      method: input.method,
      bankAccountId: input.bankAccountId,
      recipient: input.recipient,
      amount: Number(input.amount.toFixed(2)),
      currency: input.currency,
      feeAmount,
      netAmount: Number((input.amount - feeAmount).toFixed(2)),
      description: input.description,
      isInternational: input.isInternational,
      status: complianceHold ? 'compliance_hold' : requiresApproval ? 'pending_approval' : 'processing',
      complianceNotes: complianceHold ? ['International high-value wire requires compliance review'] : [],
      bankReference: `BNK-${randomUUID().slice(0, 8).toUpperCase()}`,
      wireInstructions:
        input.method === 'wire'
          ? `Initiate wire to ${input.recipient.bankName} (${input.recipient.routingNumber}) for ${input.amount.toFixed(2)} USD.`
          : undefined,
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
      settledAt: null,
      returnedAt: null,
      returnReason: null,
      approvedBy: null,
    };

    this.payments.set(payment.id, payment);
    this.pushEvent(payment.id, 'payment_created', { method: payment.method, status: payment.status });
    return payment;
  }

  createBatch(reference: string, inputs: CreatePaymentInput[]): { batchId: string; reference: string; payments: FiatPaymentRecord[] } {
    const payments = inputs.map((input) => this.createPayment(input));
    return {
      batchId: randomUUID(),
      reference,
      payments,
    };
  }

  approvePayment(paymentId: string, approvedBy: string): FiatPaymentRecord | undefined {
    const payment = this.payments.get(paymentId);
    if (!payment) {
      return undefined;
    }

    if (payment.status !== 'pending_approval') {
      return payment;
    }

    payment.status = 'processing';
    payment.updatedAt = this.nowIso();
    payment.approvedBy = approvedBy;
    this.payments.set(payment.id, payment);
    this.pushEvent(payment.id, 'payment_approved', { approvedBy });
    return payment;
  }

  getPayment(paymentId: string): FiatPaymentRecord | undefined {
    return this.payments.get(paymentId);
  }

  listPayments(filters?: { method?: FiatPaymentMethod; status?: FiatPaymentStatus }): FiatPaymentRecord[] {
    const all = [...this.payments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return all.filter((payment) => {
      if (filters?.method && payment.method !== filters.method) {
        return false;
      }
      if (filters?.status && payment.status !== filters.status) {
        return false;
      }
      return true;
    });
  }

  handleWebhook(input: {
    paymentId: string;
    eventType: 'processing' | 'settled' | 'failed' | 'returned';
    reason?: string;
    bankReference?: string;
  }): FiatPaymentRecord | undefined {
    const payment = this.payments.get(input.paymentId);
    if (!payment) {
      return undefined;
    }

    payment.status = input.eventType;
    payment.updatedAt = this.nowIso();

    if (input.eventType === 'settled') {
      payment.settledAt = this.nowIso();
    }

    if (input.eventType === 'returned') {
      payment.returnedAt = this.nowIso();
      payment.returnReason = input.reason ?? 'Returned by bank';
    }

    if (input.bankReference) {
      payment.bankReference = input.bankReference;
    }

    this.payments.set(payment.id, payment);
    this.pushEvent(payment.id, `bank_${input.eventType}`, {
      reason: input.reason ?? '',
      bankReference: input.bankReference ?? payment.bankReference,
    });
    return payment;
  }

  getPaymentEvents(paymentId: string): FiatPaymentEvent[] {
    return this.events.filter((event) => event.paymentId === paymentId);
  }

  getReconciliationReport(from: string, to: string): ReconciliationReport {
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();

    const selected = [...this.payments.values()].filter((payment) => {
      const createdMs = new Date(payment.createdAt).getTime();
      return createdMs >= fromMs && createdMs <= toMs;
    });

    const byMethod: Record<FiatPaymentMethod, { count: number; grossAmount: number; fees: number }> = {
      ach: { count: 0, grossAmount: 0, fees: 0 },
      wire: { count: 0, grossAmount: 0, fees: 0 },
    };

    const byStatus: Record<FiatPaymentStatus, number> = {
      pending_approval: 0,
      processing: 0,
      settled: 0,
      failed: 0,
      returned: 0,
      compliance_hold: 0,
    };

    let grossAmount = 0;
    let netAmount = 0;
    let fees = 0;
    let returnedAmount = 0;

    for (const payment of selected) {
      grossAmount += payment.amount;
      netAmount += payment.netAmount;
      fees += payment.feeAmount;
      if (payment.status === 'returned') {
        returnedAmount += payment.amount;
      }

      byMethod[payment.method].count += 1;
      byMethod[payment.method].grossAmount += payment.amount;
      byMethod[payment.method].fees += payment.feeAmount;
      byStatus[payment.status] += 1;
    }

    const discrepancies = selected
      .filter((payment) => payment.status === 'settled' && payment.settledAt === null)
      .map((payment) => ({
        paymentId: payment.id,
        issue: 'Settled payment missing settledAt timestamp',
      }));

    return {
      generatedAt: this.nowIso(),
      from,
      to,
      totals: {
        count: selected.length,
        grossAmount: Number(grossAmount.toFixed(2)),
        netAmount: Number(netAmount.toFixed(2)),
        fees: Number(fees.toFixed(2)),
        returnedAmount: Number(returnedAmount.toFixed(2)),
      },
      byMethod: {
        ach: {
          count: byMethod.ach.count,
          grossAmount: Number(byMethod.ach.grossAmount.toFixed(2)),
          fees: Number(byMethod.ach.fees.toFixed(2)),
        },
        wire: {
          count: byMethod.wire.count,
          grossAmount: Number(byMethod.wire.grossAmount.toFixed(2)),
          fees: Number(byMethod.wire.fees.toFixed(2)),
        },
      },
      byStatus,
      discrepancies,
    };
  }

  resetForTests(): void {
    this.bankAccounts.clear();
    this.microDepositChallenges.clear();
    this.payments.clear();
    this.events = [];
  }

  getMicroDepositChallengeForTests(bankAccountId: string): [number, number] | undefined {
    return this.microDepositChallenges.get(bankAccountId);
  }
}

export const fiatPaymentsService = new FiatPaymentsService();