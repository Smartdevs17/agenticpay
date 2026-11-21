import { describe, expect, it } from 'vitest';
import { generateIdentityKeypair, sign } from '../ed25519.js';
import {
  assertByzantineCompatible,
  createEquivocationTracker,
  isExpired,
  messageDigest,
  recordApproval,
} from '../bft.js';

describe('bft', () => {
  describe('assertByzantineCompatible', () => {
    it('classical PBFT bound holds for common configs', () => {
      // 4 nodes, threshold 3 → f = 1 (n = 3f+1, m = 2f+1)
      expect(assertByzantineCompatible(3, 4).faultTolerance).toBe(1);
      // 7 nodes, threshold 5 → f = 2
      expect(assertByzantineCompatible(5, 7).faultTolerance).toBe(2);
      // 10 nodes, threshold 7 → f = 3
      expect(assertByzantineCompatible(7, 10).faultTolerance).toBe(3);
    });

    it('allows smaller thresholds but caps fault tolerance at the tighter bound', () => {
      // Threshold 2 limits tolerance to 0 even with 4 nodes.
      expect(assertByzantineCompatible(2, 4).faultTolerance).toBe(0);
    });

    it('flags dev configurations with fewer than 3 nodes', () => {
      const env = assertByzantineCompatible(2, 2);
      expect(env.faultTolerance).toBe(0);
    });

    it('rejects malformed configurations', () => {
      expect(() => assertByzantineCompatible(1, 3)).toThrow(/at least 2/);
      expect(() => assertByzantineCompatible(4, 3)).toThrow(/>= threshold/);
    });
  });

  describe('messageDigest', () => {
    it('is deterministic for the same inputs', () => {
      const payload = Buffer.from('deadbeef', 'hex');
      const a = messageDigest('session-1', payload);
      const b = messageDigest('session-1', payload);
      expect(a.equals(b)).toBe(true);
    });

    it('changes when session or payload change', () => {
      const payload = Buffer.from('00', 'hex');
      const base = messageDigest('session-1', payload);
      expect(base.equals(messageDigest('session-2', payload))).toBe(false);
      expect(base.equals(messageDigest('session-1', Buffer.from('01', 'hex')))).toBe(false);
    });
  });

  describe('equivocation tracking', () => {
    it('accepts a single valid approval', () => {
      const { seed, publicKey } = generateIdentityKeypair();
      const tracker = createEquivocationTracker();
      const digest = messageDigest('s', Buffer.from('payload'));
      const signature = sign(seed, digest).toString('hex');

      const res = recordApproval(tracker, 's', 'n1', publicKey, digest, signature);
      expect(res).toEqual({ ok: true });
    });

    it('rejects forged signatures', () => {
      const { publicKey } = generateIdentityKeypair();
      const tracker = createEquivocationTracker();
      const digest = messageDigest('s', Buffer.from('payload'));
      const res = recordApproval(
        tracker,
        's',
        'n1',
        publicKey,
        digest,
        'ff'.repeat(64),
      );
      expect(res.ok).toBe(false);
      expect(res.reason).toBe('bad-signature');
    });

    it('detects equivocation when a node signs two different approvals', () => {
      const { seed, publicKey } = generateIdentityKeypair();
      const tracker = createEquivocationTracker();
      const digest1 = messageDigest('s', Buffer.from('one'));
      const digest2 = messageDigest('s', Buffer.from('two'));

      recordApproval(tracker, 's', 'n1', publicKey, digest1, sign(seed, digest1).toString('hex'));
      const dup = recordApproval(
        tracker,
        's',
        'n1',
        publicKey,
        digest2,
        sign(seed, digest2).toString('hex'),
      );
      expect(dup.ok).toBe(false);
      expect(dup.reason).toBe('equivocation');
    });

    it('allows the same node to re-send an identical approval (idempotency)', () => {
      const { seed, publicKey } = generateIdentityKeypair();
      const tracker = createEquivocationTracker();
      const digest = messageDigest('s', Buffer.from('payload'));
      const signature = sign(seed, digest).toString('hex');

      expect(recordApproval(tracker, 's', 'n1', publicKey, digest, signature).ok).toBe(true);
      expect(recordApproval(tracker, 's', 'n1', publicKey, digest, signature).ok).toBe(true);
    });
  });

  describe('isExpired', () => {
    it('compares expiry against a supplied now', () => {
      expect(isExpired(100, 101)).toBe(true);
      expect(isExpired(100, 100)).toBe(true); // inclusive
      expect(isExpired(100, 99)).toBe(false);
    });
  });
});
