import { describe, it, expect, beforeEach } from 'vitest';
import {
  AUDIT_CHAIN_GENESIS,
  AUDIT_HASH_ALGORITHM,
  deriveAuditResource,
} from '../audit.js';
import { AuditService } from '../../services/auditService.js';

describe('tamper-evident audit chain (#1356)', () => {
  let service: AuditService;

  beforeEach(() => {
    service = new AuditService({ alerting: false });
  });

  it('exports chain constants used by middleware', () => {
    expect(AUDIT_CHAIN_GENESIS).toHaveLength(64);
    expect(AUDIT_HASH_ALGORITHM).toBe('sha256');
  });

  it('links each entry to the previous hash and verifies integrity', async () => {
    const first = await service.logAction({ action: 'a.create', resource: 'a' });
    expect(first.previousHash).toBe(AUDIT_CHAIN_GENESIS);

    const second = await service.logAction({ action: 'b.create', resource: 'b' });
    expect(second.previousHash).toBe(first.hash);

    const tip = await service.getChainTip();
    expect(tip).toBe(second.hash);

    await expect(service.verifyIntegrity()).resolves.toEqual({ valid: true });
  });

  it('detects tampering when an entry hash is altered', async () => {
    await service.logAction({ action: 'a.create', resource: 'a' });
    const second = await service.logAction({ action: 'b.create', resource: 'b' });

    // Simulate tampering via private entries array
    (second as { hash: string }).hash = 'deadbeef'.repeat(8);

    const result = await service.verifyIntegrity();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(second.id);
  });

  it('derives resource names past the API version segment', () => {
    const req = {
      baseUrl: '/api/v1/payments',
      path: '/123',
    } as unknown as import('express').Request;
    expect(deriveAuditResource(req)).toBe('payments');
  });
});
