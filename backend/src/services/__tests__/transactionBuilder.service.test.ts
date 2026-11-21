import { beforeEach, describe, expect, it } from 'vitest';
import { TransactionBuilderService } from '../transactionBuilder.service.js';
import { clearNodes, registerNode } from '../mpc/nodes.js';
import { resetHsm } from '../mpc/hsm.js';
import { __reset, getSigningSession, runCeremony } from '../mpc/coordinator.js';
import { generateIdentityKeypair } from '../mpc/ed25519.js';

function bootstrapNodes(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `node-${i + 1}`;
    const { publicKey } = generateIdentityKeypair();
    registerNode({ id, identityPublicKey: publicKey.toString('hex') });
    ids.push(id);
  }
  return ids;
}

describe('TransactionBuilderService', () => {
  let builder: TransactionBuilderService;

  beforeEach(() => {
    clearNodes();
    resetHsm();
    __reset();
    builder = new TransactionBuilderService();
  });

  describe('classification', () => {
    it('treats amounts below the threshold as single-key', () => {
      expect(builder.isHighValue(9_999)).toBe(false);
      expect(builder.classify(9_999)).toBe('single');
    });

    it('treats amounts at or above the threshold as MPC', () => {
      expect(builder.isHighValue(10_000)).toBe(true);
      expect(builder.classify(50_000)).toBe('mpc');
    });

    it('respects a custom threshold and rejects invalid ones', () => {
      builder.setHighValueThreshold(1_000);
      expect(builder.classify(1_500)).toBe('mpc');
      expect(() => builder.setHighValueThreshold(0)).toThrow();
    });
  });

  describe('standard-value signing', () => {
    it('signs immediately with the single-key signer', async () => {
      const result = await builder.signTransaction({
        amount: 100,
        payload: Buffer.from('standard-tx'),
        requestedBy: 'svc',
        singleKeySign: (payload) => Buffer.concat([Buffer.from('sig:'), payload]),
      });

      expect(result.mode).toBe('single');
      if (result.mode === 'single') {
        expect(Buffer.from(result.signatureHex, 'hex').toString()).toBe('sig:standard-tx');
      }
    });

    it('throws when no single-key signer is supplied', async () => {
      await expect(
        builder.signTransaction({
          amount: 100,
          payload: Buffer.from('x'),
          requestedBy: 'svc',
        }),
      ).rejects.toThrow(/singleKeySign/);
    });
  });

  describe('high-value signing', () => {
    it('routes through the MPC coordinator and opens a pending session', async () => {
      const nodes = bootstrapNodes(5);
      const { key } = runCeremony({ threshold: 3, nodes });

      const result = await builder.signTransaction({
        amount: 250_000,
        payload: Buffer.from('high-value-tx'),
        requestedBy: 'treasury',
        keyId: key.id,
      });

      expect(result.mode).toBe('mpc');
      if (result.mode === 'mpc') {
        expect(result.threshold).toBe(3);
        expect(result.quorum).toHaveLength(5);
        expect(result.status).toBe('pending_signatures');
        // The session is registered with the coordinator awaiting approvals.
        const session = getSigningSession(result.sessionId);
        expect(session?.status).toBe('pending');
      }
    });

    it('requires a keyId for high-value transactions', async () => {
      await expect(
        builder.signTransaction({
          amount: 250_000,
          payload: Buffer.from('x'),
          requestedBy: 'treasury',
        }),
      ).rejects.toThrow(/keyId/);
    });

    it('rejects an unknown MPC key', async () => {
      await expect(
        builder.signTransaction({
          amount: 250_000,
          payload: Buffer.from('x'),
          requestedBy: 'treasury',
          keyId: 'key_does_not_exist',
        }),
      ).rejects.toThrow(/unknown MPC key/);
    });
  });
});
