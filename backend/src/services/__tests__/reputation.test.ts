import { beforeEach, describe, expect, it } from 'vitest';
import {
  createReputation,
  recordTransaction,
  awardBadge,
  getReputation,
  getReputationSnapshot,
  computeResetChallengeResponse,
  initiateReputationReset,
  completeReputationReset,
  getResetChallenge,
  resetReputationStoreForTests,
} from '../reputation.js';

describe('reputation scoring and challenge-response resets (#1364)', () => {
  beforeEach(() => {
    resetReputationStoreForTests();
  });

  it('updates score, trust tier, snapshot percentile, and badges', () => {
    createReputation('user-1');
    createReputation('user-2');

    for (let i = 0; i < 12; i += 1) {
      recordTransaction('user-1', 'completed');
    }
    const afterCompleted = getReputation('user-1');
    expect(afterCompleted?.score).toBe(620);
    expect(afterCompleted?.tier).toBe('silver');

    recordTransaction('user-1', 'disputed');
    expect(getReputation('user-1')?.score).toBe(600);

    awardBadge('user-1', 'Fast Payer', 'Paid 10 invoices on time');
    expect(getReputation('user-1')?.badges).toHaveLength(1);

    const snap = getReputationSnapshot('user-1');
    expect(snap?.rankPercentile).toBe(100);
  });

  it('completes a valid challenge-response reset and prevents replay', () => {
    createReputation('user-reset');
    recordTransaction('user-reset', 'disputed', 5); // 500 - 100 = 400
    expect(getReputation('user-reset')?.score).toBe(400);

    const challenge = initiateReputationReset('user-reset', {
      reason: 'account_recovery',
    });
    expect(getResetChallenge(challenge.challengeId)?.used).toBe(false);

    const signature = computeResetChallengeResponse(
      'user-reset',
      challenge.challengeId,
      challenge.nonce,
      'test-secret',
    );
    const result = completeReputationReset(
      'user-reset',
      challenge.challengeId,
      signature,
      'test-secret',
    );

    expect(result.previousScore).toBe(400);
    expect(result.newScore).toBe(500);
    expect(result.tier).toBe('bronze');
    expect(getReputation('user-reset')?.transactionCount).toBe(0);
    expect(getResetChallenge(challenge.challengeId)?.used).toBe(true);

    // Replay must fail.
    expect(() =>
      completeReputationReset(
        'user-reset',
        challenge.challengeId,
        signature,
        'test-secret',
      ),
    ).toThrow(/already been used/i);
  });

  it('rejects bad signatures, wrong user, unknown user, and expired challenges', () => {
    expect(() => initiateReputationReset('nobody')).toThrow(/not found/i);

    createReputation('user-a');
    const challenge = initiateReputationReset('user-a');

    expect(() =>
      completeReputationReset('user-a', challenge.challengeId, 'deadbeef'),
    ).toThrow(/Invalid challenge-response signature/i);

    expect(() =>
      completeReputationReset('user-b', challenge.challengeId, 'deadbeef'),
    ).toThrow(/Invalid reputation reset challenge/i);

    const expired = initiateReputationReset('user-a', { ttlMs: 1 });
    const sig = computeResetChallengeResponse(
      'user-a',
      expired.challengeId,
      expired.nonce,
    );
    // Wait 5ms so Date.now() > expiresAt
    const end = Date.now() + 5;
    while (Date.now() < end) {
      // spin
    }
    expect(() =>
      completeReputationReset('user-a', expired.challengeId, sig),
    ).toThrow(/expired/i);
  });
});
