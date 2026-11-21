export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ThreatStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';

/** Extended threat rule categories (Issue #394). */
export type ThreatRuleType =
  | 'brute_force'
  | 'credential_stuffing'
  | 'api_scraping'
  | 'anomaly'
  | 'threat_intel'
  | 'user_agent';

export interface BehaviorEvent {
  userId: string;
  action: string;
  ipAddress: string;
  userAgent: string;
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface UserBaseline {
  userId: string;
  avgRequestsPerHour: number;
  avgRequestsPerDay: number;
  commonIps: string[];
  commonUserAgents: string[];
  commonEndpoints: string[];
  typicalHours: number[];
  avgResponseTimeMs: number;
  lastUpdated: string;
  sampleCount: number;
}

export interface AnomalyScore {
  userId: string;
  score: number;
  factors: AnomalyFactor[];
  computedAt: string;
}

export interface AnomalyFactor {
  name: string;
  contribution: number;
  details: string;
  ruleType?: ThreatRuleType;
}

export interface ThreatEvent {
  id: string;
  userId: string;
  severity: ThreatSeverity;
  status: ThreatStatus;
  anomalyScore: number;
  factors: AnomalyFactor[];
  ipAddress: string;
  detectedAt: string;
  resolvedAt?: string;
  resolution?: string;
  falsePositive: boolean;
  accountLocked: boolean;
  /** IP auto-block record if an IP-level block was triggered. */
  ipBlocked?: boolean;
  /** Incident response playbook steps for this threat. */
  playbookSteps?: string[];
  ruleTypes?: ThreatRuleType[];
}

export interface ThreatIntelFeed {
  maliciousIps: Set<string>;
  suspiciousPatterns: RegExp[];
  lastRefreshed: string;
}

/** IP-level block entry (Issue #394). */
export interface IpBlock {
  ip: string;
  blockedAt: string;
  expiresAt?: string;
  reason: string;
  autoBlocked: boolean;
}

/** Alert emitted by the real-time monitoring pipeline (Issue #394). */
export interface ThreatAlert {
  id: string;
  threatId: string;
  severity: ThreatSeverity;
  ruleType: ThreatRuleType;
  message: string;
  userId: string;
  ipAddress: string;
  sentAt: string;
  acknowledged: boolean;
  playbookSteps: string[];
}

/** Incident response playbook (Issue #394). */
export interface IncidentPlaybook {
  ruleType: ThreatRuleType;
  severity: ThreatSeverity;
  steps: string[];
}
