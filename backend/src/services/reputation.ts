import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { logger } from '../utils/logger.js';

export type TrustTier = 'bronze' | 'silver' | 'gold' | 'platinum';

export type ReputationBadge = {
  id: string;
  name: string;
  description: string;
  awardedAt: string;
};

export type ReputationRecord = {
  userId: string;
  score: number;
  tier: TrustTier;
  factors: {
    completionRate: number;
    timelinessScore: number;
    qualityScore: number;
    disputeRate: number;
  };
  badges: ReputationBadge[];
  transactionCount: number;
  lastActivityAt: string;
  decayApplied: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ReputationSnapshot = {
  userId: string;
  score: number;
  tier: TrustTier;
  rankPercentile: number;
};

const MAX_DECAY_DAYS = 90;
const DECAY_FACTOR = 0.95;

const reputationStore = new Map<string, ReputationRecord>();
const activityIndex = new Map<string, Set<string>>();

function computeTier(score: number): TrustTier {
  if (score >= 950) return 'platinum';
  if (score >= 800) return 'gold';
  if (score >= 600) return 'silver';
  return 'bronze';
}

function applyDecay(record: ReputationRecord): ReputationRecord {
  const lastActivity = Date.parse(record.lastActivityAt);
  const daysSinceActivity = (Date.now() - lastActivity) / (1000 * 60 * 60 * 24);
  if (daysSinceActivity > MAX_DECAY_DAYS) {
    const decayedScore = Math.max(0, Math.floor(record.score * DECAY_FACTOR));
    return {
      ...record,
      score: decayedScore,
      tier: computeTier(decayedScore),
      decayApplied: true,
      updatedAt: new Date().toISOString(),
    };
  }
  return record;
}

export function createReputation(userId: string): ReputationRecord {
  const record: ReputationRecord = {
    userId,
    score: 500,
    tier: 'bronze',
    factors: {
      completionRate: 0,
      timelinessScore: 0,
      qualityScore: 0,
      disputeRate: 0,
    },
    badges: [],
    transactionCount: 0,
    lastActivityAt: new Date().toISOString(),
    decayApplied: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  reputationStore.set(userId, record);
  return record;
}

export function recordTransaction(userId: string, event: 'completed' | 'late' | 'disputed' | 'quality_rated', weight = 1): ReputationRecord {
  let record = reputationStore.get(userId);
  if (!record) {
    record = createReputation(userId);
  }

  const completed = event === 'completed' ? 1 : 0;
  const late = event === 'late' ? 1 : 0;
  const disputed = event === 'disputed' ? 1 : 0;

  record.factors.completionRate = ((record.factors.completionRate * record.transactionCount + completed) / (record.transactionCount + 1)) * 100;
  record.factors.timelinessScore = ((record.factors.timelinessScore * record.transactionCount + (late ? 0 : 1)) / (record.transactionCount + 1)) * 100;
  record.factors.disputeRate = ((record.factors.disputeRate * record.transactionCount + disputed) / (record.transactionCount + 1)) * 100;
  record.transactionCount += 1;

  const scoreDelta =
    completed * 10 * weight -
    late * 5 * weight -
    disputed * 20 * weight;

  record.score = Math.max(0, Math.min(1000, record.score + scoreDelta));
  record.tier = computeTier(record.score);
  record.lastActivityAt = new Date().toISOString();
  record.updatedAt = new Date().toISOString();

  const timestamps = activityIndex.get(userId) ?? new Set<string>();
  timestamps.add(String(Date.now()));
  activityIndex.set(userId, timestamps);

  record = applyDecay(record);
  reputationStore.set(userId, record);
  return record;
}

export function awardBadge(userId: string, name: string, description: string): ReputationRecord {
  const record = reputationStore.get(userId);
  if (!record) throw new Error('Reputation record not found');

  const badge: ReputationBadge = {
    id: `badge_${randomUUID().slice(0, 8)}`,
    name,
    description,
    awardedAt: new Date().toISOString(),
  };

  record.badges.push(badge);
  record.updatedAt = new Date().toISOString();
  reputationStore.set(userId, record);
  return record;
}

export function getReputation(userId: string): ReputationRecord | undefined {
  const record = reputationStore.get(userId);
  if (!record) return undefined;
  return applyDecay(record);
}

export function getReputationSnapshot(userId: string): ReputationSnapshot | undefined {
  const record = getReputation(userId);
  if (!record) return undefined;

  const all = Array.from(reputationStore.values()).map((r) => r.score).sort((a, b) => a - b);
  const rank = all.filter((s) => s <= record.score).length;
  const percentile = Math.floor((rank / all.length) * 100);

  return {
    userId,
    score: record.score,
    tier: record.tier,
    rankPercentile: percentile,
  };
}

export function listReputations(): ReputationRecord[] {
  return Array.from(reputationStore.values()).map(applyDecay);
}

export function detectGamingPattern(userId: string): { suspicious: boolean; reason?: string } {
  const record = reputationStore.get(userId);
  if (!record || record.transactionCount < 5) return { suspicious: false };

  const now = Date.now();
  const recent = Array.from(activityIndex.get(userId) || []);
  const lastMinute = recent.filter((t) => now - Number(t) < 60_000).length;

  if (lastMinute > 20) {
    return { suspicious: true, reason: 'High velocity transactions detected' };
  }

  return { suspicious: false };
}

export function recalculateAll(): void {
  for (const [userId, record] of reputationStore.entries()) {
    const refreshed = applyDecay(record);
    refreshed.updatedAt = new Date().toISOString();
    reputationStore.set(userId, refreshed);
  }
}

export type ReputationResetChallenge = {
  challengeId: string;
  userId: string;
  nonce: string;
  reason: string;
  issuedAt: string;
  expiresAt: string;
  used: boolean;
};

export type ReputationResetResult = {
  userId: string;
  challengeId: string;
  previousScore: number;
  newScore: number;
  tier: TrustTier;
  resetAt: string;
};

const DEFAULT_RESET_CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_RESET_CHALLENGE_TTL_MS = 60 * 60 * 1000;
const resetChallengeStore = new Map<string, ReputationResetChallenge>();

function getResetSecret(override?: string): string {
  return override || process.env.REPUTATION_RESET_SECRET || 'agenticpay-reputation-reset-secret';
}

/**
 * Compute the expected HMAC-SHA256 challenge-response signature for a
 * reputation reset challenge.
 */
export function computeResetChallengeResponse(
  userId: string,
  challengeId: string,
  nonce: string,
  secret?: string,
): string {
  return createHmac('sha256', getResetSecret(secret))
    .update(`${userId}:${challengeId}:${nonce}`)
    .digest('hex');
}

/**
 * Start a challenge-response reputation reset for a user.
 */
export function initiateReputationReset(
  userId: string,
  options: { reason?: string; ttlMs?: number } = {},
): ReputationResetChallenge {
  const record = reputationStore.get(userId);
  if (!record) {
    throw new Error(`Reputation record not found for user: ${userId}`);
  }

  const ttlMs = options.ttlMs ?? DEFAULT_RESET_CHALLENGE_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_RESET_CHALLENGE_TTL_MS) {
    throw new Error(`Reset challenge TTL must be between 1ms and ${MAX_RESET_CHALLENGE_TTL_MS}ms`);
  }

  const now = Date.now();
  const challenge: ReputationResetChallenge = {
    challengeId: `rst_${randomUUID().slice(0, 12)}`,
    userId,
    nonce: randomBytes(16).toString('hex'),
    reason: options.reason?.trim() || 'user_requested_reset',
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    used: false,
  };

  resetChallengeStore.set(challenge.challengeId, challenge);
  logger.info('reputation.reset_challenge_issued', {
    userId,
    challengeId: challenge.challengeId,
    expiresAt: challenge.expiresAt,
  });
  return { ...challenge };
}

/**
 * Complete a challenge-response reputation reset after verifying the HMAC
 * response signature with constant-time comparison.
 */
export function completeReputationReset(
  userId: string,
  challengeId: string,
  responseSignature: string,
  secret?: string,
): ReputationResetResult {
  const challenge = resetChallengeStore.get(challengeId);
  if (!challenge || challenge.userId !== userId) {
    logger.warn('reputation.reset_rejected', { userId, challengeId, reason: 'not_found' });
    throw new Error('Invalid reputation reset challenge');
  }
  if (challenge.used) {
    logger.warn('reputation.reset_rejected', { userId, challengeId, reason: 'already_used' });
    throw new Error('Reputation reset challenge has already been used');
  }
  if (Date.now() > Date.parse(challenge.expiresAt)) {
    logger.warn('reputation.reset_rejected', { userId, challengeId, reason: 'expired' });
    throw new Error('Reputation reset challenge has expired');
  }

  const expected = computeResetChallengeResponse(
    userId,
    challenge.challengeId,
    challenge.nonce,
    secret,
  );
  const providedBuf = Buffer.from(responseSignature, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(providedBuf, expectedBuf)
  ) {
    logger.warn('reputation.reset_rejected', { userId, challengeId, reason: 'bad_signature' });
    throw new Error('Invalid challenge-response signature');
  }

  const record = reputationStore.get(userId);
  if (!record) {
    throw new Error(`Reputation record not found for user: ${userId}`);
  }

  const previousScore = record.score;
  const resetAt = new Date().toISOString();
  const updated: ReputationRecord = {
    ...record,
    score: 500,
    tier: computeTier(500),
    factors: {
      completionRate: 0,
      timelinessScore: 0,
      qualityScore: 0,
      disputeRate: 0,
    },
    transactionCount: 0,
    decayApplied: false,
    lastActivityAt: resetAt,
    updatedAt: resetAt,
  };

  challenge.used = true;
  resetChallengeStore.set(challengeId, challenge);
  reputationStore.set(userId, updated);
  activityIndex.delete(userId);

  logger.info('reputation.reset_completed', {
    userId,
    challengeId,
    previousScore,
    newScore: updated.score,
  });

  return {
    userId,
    challengeId,
    previousScore,
    newScore: updated.score,
    tier: updated.tier,
    resetAt,
  };
}

export function getResetChallenge(challengeId: string): ReputationResetChallenge | undefined {
  const challenge = resetChallengeStore.get(challengeId);
  return challenge ? { ...challenge } : undefined;
}

export function resetReputationStoreForTests(): void {
  reputationStore.clear();
  activityIndex.clear();
  resetChallengeStore.clear();
}
