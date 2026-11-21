import { AppError } from '../middleware/errorHandler.js';

export type SplitRecipient = {
  recipientId: string;
  walletAddress: string;
  percentage: number;
  minimumThreshold: number;
};

export type SplitConfig = {
  id: string;
  merchantId: string;
  platformFeePercentage: number;
  recipients: SplitRecipient[];
  createdAt: string;
  updatedAt: string;
};

export type SplitExecutionResult = {
  paymentId: string;
  splitId: string;
  totalAmount: number;
  currency: string;
  platformFeeAmount: number;
  recipientDistributions: Array<{
    recipientId: string;
    walletAddress: string;
    amount: number;
    skipped: boolean;
    reason?: string;
  }>;
  executedAt: string;
};

type SplitAuditEvent = {
  id: string;
  splitId: string;
  eventType: 'created' | 'updated' | 'executed';
  message: string;
  createdAt: string;
};

const splitConfigs = new Map<string, SplitConfig>();
const merchantSplitIndex = new Map<string, string[]>();
const splitExecutions = new Map<string, SplitExecutionResult[]>();
const splitAuditTrail = new Map<string, SplitAuditEvent[]>();

const round2 = (value: number) => Math.round(value * 100) / 100;

function validatePercentages(recipients: SplitRecipient[], platformFeePercentage: number) {
  const recipientTotal = recipients.reduce((sum, recipient) => sum + recipient.percentage, 0);
  const grandTotal = round2(recipientTotal + platformFeePercentage);

  if (grandTotal > 100) {
    throw new AppError(400, 'Recipient percentages plus platform fee cannot exceed 100', 'VALIDATION_ERROR');
  }
}

function pushAudit(splitId: string, eventType: SplitAuditEvent['eventType'], message: string) {
  const current = splitAuditTrail.get(splitId) ?? [];
  current.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    splitId,
    eventType,
    message,
    createdAt: new Date().toISOString(),
  });
  splitAuditTrail.set(splitId, current);
}

export function createSplitConfig(input: {
  merchantId: string;
  platformFeePercentage: number;
  recipients: SplitRecipient[];
}): SplitConfig {
  validatePercentages(input.recipients, input.platformFeePercentage);

  const id = `split_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();
  const config: SplitConfig = {
    id,
    merchantId: input.merchantId,
    platformFeePercentage: input.platformFeePercentage,
    recipients: input.recipients,
    createdAt: now,
    updatedAt: now,
  };

  splitConfigs.set(id, config);
  const merchantSplits = merchantSplitIndex.get(input.merchantId) ?? [];
  merchantSplits.push(id);
  merchantSplitIndex.set(input.merchantId, merchantSplits);
  pushAudit(id, 'created', `Split config created for merchant ${input.merchantId}`);
  return config;
}

export function updateSplitConfig(
  splitId: string,
  patch: { recipients?: SplitRecipient[]; platformFeePercentage?: number }
): SplitConfig {
  const existing = splitConfigs.get(splitId);
  if (!existing) {
    throw new AppError(404, 'Split config not found', 'NOT_FOUND');
  }

  const nextRecipients = patch.recipients ?? existing.recipients;
  const nextPlatformFee = patch.platformFeePercentage ?? existing.platformFeePercentage;
  validatePercentages(nextRecipients, nextPlatformFee);

  const updated: SplitConfig = {
    ...existing,
    recipients: nextRecipients,
    platformFeePercentage: nextPlatformFee,
    updatedAt: new Date().toISOString(),
  };
  splitConfigs.set(splitId, updated);
  pushAudit(splitId, 'updated', 'Split config updated');
  return updated;
}

export function getSplitConfig(splitId: string): SplitConfig | null {
  return splitConfigs.get(splitId) ?? null;
}

export function listMerchantSplits(merchantId: string): SplitConfig[] {
  const ids = merchantSplitIndex.get(merchantId) ?? [];
  return ids
    .map((id) => splitConfigs.get(id))
    .filter((config): config is SplitConfig => Boolean(config));
}

export function executeSplitPayment(input: {
  splitId: string;
  paymentId: string;
  totalAmount: number;
  currency: string;
}): SplitExecutionResult {
  const split = splitConfigs.get(input.splitId);
  if (!split) {
    throw new AppError(404, 'Split config not found', 'NOT_FOUND');
  }

  const platformFeeAmount = round2((input.totalAmount * split.platformFeePercentage) / 100);

  const recipientDistributions = split.recipients.map((recipient) => {
    const amount = round2((input.totalAmount * recipient.percentage) / 100);
    const skipped = amount < recipient.minimumThreshold;
    return {
      recipientId: recipient.recipientId,
      walletAddress: recipient.walletAddress,
      amount,
      skipped,
      reason: skipped ? 'Below minimum threshold' : undefined,
    };
  });

  const result: SplitExecutionResult = {
    paymentId: input.paymentId,
    splitId: split.id,
    totalAmount: input.totalAmount,
    currency: input.currency,
    platformFeeAmount,
    recipientDistributions,
    executedAt: new Date().toISOString(),
  };

  const existing = splitExecutions.get(split.id) ?? [];
  existing.push(result);
  splitExecutions.set(split.id, existing);
  pushAudit(split.id, 'executed', `Split executed for payment ${input.paymentId}`);
  return result;
}

export function getSplitAnalytics(splitId: string) {
  const executions = splitExecutions.get(splitId) ?? [];
  const totalProcessed = executions.reduce((sum, item) => sum + item.totalAmount, 0);
  const totalPlatformFees = executions.reduce((sum, item) => sum + item.platformFeeAmount, 0);
  const skippedDistributions = executions.reduce(
    (sum, item) => sum + item.recipientDistributions.filter((distribution) => distribution.skipped).length,
    0
  );
  return {
    splitId,
    totalExecutions: executions.length,
    totalProcessed: round2(totalProcessed),
    totalPlatformFees: round2(totalPlatformFees),
    skippedDistributions,
  };
}

export function getSplitAuditTrail(splitId: string): SplitAuditEvent[] {
  return splitAuditTrail.get(splitId) ?? [];
}

export function exportSplitRecipientsCsv(splitId: string): string {
  const split = splitConfigs.get(splitId);
  if (!split) {
    throw new AppError(404, 'Split config not found', 'NOT_FOUND');
  }

  const header = 'recipientId,walletAddress,percentage,minimumThreshold';
  const rows = split.recipients.map(
    (recipient) =>
      `${recipient.recipientId},${recipient.walletAddress},${recipient.percentage.toFixed(2)},${recipient.minimumThreshold.toFixed(2)}`
  );
  return [header, ...rows].join('\n');
}
