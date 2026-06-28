import { randomUUID } from 'node:crypto';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { auditService } from '../auditService.js';

export type PauseStatus = 'pending' | 'active' | 'expired' | 'resolved';
export type ChainType = 'evm' | 'soroban';

export interface PauseRecord {
  id: string;
  chain: ChainType;
  contractAddress: string;
  pauseImplementation: string;
  status: PauseStatus;
  requestedBy: string;
  requestedAt: number;
  activatedAt?: number;
  expiresAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  approvals: Record<string, number>;
  threshold: number;
  timeoutSeconds: number;
}

export interface GuardianConfig {
  address: string;
  chain: ChainType;
  active: boolean;
  addedAt: number;
}

interface PauseManagerConfig {
  maxTimeoutSeconds: number;
  defaultTimeoutSeconds: number;
  defaultThreshold: number;
}

const DEFAULT_CONFIG: PauseManagerConfig = {
  maxTimeoutSeconds: 72 * 60 * 60, // 72 hours
  defaultTimeoutSeconds: 24 * 60 * 60, // 24 hours
  defaultThreshold: 2,
};

export class PauseManagerService extends BaseService {
  private records = new Map<string, PauseRecord>();
  private guardians = new Map<string, GuardianConfig>();
  private config: PauseManagerConfig;

