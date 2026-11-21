// dispute-voting.test.ts
//
// Unit tests for the dispute voting system: voting rounds, vote casting,
// tallying, and integration with the existing dispute lifecycle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/auditService.js', () => ({
  auditService: { logAction: vi.fn().mockResolvedValue(undefined) },
}));

import { DisputeService } from '../DisputeService.js';

function createTestDispute(service: DisputeService) {
  return service.createDispute({
    projectId: 'proj-1',
    escrowId: 'esc-1',
    raisedBy: 'user-alice',
    raisedAgainst: 'user-bob',
    reason: 'Work was incomplete and milestones missed.',
  });
}

// ── startVotingRound ──────────────────────────────────────────────────────────
describe('startVotingRound', () => {
  let service: DisputeService;

  beforeEach(() => {
    service = new DisputeService();
  });

  it('creates a voting round with default 7-day deadline', async () => {
    const dispute = await createTestDispute(service);
    const before = Date.now();
    const round = service.startVotingRound(dispute.id, 2);
    const after = Date.now();

    expect(round.disputeId).toBe(dispute.id);
    expect(round.status).toBe('open');
    expect(round.votes).toEqual([]);
    expect(round.quorumRequired).toBe(2);
    expect(round.result).toBeNull();

    const deadlineTs = new Date(round.deadline).getTime();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(deadlineTs).toBeGreaterThanOrEqual(before + sevenDaysMs - 2000);
    expect(deadlineTs).toBeLessThanOrEqual(after + sevenDaysMs + 2000);
  });

  it('creates a round with a custom deadline', async () => {
    const dispute = await createTestDispute(service);
    const before = Date.now();
    const round = service.startVotingRound(dispute.id, 3, 14);
    const after = Date.now();

    const deadlineTs = new Date(round.deadline).getTime();
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    expect(deadlineTs).toBeGreaterThanOrEqual(before + fourteenDaysMs - 2000);
    expect(deadlineTs).toBeLessThanOrEqual(after + fourteenDaysMs + 2000);
  });

  it('throws if dispute does not exist', () => {
    expect(() => service.startVotingRound('nonexistent', 2)).toThrow(
      'Dispute nonexistent not found',
    );
  });

  it('throws if a voting round is already open', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 2);

    expect(() => service.startVotingRound(dispute.id, 2)).toThrow(
      `Voting round already open for dispute ${dispute.id}`,
    );
  });
});

// ── castVote ──────────────────────────────────────────────────────────────────
describe('castVote', () => {
  let service: DisputeService;

  beforeEach(() => {
    service = new DisputeService();
  });

  it('successfully casts a vote', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 3);

    const vote = service.castVote(
      dispute.id,
      'arb-1',
      'favor_client',
      'Evidence clearly supports client claim.',
      10,
    );

    expect(vote.disputeId).toBe(dispute.id);
    expect(vote.arbitratorId).toBe('arb-1');
    expect(vote.decision).toBe('favor_client');
    expect(vote.reasoning).toBe('Evidence clearly supports client claim.');
    expect(vote.weight).toBe(10);
    expect(vote.id).toBeDefined();
    expect(vote.votedAt).toBeDefined();
  });

  it('computes votePower = weight × arbitrator rating', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 3);

    // arb-1 has rating 4.8, weight 10 → votePower 48
    const vote = service.castVote(dispute.id, 'arb-1', 'favor_client', 'Strong evidence.', 10);
    expect(vote.votePower).toBe(48);

    // arb-2 has rating 4.6, weight 5 → votePower 23
    const vote2 = service.castVote(dispute.id, 'arb-2', 'favor_freelancer', 'Counter-evidence.', 5);
    expect(vote2.votePower).toBe(23);
  });

  it('throws if no open voting round exists', async () => {
    const dispute = await createTestDispute(service);

    expect(() =>
      service.castVote(dispute.id, 'arb-1', 'favor_client', 'reason', 10),
    ).toThrow(`No open voting round for dispute ${dispute.id}`);
  });

  it('throws if voting round has expired', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 3, 1);

    const round = service.getVotingRound(dispute.id)!;
    // Force the deadline to the past
    round.deadline = new Date(Date.now() - 1000).toISOString();

    expect(() =>
      service.castVote(dispute.id, 'arb-1', 'favor_client', 'reason', 10),
    ).toThrow(`Voting round for dispute ${dispute.id} has expired`);

    // Round should now be closed
    expect(service.getVotingRound(dispute.id)!.status).toBe('closed');
  });

  it('throws if arbitrator has already voted', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 3);

    service.castVote(dispute.id, 'arb-1', 'favor_client', 'First vote.', 10);

    expect(() =>
      service.castVote(dispute.id, 'arb-1', 'split', 'Changed mind.', 10),
    ).toThrow(`Arbitrator arb-1 has already voted on dispute ${dispute.id}`);
  });

  it('throws if arbitrator is not registered', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 3);

    expect(() =>
      service.castVote(dispute.id, 'arb-unknown', 'favor_client', 'reason', 10),
    ).toThrow('Arbitrator arb-unknown is not registered');
  });
});

