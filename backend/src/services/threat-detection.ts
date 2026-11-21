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
  IpBlock,
  ThreatAlert,
  IncidentPlaybook,
  ThreatRuleType,
} from '../types/threat-detection.js';

const baselines = new Map<string, UserBaseline>();
const behaviorHistory = new Map<string, BehaviorEvent[]>();
const threats = new Map<string, ThreatEvent>();
const lockedAccounts = new Set<string>();

// ── IP blocking state (Issue #394) ───────────────────────────────────────────
const ipBlocks = new Map<string, IpBlock>();
const threatAlerts: ThreatAlert[] = [];
const MAX_THREAT_ALERTS = 5000;

// IP auto-block thresholds
const IP_BLOCK_THRESHOLD_SCORE = 85;
const IP_BLOCK_DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1 hour

// ── Incident response playbooks (Issue #394) ──────────────────────────────────
const INCIDENT_PLAYBOOKS: IncidentPlaybook[] = [
  {
    ruleType: 'brute_force',
    severity: 'high',
    steps: [
      'Lock the affected account immediately.',
      'Block the source IP for at least 1 hour.',
      'Notify the account owner via email/SMS.',
      'Require password reset on next login.',
      'Review authentication logs for the last 24 hours.',
    ],
  },
  {
    ruleType: 'credential_stuffing',
    severity: 'critical',
    steps: [
      'Activate CAPTCHA challenge for the IP range.',
      'Force re-authentication for all sessions from affected IPs.',
      'Rotate affected API keys immediately.',
      'Alert security team via PagerDuty.',
      'Cross-reference failed logins with known breach databases.',
    ],
  },
  {
    ruleType: 'api_scraping',
    severity: 'medium',
    steps: [
      'Rate-limit the offending IP to 1 req/s.',
      'Inject honeypot responses to detect further scraping.',
      'Review scraped endpoints for sensitive data exposure.',
      'Consider serving degraded responses to the IP.',
    ],
  },
  {
    ruleType: 'anomaly',
    severity: 'medium',
    steps: [
      'Flag the session for manual review.',
      'Require step-up authentication for sensitive operations.',
      'Log all requests from this session for audit.',
    ],
  },
  {
    ruleType: 'threat_intel',
    severity: 'critical',
    steps: [
      'Block the IP immediately.',
      'Alert the security team.',
      'Review all recent requests from this IP.',
      'Check for data exfiltration patterns.',
    ],
  },
  {
    ruleType: 'user_agent',
    severity: 'high',
    steps: [
      'Block or challenge the request immediately.',
      'Review endpoint logs for automated scanning patterns.',
      'Add the user-agent pattern to WAF block rules.',
    ],
  },
];

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
    factors.push({ name: 'malicious_ip', contribution, details: `IP ${event.ipAddress} is in threat intel feed`, ruleType: 'threat_intel' as ThreatRuleType });
  }

  // Suspicious user agent
  for (const pattern of threatIntel.suspiciousPatterns) {
    if (pattern.test(event.userAgent)) {
      const contribution = 35;
      score += contribution;
      factors.push({ name: 'suspicious_user_agent', contribution, details: `User agent matches suspicious pattern: ${event.userAgent}`, ruleType: 'user_agent' as ThreatRuleType });
      break;
    }
  }

  // Brute force: many failed auth attempts from the same IP in 10 minutes
  const tenMinAgo = Date.now() - 10 * 60 * 1000;
  const authActions = ['login', 'authenticate', 'auth', 'signin', 'token'];
  const recentAuthFails = history.filter(
    (e) =>
      new Date(e.timestamp).getTime() >= tenMinAgo &&
      e.ipAddress === event.ipAddress &&
      authActions.some((a) => e.action.toLowerCase().includes(a)) &&
      e.statusCode === 401,
  );
  if (recentAuthFails.length >= 5) {
    const contribution = Math.min(30, recentAuthFails.length * 3);
    score += contribution;
    factors.push({ name: 'brute_force', contribution, details: `${recentAuthFails.length} failed auth attempts from ${event.ipAddress} in 10 min`, ruleType: 'brute_force' as ThreatRuleType });
  }

  // Credential stuffing: many unique user IDs failing auth from same IP
  const recentIpHistory = history.filter(
    (e) => new Date(e.timestamp).getTime() >= tenMinAgo && e.ipAddress === event.ipAddress && e.statusCode === 401,
  );
  const uniqueUsers = new Set(recentIpHistory.map((e) => e.userId)).size;
  if (uniqueUsers >= 3 && recentIpHistory.length >= 10) {
    const contribution = 25;
    score += contribution;
    factors.push({ name: 'credential_stuffing', contribution, details: `${uniqueUsers} distinct accounts targeted from ${event.ipAddress}`, ruleType: 'credential_stuffing' as ThreatRuleType });
  }

  // API scraping: rapid sequential requests to many different endpoints in 5 minutes
  const fiveMinAgo = Date.now() - 5 * 60 * 1000;
  const recentEndpoints = history.filter((e) => new Date(e.timestamp).getTime() >= fiveMinAgo && e.ipAddress === event.ipAddress);
  const uniqueEndpoints = new Set(recentEndpoints.map((e) => e.endpoint)).size;
  if (uniqueEndpoints >= 15) {
    const contribution = Math.min(25, uniqueEndpoints);
    score += contribution;
    factors.push({ name: 'api_scraping', contribution, details: `${uniqueEndpoints} distinct endpoints hit in 5 min from ${event.ipAddress}`, ruleType: 'api_scraping' as ThreatRuleType });
  }

  if (baseline) {
    // New IP not in baseline
    if (!baseline.commonIps.includes(event.ipAddress)) {
      const contribution = 15;
      score += contribution;
      factors.push({ name: 'new_ip_address', contribution, details: `IP ${event.ipAddress} not in established baseline`, ruleType: 'anomaly' as ThreatRuleType });
    }

    // Unusual hour
    const hour = new Date(event.timestamp).getHours();
    if (!baseline.typicalHours.includes(hour)) {
      const contribution = 10;
      score += contribution;
      factors.push({ name: 'unusual_hour', contribution, details: `Activity at hour ${hour} outside typical pattern`, ruleType: 'anomaly' as ThreatRuleType });
    }

    // Response time anomaly (4x slower than baseline may indicate heavy probing)
    if (event.durationMs > baseline.avgResponseTimeMs * 4 && baseline.avgResponseTimeMs > 0) {
      const contribution = 10;
      score += contribution;
      factors.push({ name: 'response_time_anomaly', contribution, details: `Response time ${event.durationMs}ms is 4x above baseline`, ruleType: 'anomaly' as ThreatRuleType });
    }

    // High request rate in last hour
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentCount = history.filter((e) => new Date(e.timestamp).getTime() >= hourAgo).length;
    if (recentCount > baseline.avgRequestsPerHour * 5) {
      const contribution = 20;
      score += contribution;
      factors.push({ name: 'request_rate_spike', contribution, details: `${recentCount} requests in last hour vs baseline ${Math.round(baseline.avgRequestsPerHour)}`, ruleType: 'anomaly' as ThreatRuleType });
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
    factors.push({ name: 'high_error_rate', contribution, details: `${errorCount} client errors in last 5 minutes`, ruleType: 'anomaly' as ThreatRuleType });
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

// ── Playbook lookup ───────────────────────────────────────────────────────────

function getPlaybookSteps(factors: AnomalyFactor[], severity: ThreatSeverity): string[] {
  const ruleTypes = [...new Set(factors.map((f) => f.ruleType).filter(Boolean) as ThreatRuleType[])];
  const steps = new Set<string>();

  for (const ruleType of ruleTypes) {
    const playbook = INCIDENT_PLAYBOOKS.find((p) => p.ruleType === ruleType);
    if (playbook) {
      for (const step of playbook.steps) steps.add(step);
    }
  }

  if (steps.size === 0) {
    const fallback = INCIDENT_PLAYBOOKS.find((p) => p.ruleType === 'anomaly');
    if (fallback) for (const step of fallback.steps) steps.add(step);
  }

  return Array.from(steps);
}

function emitThreatAlert(threat: ThreatEvent, factors: AnomalyFactor[], playbookSteps: string[]): void {
  const ruleTypes = [...new Set(factors.map((f) => f.ruleType).filter(Boolean) as ThreatRuleType[])];
  const primaryRule: ThreatRuleType = ruleTypes[0] ?? 'anomaly';

  const alert: ThreatAlert = {
    id: randomUUID(),
    threatId: threat.id,
    severity: threat.severity,
    ruleType: primaryRule,
    message: `Threat detected for user ${threat.userId} from ${threat.ipAddress} — score ${threat.anomalyScore} (${ruleTypes.join(', ')})`,
    userId: threat.userId,
    ipAddress: threat.ipAddress,
    sentAt: new Date().toISOString(),
    acknowledged: false,
    playbookSteps,
  };

  threatAlerts.push(alert);
  if (threatAlerts.length > MAX_THREAT_ALERTS) threatAlerts.shift();

  // Fire-and-forget webhook
  const webhookUrl = process.env.THREAT_ALERT_WEBHOOK_URL;
  if (webhookUrl) {
    void import('node-fetch').then(({ default: fetch }) =>
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(alert),
      }).catch(() => undefined),
    );
  }
}

