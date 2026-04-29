import { randomUUID } from 'node:crypto';
import type {
  AnomalyFactor,
  AnomalyScore,
  BehaviorEvent,
  ThreatEvent,
  ThreatIntelFeed,
  ThreatSeverity,
  ThreatStatus,
  UserBaseline,
} from '../types/threat-detection.js';

const baselines = new Map<string, UserBaseline>();
const behaviorHistory = new Map<string, BehaviorEvent[]>();
const threats = new Map<string, ThreatEvent>();
const lockedAccounts = new Set<string>();

const BASELINE_WINDOW_HOURS = 168; // 7 days
const HIGH_SCORE_THRESHOLD = 75;
const CRITICAL_SCORE_THRESHOLD = 90;
const MAX_HISTORY_PER_USER = 1000;

const threatIntel: ThreatIntelFeed = {
  maliciousIps: new Set([
    '192.0.2.0',
    '198.51.100.0',
    '203.0.113.0',
  ]),
  suspiciousPatterns: [
    /sqlmap/i,
    /nikto/i,
    /masscan/i,
    /nmap/i,
    /hydra/i,
  ],
  lastRefreshed: new Date().toISOString(),
};

export function recordBehaviorEvent(event: BehaviorEvent): AnomalyScore {
  const history = behaviorHistory.get(event.userId) ?? [];
  history.push(event);
  if (history.length > MAX_HISTORY_PER_USER) {
    history.splice(0, history.length - MAX_HISTORY_PER_USER);
  }
  behaviorHistory.set(event.userId, history);

  updateBaseline(event.userId, history);
  const score = computeAnomalyScore(event, history);

  if (score.score >= HIGH_SCORE_THRESHOLD) {
    recordThreat(event, score);
  }

  return score;
}

function updateBaseline(userId: string, history: BehaviorEvent[]): void {
  const cutoff = Date.now() - BASELINE_WINDOW_HOURS * 60 * 60 * 1000;
  const recent = history.filter((e) => new Date(e.timestamp).getTime() >= cutoff);

  if (recent.length < 5) return;

  const ipCounts = new Map<string, number>();
  const uaCounts = new Map<string, number>();
  const endpointCounts = new Map<string, number>();
  const hourCounts = new Map<number, number>();
  let totalDuration = 0;

  for (const e of recent) {
    ipCounts.set(e.ipAddress, (ipCounts.get(e.ipAddress) ?? 0) + 1);
    uaCounts.set(e.userAgent, (uaCounts.get(e.userAgent) ?? 0) + 1);
    endpointCounts.set(e.endpoint, (endpointCounts.get(e.endpoint) ?? 0) + 1);
    const hour = new Date(e.timestamp).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + 1);
    totalDuration += e.durationMs;
  }

  const topN = <K>(map: Map<K, number>, n: number): K[] =>
    Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k]) => k);

  const daySpan = Math.max(1, BASELINE_WINDOW_HOURS / 24);
  const hourSpan = Math.max(1, BASELINE_WINDOW_HOURS);

  baselines.set(userId, {
    userId,
    avgRequestsPerHour: recent.length / hourSpan,
    avgRequestsPerDay: recent.length / daySpan,
    commonIps: topN(ipCounts, 5),
    commonUserAgents: topN(uaCounts, 3),
    commonEndpoints: topN(endpointCounts, 10),
    typicalHours: topN(hourCounts, 8),
    avgResponseTimeMs: totalDuration / recent.length,
    lastUpdated: new Date().toISOString(),
    sampleCount: recent.length,
  });
}