// ── tallyVotes ────────────────────────────────────────────────────────────────
describe('tallyVotes', () => {
  let service: DisputeService;

  beforeEach(() => {
    service = new DisputeService();
  });

  it('tallies correctly with consensus (majority > 50%)', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 2);

    // arb-1 rating 4.8, weight 10 → 48 favor_client
    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Client is right.', 10);
    // arb-2 rating 4.6, weight 5 → 23 favor_client
    service.castVote(dispute.id, 'arb-2', 'favor_client', 'Also client.', 5);

    const round = service.tallyVotes(dispute.id);

    expect(round.status).toBe('tallied');
    expect(round.result).not.toBeNull();
    expect(round.result!.decision).toBe('favor_client');
    expect(round.result!.totalWeight).toBe(71);
    expect(round.result!.consensusReached).toBe(true);
  });

  it("returns 'split_decision' when quorum is met but no majority", async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 2);

    // arb-1 rating 4.8, weight 10 → 48 favor_client
    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Client.', 10);
    // arb-3 rating 4.9, weight 10 → 49 favor_freelancer
    service.castVote(dispute.id, 'arb-3', 'favor_freelancer', 'Freelancer.', 10);

    const round = service.tallyVotes(dispute.id);

    expect(round.result!.decision).toBe('split_decision');
    expect(round.result!.consensusReached).toBe(true);
    expect(round.result!.totalWeight).toBe(97);
  });

  it("returns 'no_consensus' when quorum is not met", async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 5); // quorum of 5

    // Only one vote — far below quorum
    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Client.', 10);

    const round = service.tallyVotes(dispute.id);

    expect(round.result!.decision).toBe('no_consensus');
    expect(round.result!.consensusReached).toBe(false);
    expect(round.result!.totalWeight).toBe(48);
  });

  it('is idempotent after the first tally', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 1);

    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Clear.', 10);

    const first = service.tallyVotes(dispute.id);
    const second = service.tallyVotes(dispute.id);

    expect(second.status).toBe('tallied');
    expect(second.result!.decision).toBe(first.result!.decision);
    expect(second.result!.totalWeight).toBe(first.result!.totalWeight);
  });

  it('throws if no voting round exists', () => {
    expect(() => service.tallyVotes('nonexistent')).toThrow(
      'No voting round found for dispute nonexistent',
    );
  });
});

