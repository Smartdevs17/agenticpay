import { randomUUID } from 'node:crypto';

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