function computeAnomalyScore(event: BehaviorEvent, history: BehaviorEvent[]): AnomalyScore {
  const factors: AnomalyFactor[] = [];
  let score = 0;

  const baseline = baselines.get(event.userId);

  // Threat intel check
  if (threatIntel.maliciousIps.has(event.ipAddress)) {
    const contribution = 40;
    score += contribution;
    factors.push({ name: 'malicious_ip', contribution, details: `IP ${event.ipAddress} is in threat intel feed` });
  }

  // Suspicious user agent
  for (const pattern of threatIntel.suspiciousPatterns) {
    if (pattern.test(event.userAgent)) {
      const contribution = 35;
      score += contribution;
      factors.push({ name: 'suspicious_user_agent', contribution, details: `User agent matches suspicious pattern: ${event.userAgent}` });
      break;
    }
  }

  if (baseline) {
    // New IP not in baseline
    if (!baseline.commonIps.includes(event.ipAddress)) {
      const contribution = 15;
      score += contribution;
      factors.push({ name: 'new_ip_address', contribution, details: `IP ${event.ipAddress} not in established baseline` });
    }

    // Unusual hour
    const hour = new Date(event.timestamp).getHours();
    if (!baseline.typicalHours.includes(hour)) {
      const contribution = 10;
      score += contribution;
      factors.push({ name: 'unusual_hour', contribution, details: `Activity at hour ${hour} outside typical pattern` });
    }

    // Response time anomaly (4x slower than baseline may indicate heavy probing)
    if (event.durationMs > baseline.avgResponseTimeMs * 4 && baseline.avgResponseTimeMs > 0) {
      const contribution = 10;
      score += contribution;
      factors.push({ name: 'response_time_anomaly', contribution, details: `Response time ${event.durationMs}ms is 4x above baseline` });
    }

    // High request rate in last hour
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = history.filter((e) => new Date(e.timestamp).getTime() >= hourAgo).length;
    if (recentCount > baseline.avgRequestsPerHour * 5) {
      const contribution = 20;
      score += contribution;
      factors.push({ name: 'request_rate_spike', contribution, details: `${recentCount} requests in last hour vs baseline ${Math.round(baseline.avgRequestsPerHour)}` });
    }
  }

  // Repeated 4xx errors — scanning pattern
  const recent5Min = history.filter(
    (e) => Date.now() - new Date(e.timestamp).getTime() < 5 * 60 * 1000
  );
  const errorCount = recent5Min.filter((e) => e.statusCode >= 400 && e.statusCode < 500).length;
  if (errorCount >= 10) {
    const contribution = Math.min(25, errorCount);
    score += contribution;
    factors.push({ name: 'high_error_rate', contribution, details: `${errorCount} client errors in last 5 minutes` });
  }

  return {
    userId: event.userId,
    score: Math.min(100, score),
    factors,
    computedAt: new Date().toISOString(),
  };
}

function severityFromScore(score: number): ThreatSeverity {
  if (score >= CRITICAL_SCORE_THRESHOLD) return 'critical';
  if (score >= HIGH_SCORE_THRESHOLD) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

function recordThreat(event: BehaviorEvent, score: AnomalyScore): ThreatEvent {
  const severity = severityFromScore(score.score);
  const shouldLock = severity === 'critical';

  if (shouldLock) {
    lockedAccounts.add(event.userId);
  }

  const threat: ThreatEvent = {
    id: randomUUID(),
    userId: event.userId,
    severity,
    status: 'open',
    anomalyScore: score.score,
    factors: score.factors,
    ipAddress: event.ipAddress,
    detectedAt: new Date().toISOString(),
    falsePositive: false,
    accountLocked: shouldLock,
  };

  threats.set(threat.id, threat);
  return threat;
}

export function getBaseline(userId: string): UserBaseline | undefined {
  return baselines.get(userId);
}

export function getAllThreats(): ThreatEvent[] {
  return Array.from(threats.values());
}

export function getThreatById(id: string): ThreatEvent | undefined {
  return threats.get(id);
}

export function getThreatsByUser(userId: string): ThreatEvent[] {
  return Array.from(threats.values()).filter((t) => t.userId === userId);
}

export function getOpenThreats(): ThreatEvent[] {
  return Array.from(threats.values()).filter((t) => t.status === 'open' || t.status === 'investigating');
}

export function updateThreatStatus(
  id: string,
  status: ThreatStatus,
  resolution?: string
): ThreatEvent | undefined {
  const threat = threats.get(id);
  if (!threat) return undefined;

  threat.status = status;
  if (resolution) threat.resolution = resolution;
  if (status === 'resolved' || status === 'false_positive') {
    threat.resolvedAt = new Date().toISOString();
    threat.falsePositive = status === 'false_positive';
    lockedAccounts.delete(threat.userId);
  }
  threats.set(id, threat);
  return threat;
}

export function unlockAccount(userId: string): boolean {
  return lockedAccounts.delete(userId);
}

export function isAccountLocked(userId: string): boolean {
  return lockedAccounts.has(userId);
}

export function getThreatStats() {
  const all = Array.from(threats.values());
  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
  const byStatus = { open: 0, investigating: 0, resolved: 0, false_positive: 0 };

  for (const t of all) {
    bySeverity[t.severity] += 1;
    byStatus[t.status] += 1;
  }

  return {
    total: all.length,
    bySeverity,
    byStatus,
    lockedAccounts: lockedAccounts.size,
    trackedUsers: baselines.size,
  };
}

export function refreshThreatIntel(maliciousIps: string[]): void {
  threatIntel.maliciousIps = new Set(maliciousIps);
  threatIntel.lastRefreshed = new Date().toISOString();
}

export function getThreatIntelStatus() {
  return {
    maliciousIpCount: threatIntel.maliciousIps.size,
    patternCount: threatIntel.suspiciousPatterns.length,
    lastRefreshed: threatIntel.lastRefreshed,
  };
}