function recordThreat(event: BehaviorEvent, score: AnomalyScore): ThreatEvent {
  const severity = severityFromScore(score.score);
  const shouldLock = severity === 'critical';

  if (shouldLock) {
    lockedAccounts.add(event.userId);
  }

  // Auto-block IP for high-severity threats
  const shouldBlockIp = score.score >= IP_BLOCK_THRESHOLD_SCORE;
  if (shouldBlockIp && !ipBlocks.has(event.ipAddress)) {
    const blockEntry: IpBlock = {
      ip: event.ipAddress,
      blockedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + IP_BLOCK_DEFAULT_DURATION_MS).toISOString(),
      reason: `Auto-blocked: anomaly score ${score.score}`,
      autoBlocked: true,
    };
    ipBlocks.set(event.ipAddress, blockEntry);
  }

  const playbookSteps = getPlaybookSteps(score.factors, severity);
  const ruleTypes = [...new Set(score.factors.map((f) => f.ruleType).filter(Boolean) as ThreatRuleType[])];

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
    ipBlocked: shouldBlockIp,
    playbookSteps,
    ruleTypes,
  };

  threats.set(threat.id, threat);
  emitThreatAlert(threat, score.factors, playbookSteps);
  return threat;
}

// ── IP block management (Issue #394) ─────────────────────────────────────────

