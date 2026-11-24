import {
  auditService,
  type AuditEntry,
} from './auditService.js';
import {
  createTamperChainEntry,
  TAMPER_CHAIN_GENESIS_HASH,
  verifyTamperChain,
  type TamperChainEntry,
  type TamperChainVerificationResult,
} from '../lib/tamperChain.js';

export type AdminAuditActionParams = Parameters<typeof auditService.logAction>[0];

export interface AdminAuditResult {
  auditEntry: AuditEntry;
  chainEntry: TamperChainEntry;
}

function chainDetails(params: AdminAuditActionParams): Record<string, unknown> {
  return {
    outcome: params.outcome,
    category: typeof params.details?.category === 'string' ? params.details.category : undefined,
    method: typeof params.details?.method === 'string' ? params.details.method : undefined,
    path: typeof params.details?.path === 'string' ? params.details.path : undefined,
    statusCode: typeof params.details?.statusCode === 'number' ? params.details.statusCode : undefined,
    durationMs: typeof params.details?.durationMs === 'number' ? params.details.durationMs : undefined,
  };
}

class AdminAuditService {
  private readonly entries: TamperChainEntry[] = [];
  private tailHash = TAMPER_CHAIN_GENESIS_HASH;

  async logAdminAction(params: AdminAuditActionParams): Promise<AdminAuditResult> {
    const chainEntry = createTamperChainEntry(
      {
        timestamp: Date.now(),
        actor: params.userId ?? 'system',
        action: params.action,
        resource: params.resource,
        resourceId: params.resourceId,
        details: chainDetails(params),
      },
      this.entries.length + 1,
      this.tailHash,
    );
    this.entries.push(chainEntry);
    this.tailHash = chainEntry.hash;

    const auditEntry = await auditService.logAction({
      ...params,
      details: {
        ...params.details,
        tamperChain: {
          sequence: chainEntry.sequence,
          previousHash: chainEntry.previousHash,
          hash: chainEntry.hash,
        },
      },
    });

    return { auditEntry, chainEntry };
  }

  verifyChain(): TamperChainVerificationResult {
    return verifyTamperChain(this.entries);
  }

  getEntries(): readonly TamperChainEntry[] {
    return [...this.entries];
  }
}

export const adminAuditService = new AdminAuditService();
export default adminAuditService;
