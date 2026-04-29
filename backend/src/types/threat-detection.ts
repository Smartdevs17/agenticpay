export type ThreatSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ThreatStatus = 'open' | 'investigating' | 'resolved' | 'false_positive';

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
}

export interface ThreatIntelFeed {
  maliciousIps: Set<string>;
  suspiciousPatterns: RegExp[];
  lastRefreshed: string;
}