export function blockIp(ip: string, opts: {
  reason: string;
  durationMs?: number;
  autoBlocked?: boolean;
} = { reason: 'manual block' }): IpBlock {
  const block: IpBlock = {
    ip,
    blockedAt: new Date().toISOString(),
    expiresAt: opts.durationMs ? new Date(Date.now() + opts.durationMs).toISOString() : undefined,
    reason: opts.reason,
    autoBlocked: opts.autoBlocked ?? false,
  };
  ipBlocks.set(ip, block);
  return block;
}

export function unblockIp(ip: string): boolean {
  return ipBlocks.delete(ip);
}

export function isIpBlocked(ip: string): boolean {
  const block = ipBlocks.get(ip);
  if (!block) return false;
  if (block.expiresAt && new Date(block.expiresAt).getTime() < Date.now()) {
    ipBlocks.delete(ip);
    return false;
  }
  return true;
}

export function getIpBlocks(): IpBlock[] {
  // Prune expired blocks
  for (const [ip, block] of ipBlocks.entries()) {
    if (block.expiresAt && new Date(block.expiresAt).getTime() < Date.now()) {
      ipBlocks.delete(ip);
    }
  }
  return Array.from(ipBlocks.values());
}

export function getThreatAlerts(unacknowledgedOnly = false): ThreatAlert[] {
  return unacknowledgedOnly ? threatAlerts.filter((a) => !a.acknowledged) : [...threatAlerts];
}

export function acknowledgeThreatAlert(alertId: string): boolean {
  const alert = threatAlerts.find((a) => a.id === alertId);
  if (!alert) return false;
  alert.acknowledged = true;
  return true;
}

export function getIncidentPlaybooks(): IncidentPlaybook[] {
  return [...INCIDENT_PLAYBOOKS];
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
