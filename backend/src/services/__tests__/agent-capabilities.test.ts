import { describe, expect, it } from 'vitest';
import { AgentMarketplace, createSigningKeyPair } from '../agentMarketplace.js';
import { IdentityAttestationService, createAttestationKeyPair } from '../identityAttestation.js';
import { StreamingPayments } from '../streamingPayments.js';

describe('agent capability marketplace', () => {
  it('verifies versioned manifests and rejects revoked entries', () => {
    const { privateKey } = createSigningKeyPair();
    const marketplace = new AgentMarketplace();
    const entry = marketplace.publish({ agentId: 'agent-1', version: '1.0.0', capabilities: ['pay', 'quote'], endpoint: 'https://agent.test', publishedAt: new Date().toISOString() }, privateKey);
    expect(marketplace.verify(entry)).toBe(true);
    marketplace.revoke(entry.digest);
    expect(marketplace.verify(entry)).toBe(false);
  });
});

describe('identity attestations', () => {
  it('supports signature verification and revocation', () => {
    const { privateKey } = createAttestationKeyPair();
    const service = new IdentityAttestationService();
    const credential = service.issue('agent-1', { tier: 'trusted' }, 'issuer-1', privateKey);
    expect(service.verifyCredential(credential)).toBe(true);
    service.revoke(credential.id);
    expect(service.verifyCredential(credential)).toBe(false);
  });
});

describe('streaming payments', () => {
  it('settles many recipients by elapsed seconds without double-paying', () => {
    const streams = new StreamingPayments();
    const first = streams.open({ sender: 'a', recipient: 'b', ratePerSecond: 3n, startAt: 100, endAt: 200, total: 300n });
    const second = streams.open({ sender: 'a', recipient: 'c', ratePerSecond: 2n, startAt: 100, endAt: 200, total: 200n });
    expect(streams.settleMany([first.id, second.id], 110)).toEqual(new Map([[first.id, 30n], [second.id, 20n]]));
    expect(streams.settle(first.id, 110)).toBe(0n);
  });
});
