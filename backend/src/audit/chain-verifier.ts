import { AUDIT_GENESIS_HASH, computeAuditHash, ImmutableAuditLogEntry } from './immutable-logger.js';
import { logger } from '../utils/logger.js';

export interface AuditIntegrityResult {
  valid: boolean;
  checked: number;
  brokenAt?: string;
  expectedPreviousHash?: string;
  expectedHash?: string;
  actualHash?: string;
}

export interface AuditVerificationStore {
  listAuditEntriesAscending(): Promise<ImmutableAuditLogEntry[]>;
}

export async function verifyAuditChain(entries: ImmutableAuditLogEntry[]): Promise<AuditIntegrityResult> {
  let previousHash = AUDIT_GENESIS_HASH;

  for (const entry of entries) {
    if (entry.previousHash !== previousHash) {
      const result = {
        valid: false,
        checked: entries.indexOf(entry),
        brokenAt: entry.id,
        expectedPreviousHash: previousHash,
        actualHash: entry.previousHash,
      };
      await emitTamperAlert(result);
      return result;
    }

    const expectedHash = computeAuditHash({
      previousHash: entry.previousHash,
      timestamp: entry.timestamp,
      actor: entry.actor,
      action: entry.action,
      resource: entry.resource,
      details: entry.details,
    });

    if (expectedHash !== entry.hash) {
      const result = {
        valid: false,
        checked: entries.indexOf(entry),
        brokenAt: entry.id,
        expectedHash,
        actualHash: entry.hash,
      };
      await emitTamperAlert(result);
      return result;
    }

    previousHash = entry.hash;
  }

  return { valid: true, checked: entries.length };
}

export class AuditChainVerifier {
  constructor(private readonly store: AuditVerificationStore) {}

  async verifyFromGenesis(): Promise<AuditIntegrityResult> {
    return verifyAuditChain(await this.store.listAuditEntriesAscending());
  }
}

async function emitTamperAlert(result: AuditIntegrityResult): Promise<void> {
  logger.error({ result }, 'Audit hash chain inconsistency detected');

  const webhook = process.env.AUDIT_TAMPER_ALERT_WEBHOOK_URL;
  if (!webhook) return;

  await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Audit hash chain inconsistency detected',
      result,
    }),
  }).catch((error) => {
    logger.error({ error }, 'Failed to send audit tamper alert');
  });
}