// ── getVotingRound / isVotingOpen ─────────────────────────────────────────────
describe('getVotingRound / isVotingOpen', () => {
  let service: DisputeService;

  beforeEach(() => {
    service = new DisputeService();
  });

  it('getVotingRound returns the correct round', async () => {
    const dispute = await createTestDispute(service);
    const created = service.startVotingRound(dispute.id, 2, 7);

    const retrieved = service.getVotingRound(dispute.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.disputeId).toBe(created.disputeId);
    expect(retrieved!.deadline).toBe(created.deadline);
    expect(retrieved!.quorumRequired).toBe(2);
  });

  it('getVotingRound returns undefined for non-existent dispute', () => {
    expect(service.getVotingRound('nonexistent')).toBeUndefined();
  });

  it('isVotingOpen returns true for an open round before its deadline', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 2, 7);

    expect(service.isVotingOpen(dispute.id)).toBe(true);
  });

  it('isVotingOpen returns false after the deadline', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 2, 1);

    // Force the deadline to the past
    const round = service.getVotingRound(dispute.id)!;
    round.deadline = new Date(Date.now() - 1000).toISOString();

    expect(service.isVotingOpen(dispute.id)).toBe(false);
  });

  it('isVotingOpen returns false for a non-existent dispute', () => {
    expect(service.isVotingOpen('nonexistent')).toBe(false);
  });

  it('isVotingOpen returns false after tally', async () => {
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 1);

    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Clear.', 10);
    service.tallyVotes(dispute.id);

    expect(service.isVotingOpen(dispute.id)).toBe(false);
  });
});

// ── Integration: full dispute → voting → tally flow ──────────────────────────
describe('Integration: full dispute voting flow', () => {
  it('creates dispute, starts voting, casts votes, and tallies', async () => {
    const service = new DisputeService();

    // 1. Create a dispute
    const dispute = await createTestDispute(service);
    expect(dispute.id).toBeDefined();
    expect(dispute.status).toMatch(/opened|under_review/);

    // 2. Start a voting round
    const round = service.startVotingRound(dispute.id, 2, 7);
    expect(round.status).toBe('open');
    expect(service.isVotingOpen(dispute.id)).toBe(true);

    // 3. Cast votes from two different arbitrators
    const vote1 = service.castVote(
      dispute.id,
      'arb-1',
      'favor_client',
      'Client provided screenshots proving work was never started.',
      10,
    );
    expect(vote1.votePower).toBe(48); // 10 × 4.8

    const vote2 = service.castVote(
      dispute.id,
      'arb-3',
      'favor_client',
      'Contract terms were clearly violated.',
      8,
    );
    expect(vote2.votePower).toBe(39.2); // 8 × 4.9

    // 4. Tally
    const result = service.tallyVotes(dispute.id);
    expect(result.status).toBe('tallied');
    expect(result.result!.decision).toBe('favor_client');
    expect(result.result!.totalWeight).toBe(87.2);
    expect(result.result!.consensusReached).toBe(true);

    // 5. Verify round is no longer open
    expect(service.isVotingOpen(dispute.id)).toBe(false);

    // 6. Verify original dispute record is unchanged
    const disputeRecord = service.getDispute(dispute.id);
    expect(disputeRecord!.id).toBe(dispute.id);
  });

  it('handles split decision across three arbitrators', async () => {
    const service = new DisputeService();
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 3, 7);

    // arb-1: 4.8 rating, weight 10 → 48 favor_client
    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Client.', 10);
    // arb-2: 4.6 rating, weight 10 → 46 favor_freelancer
    service.castVote(dispute.id, 'arb-2', 'favor_freelancer', 'Freelancer.', 10);
    // arb-3: 4.9 rating, weight 3 → 14.7 split
    service.castVote(dispute.id, 'arb-3', 'split', 'Partial blame.', 3);

    const result = service.tallyVotes(dispute.id);
    expect(result.result!.decision).toBe('split_decision');
    expect(result.result!.totalWeight).toBeCloseTo(108.7);
  });

  it('throws on duplicate vote and expired round', async () => {
    const service = new DisputeService();
    const dispute = await createTestDispute(service);
    service.startVotingRound(dispute.id, 2, 1);

    service.castVote(dispute.id, 'arb-1', 'favor_client', 'Vote 1', 10);

    // Duplicate vote
    expect(() =>
      service.castVote(dispute.id, 'arb-1', 'split', 'Vote 2', 5),
    ).toThrow('Arbitrator arb-1 has already voted');

    // Expire the round
    const round = service.getVotingRound(dispute.id)!;
    round.deadline = new Date(Date.now() - 1000).toISOString();

    expect(() =>
      service.castVote(dispute.id, 'arb-2', 'favor_client', 'Vote 3', 5),
    ).toThrow('has expired');
  });
});
