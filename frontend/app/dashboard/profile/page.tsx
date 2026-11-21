'use client';

import React, { useEffect, useState, useCallback } from 'react';

// ─── Types (mirrors backend) ──────────────────────────────────────────────────

type TrustTier = 'bronze' | 'silver' | 'gold' | 'platinum';

interface ReputationBadge {
  id: string;
  name: string;
  description: string;
  awardedAt: string;
}

interface ReputationRecord {
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
}

interface ReputationSnapshot {
  userId: string;
  score: number;
  tier: TrustTier;
  rankPercentile: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<TrustTier, string> = {
  bronze: 'bg-amber-100 text-amber-800',
  silver: 'bg-gray-100 text-gray-800',
  gold: 'bg-yellow-100 text-yellow-800',
  platinum: 'bg-purple-100 text-purple-800',
};

function FactorBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 text-sm text-gray-600">{label}</span>
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full"
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
      <span className="w-12 text-sm text-right text-gray-800">{value.toFixed(1)}%</span>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const [userId] = useState('current-user');
  const [reputation, setReputation] = useState<ReputationRecord | null>(null);
  const [snapshot, setSnapshot] = useState<ReputationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReputation = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [repRes, snapRes] = await Promise.all([
        fetch(`/api/v1/reputation/${userId}`),
        fetch(`/api/v1/reputation/${userId}/snapshot`),
      ]);

      if (repRes.ok) {
        const data = await repRes.json();
        setReputation(data);
      } else if (repRes.status === 404) {
        setReputation(null);
      }

      if (snapRes.ok) {
        const data = await snapRes.json();
        setSnapshot(data);
      }
    } catch {
      setError('Failed to load reputation');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchReputation();
  }, [fetchReputation]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading reputation...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!reputation) {
    return (
      <div className="p-6">
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <p className="text-gray-500">No reputation record found. Complete transactions to build your reputation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reputation Profile</h1>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${TIER_COLORS[reputation.tier]}`}>
          {reputation.tier.charAt(0).toUpperCase() + reputation.tier.slice(1)}
        </span>
      </div>

      {/* Score Card */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center gap-8">
          <div className="text-center">
            <div className="text-4xl font-bold text-gray-900">{reputation.score}</div>
            <div className="text-sm text-gray-500">Score / 1000</div>
          </div>
          {snapshot && (
            <div className="text-center">
              <div className="text-4xl font-bold text-gray-900">Top {100 - snapshot.rankPercentile}%</div>
              <div className="text-sm text-gray-500">Rank</div>
            </div>
          )}
          <div className="text-center">
            <div className="text-4xl font-bold text-gray-900">{reputation.transactionCount}</div>
            <div className="text-sm text-gray-500">Transactions</div>
          </div>
          {reputation.decayApplied && (
            <div className="text-center">
              <div className="text-sm text-amber-600 font-medium">Decay Applied</div>
              <div className="text-xs text-gray-500">Inactive for 90+ days</div>
            </div>
          )}
        </div>
      </div>

      {/* Factors */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Performance Factors</h2>
        <div className="space-y-3">
          <FactorBar label="Completion Rate" value={reputation.factors.completionRate} />
          <FactorBar label="Timeliness" value={reputation.factors.timelinessScore} />
          <FactorBar label="Quality" value={reputation.factors.qualityScore} />
          <FactorBar label="Dispute Rate" value={100 - reputation.factors.disputeRate} />
        </div>
      </div>

      {/* Badges */}
      {reputation.badges.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Badges</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reputation.badges.map((badge) => (
              <div key={badge.id} className="bg-gray-50 rounded-lg p-4">
                <div className="font-medium text-gray-900">{badge.name}</div>
                <div className="text-sm text-gray-600 mt-1">{badge.description}</div>
                <div className="text-xs text-gray-400 mt-2">
                  Awarded {new Date(badge.awardedAt).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-gray-400">
        Last activity: {new Date(reputation.lastActivityAt).toLocaleString()} ·
        Updated: {new Date(reputation.updatedAt).toLocaleString()}
      </div>
    </div>
  );
}