  constructor(config?: Partial<PauseManagerConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async requestPause(params: {
    chain: ChainType;
    contractAddress: string;
    pauseImplementation: string;
    requestedBy: string;
    threshold?: number;
    timeoutSeconds?: number;
  }): Promise<Result<PauseRecord>> {
    const guardian = this.guardians.get(params.requestedBy);
    if (!guardian || !guardian.active) {
      return this.forbiddenFailure('Only active guardians can request a pause');
    }

    const timeoutSeconds = params.timeoutSeconds ?? this.config.defaultTimeoutSeconds;
    if (timeoutSeconds > this.config.maxTimeoutSeconds) {
      return this.validationFailure(`Timeout cannot exceed ${this.config.maxTimeoutSeconds} seconds`);
    }

    const existing = Array.from(this.records.values()).find(
      (r) => r.contractAddress === params.contractAddress && (r.status === 'pending' || r.status === 'active'),
    );
    if (existing) {
      return this.conflictFailure(`Contract ${params.contractAddress} already has an active or pending pause`);
    }

    const id = randomUUID();
    const now = Date.now();
    const threshold = params.threshold ?? this.config.defaultThreshold;

    const record: PauseRecord = {
      id,
      chain: params.chain,
      contractAddress: params.contractAddress,
      pauseImplementation: params.pauseImplementation,
      status: 'pending',
      requestedBy: params.requestedBy,
      requestedAt: now,
      approvals: { [params.requestedBy]: now },
      threshold,
      timeoutSeconds,
    };

    if (Object.keys(record.approvals).length >= threshold) {
      record.status = 'active';
      record.activatedAt = now;
      record.expiresAt = now + timeoutSeconds * 1000;
    }

    this.records.set(id, record);

    await auditService.logAction({
      userId: params.requestedBy,
      action: 'pause.requested',
      resource: 'contract',
      resourceId: params.contractAddress,
      details: { pauseId: id, chain: params.chain, status: record.status },
    });

    return this.ok(record);
  }

  async approvePause(params: {
    pauseId: string;
    guardianAddress: string;
  }): Promise<Result<PauseRecord>> {
    const guardian = this.guardians.get(params.guardianAddress);
    if (!guardian || !guardian.active) {
      return this.forbiddenFailure('Only active guardians can approve a pause');
    }

    const record = this.records.get(params.pauseId);
    if (!record) {
      return this.notFoundFailure('PauseRecord', params.pauseId);
    }

    if (record.status !== 'pending') {
      return this.validationFailure('Only pending pauses can be approved');
    }

    if (record.approvals[params.guardianAddress]) {
      return this.conflictFailure('Guardian has already approved this pause');
    }

    const now = Date.now();
    record.approvals[params.guardianAddress] = now;

    if (Object.keys(record.approvals).length >= record.threshold) {
      record.status = 'active';
      record.activatedAt = now;
      record.expiresAt = now + record.timeoutSeconds * 1000;
    }

    this.records.set(params.pauseId, record);

    await auditService.logAction({
      userId: params.guardianAddress,
      action: 'pause.approved',
      resource: 'contract',
      resourceId: record.contractAddress,
      details: {
        pauseId: params.pauseId,
        approvalCount: Object.keys(record.approvals).length,
        threshold: record.threshold,
        status: record.status,
      },
    });

    return this.ok(record);
  }

  async resolvePause(params: {
    pauseId: string;
    resolvedBy: string;
  }): Promise<Result<PauseRecord>> {
    const record = this.records.get(params.pauseId);
    if (!record) {
      return this.notFoundFailure('PauseRecord', params.pauseId);
    }

    if (record.status !== 'active') {
      return this.validationFailure('Only active pauses can be resolved');
    }

    const now = Date.now();
    record.status = 'resolved';
    record.resolvedAt = now;
    record.resolvedBy = params.resolvedBy;

    this.records.set(params.pauseId, record);

    await auditService.logAction({
      userId: params.resolvedBy,
      action: 'pause.resolved',
      resource: 'contract',
      resourceId: record.contractAddress,
      details: { pauseId: params.pauseId },
    });

    return this.ok(record);
  }

  async checkExpiry(): Promise<PauseRecord[]> {
    const now = Date.now();
    const expired: PauseRecord[] = [];

    for (const record of this.records.values()) {
      if (record.status === 'active' && record.expiresAt && now >= record.expiresAt) {
        record.status = 'expired';
        this.records.set(record.id, record);
        expired.push(record);

        await auditService.logAction({
          action: 'pause.expired',
          resource: 'contract',
          resourceId: record.contractAddress,
          details: { pauseId: record.id, expiredAt: now },
        });
      }
    }

    return expired;
  }

  getPauseRecord(pauseId: string): Result<PauseRecord> {
    const record = this.records.get(pauseId);
    if (!record) {
      return this.notFoundFailure('PauseRecord', pauseId);
    }
    return this.ok(record);
  }

  listPauses(filters?: {
    status?: PauseStatus;
    chain?: ChainType;
    contractAddress?: string;
  }): Result<{ records: PauseRecord[]; total: number }> {
    let records = Array.from(this.records.values());

    if (filters?.status) {
      records = records.filter((r) => r.status === filters.status);
    }
    if (filters?.chain) {
      records = records.filter((r) => r.chain === filters.chain);
    }
    if (filters?.contractAddress) {
      records = records.filter((r) => r.contractAddress === filters.contractAddress);
    }

    records.sort((a, b) => b.requestedAt - a.requestedAt);

    return this.ok({ records, total: records.length });
  }

  // ── Guardian Management ──────────────────────────────────────────────

  addGuardian(address: string, chain: ChainType): Result<GuardianConfig> {
    if (this.guardians.has(address)) {
      return this.conflictFailure('Guardian already exists');
    }

    const config: GuardianConfig = {
      address,
      chain,
      active: true,
      addedAt: Date.now(),
    };

    this.guardians.set(address, config);
    return this.ok(config);
  }

  removeGuardian(address: string): Result<void> {
    if (!this.guardians.has(address)) {
      return this.notFoundFailure('Guardian', address);
    }

    const guardian = this.guardians.get(address)!;
    guardian.active = false;
    this.guardians.set(address, guardian);
    return this.ok(undefined);
  }

  listGuardians(): GuardianConfig[] {
    return Array.from(this.guardians.values());
  }
}

export const pauseManagerService = new PauseManagerService();
