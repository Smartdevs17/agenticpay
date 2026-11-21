/**
 * AML Transaction Monitoring with Risk Scoring — Issue #922
 *
 * Applies a deterministic, explainable rule engine to every payment that flows
 * through the platform and produces a 0-100 risk score plus the list of rules
 * that fired. High and critical assessments are turned into AML alerts that can
 * be triaged through the API.
 *
 * The design mirrors `services/fraud-detection.ts`: pure scoring functions with
 * no external I/O, an in-memory alert store, and small composable helpers so the
 * math can be unit tested without a database.
 */

import { randomUUID } from 'node:crypto';

export type AmlRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AmlAlertStatus = 'open' | 'under_review' | 'resolved' | 'dismissed';
export type AmlAlertSeverity = 'medium' | 'high' | 'critical';

export interface AmlTransaction {
  transactionId: string;
  accountId: string;
  counterpartyId?: string;
  amount: number;
  currency: string;
  /** Epoch milliseconds or ISO-8601 string. */
  timestamp: number | string;
  direction?: 'inbound' | 'outbound';
  channel?: 'crypto' | 'bank' | 'card' | 'wallet';
  originCountry?: string;
  destinationCountry?: string;
  counterpartySanctioned?: boolean;
  counterpartyIsPep?: boolean;
  /** Number of near-threshold transactions observed from the same account. */
  structuringSignals?: number;
  metadata?: Record<string, unknown>;
}

export interface AmlAccountContext {
  accountId: string;
  accountAgeDays?: number;
  kycVerified?: boolean;
  customerRiskRating?: 'low' | 'medium' | 'high';
  transactionsLastHour?: number;
  transactionsLast24h?: number;
  totalAmountLast24h?: number;
  /** Historical average transaction amount for this account. */
  baselineAmount?: number;
  /** Wave of different counterparties in the last 24h. */
  distinctCounterpartiesLast24h?: number;
  /** Countries considered high risk by the institution's risk appetite. */
  highRiskCountries?: string[];
  /** Established counterparties that never require heightened scrutiny. */
  knownCounterparties?: string[];
}

export interface AmlRuleMatch {
  ruleId: string;
  name: string;
  description: string;
  weight: number;
  severity: AmlAlertSeverity;
  details?: Record<string, unknown>;
}

export interface AmlAssessment {
  transactionId: string;
  accountId: string;
  score: number;
  level: AmlRiskLevel;
  matches: AmlRuleMatch[];
  recommendedAction: 'allow' | 'monitor' | 'review' | 'block_and_report';
  requiresSarFiling: boolean;
  assessedAt: string;
}

export interface AmlAlert {
  id: string;
  transactionId: string;
  accountId: string;
  severity: AmlAlertSeverity;
  status: AmlAlertStatus;
  score: number;
  level: AmlRiskLevel;
  reasons: string[];
  matches: AmlRuleMatch[];
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string;
  resolution?: string;
}

export interface AmlMonitoringSummary {
  assessed: number;
  alertsCreated: number;
  byLevel: Record<AmlRiskLevel, number>;
  highestScore: number;
  averageScore: number;
  generatedAt: string;
}

export interface AmlRuleContext {
  transaction: AmlTransaction;
  account?: AmlAccountContext;
}

export interface AmlRule {
  id: string;
  name: string;
  description: string;
  weight: number;
  severity: AmlAlertSeverity;
  evaluate: (context: AmlRuleContext) => AmlRuleMatch | null;
}

// ─── Thresholds ───────────────────────────────────────────────────────────────

export const AML_THRESHOLDS = {
  /** FinCEN CTR reporting threshold (USD). */
  ctrAmount: 10_000,
  /** Fraction of the CTR threshold treated as structuring behaviour. */
  structuringBand: 0.8,
  highAmount: 25_000,
  velocityPerHour: 10,
  velocityPer24h: 40,
  distinctCounterparties24h: 10,
  newAccountDays: 30,
  amountBaselineMultiplier: 5,
} as const;

const LEVEL_BANDS: Array<{ level: AmlRiskLevel; min: number }> = [
  { level: 'critical', min: 70 },
  { level: 'high', min: 40 },
  { level: 'medium', min: 20 },
  { level: 'low', min: 0 },
];

const ALERT_SEVERITY_BY_LEVEL: Record<AmlRiskLevel, AmlAlertSeverity> = {
  low: 'medium',
  medium: 'medium',
  high: 'high',
  critical: 'critical',
};

function toEpochMs(timestamp: number | string): number {
  if (typeof timestamp === 'number') return timestamp;
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function upper(value?: string): string {
  return (value ?? '').trim().toUpperCase();
}

/**
 * Returns true when the timestamp falls outside the institution's
 * business-hours window (local `0 <= hour < 6`).
 */
export function isUnusualHour(timestamp: number | string): boolean {
  const hour = new Date(toEpochMs(timestamp)).getUTCHours();
  return hour >= 0 && hour < 6;
}

export function isRoundAmount(amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return amount >= 1_000 && amount % 1_000 === 0;
}

// ─── Rule catalogue ───────────────────────────────────────────────────────────

const highRiskCountryRule: AmlRule = {
  id: 'high_risk_jurisdiction',
  name: 'High-risk jurisdiction exposure',
  description: 'Origin or destination country is on the institution high-risk list',
  weight: 20,
  severity: 'high',
  evaluate: ({ transaction, account }) => {
    const highRisk = (account?.highRiskCountries ?? []).map(upper);
    if (highRisk.length === 0) return null;
    const touched = [transaction.originCountry, transaction.destinationCountry]
      .filter((country): country is string => Boolean(country))
      .map(upper)
      .filter((country) => highRisk.includes(country));
    if (touched.length === 0) return null;
    return {
      ruleId: 'high_risk_jurisdiction',
      name: highRiskCountryRule.name,
      description: highRiskCountryRule.description,
      weight: highRiskCountryRule.weight,
      severity: highRiskCountryRule.severity,
      details: { countries: touched },
    };
  },
};

export const AML_RULES: AmlRule[] = [
  {
    id: 'sanctions_exposure',
    name: 'Sanctions exposure',
    description: 'Counterparty is on a sanctions watchlist',
    weight: 70,
    severity: 'critical',
    evaluate: ({ transaction }) => {
      if (!transaction.counterpartySanctioned) return null;
      return {
        ruleId: 'sanctions_exposure',
        name: 'Sanctions exposure',
        description: 'Counterparty is on a sanctions watchlist',
        weight: 70,
        severity: 'critical',
        details: { counterpartyId: transaction.counterpartyId },
      };
    },
  },
  {
    id: 'pep_exposure',
    name: 'Politically exposed person',
    description: 'Counterparty is a politically exposed person',
    weight: 30,
    severity: 'high',
    evaluate: ({ transaction }) => {
      if (!transaction.counterpartyIsPep) return null;
      return {
        ruleId: 'pep_exposure',
        name: 'Politically exposed person',
        description: 'Counterparty is a politically exposed person',
        weight: 30,
        severity: 'high',
        details: { counterpartyId: transaction.counterpartyId },
      };
    },
  },
  {
    id: 'structuring',
    name: 'Potential structuring',
    description: 'Amounts sit just below the reporting threshold or repeated near-threshold activity was observed',
    weight: 35,
    severity: 'high',
    evaluate: ({ transaction }) => {
      const amount = transaction.amount;
      const band = AML_THRESHOLDS.ctrAmount * AML_THRESHOLDS.structuringBand;
      const withinBand = amount >= band && amount < AML_THRESHOLDS.ctrAmount;
      const repeated = (transaction.structuringSignals ?? 0) >= 2;
      if (!withinBand && !repeated) return null;
      return {
        ruleId: 'structuring',
        name: 'Potential structuring',
        description: 'Near-threshold pattern consistent with structuring',
        weight: 35,
        severity: 'high',
        details: {
          amount,
          ctrThreshold: AML_THRESHOLDS.ctrAmount,
          withinBand,
          structuringSignals: transaction.structuringSignals ?? 0,
        },
      };
    },
  },
  {
    id: 'ctr_threshold_breach',
    name: 'CTR reporting threshold',
    description: 'Transaction meets or exceeds the CTR reporting threshold',
    weight: 20,
    severity: 'medium',
    evaluate: ({ transaction }) => {
      if (transaction.amount < AML_THRESHOLDS.ctrAmount) return null;
      return {
        ruleId: 'ctr_threshold_breach',
        name: 'CTR reporting threshold',
        description: 'Transaction meets or exceeds the CTR reporting threshold',
        weight: 20,
        severity: 'medium',
        details: { amount: transaction.amount, threshold: AML_THRESHOLDS.ctrAmount },
      };
    },
  },
  {
    id: 'unusually_large_amount',
    name: 'Unusually large amount',
    description: 'Amount exceeds the institution high-value monitoring threshold',
    weight: 15,
    severity: 'high',
    evaluate: ({ transaction }) => {
      if (transaction.amount < AML_THRESHOLDS.highAmount) return null;
      return {
        ruleId: 'unusually_large_amount',
        name: 'Unusually large amount',
        description: 'Amount exceeds the high-value monitoring threshold',
        weight: 15,
        severity: 'high',
        details: { amount: transaction.amount, threshold: AML_THRESHOLDS.highAmount },
      };
    },
  },
  {
    id: 'velocity_per_hour',
    name: 'Transaction velocity (hourly)',
    description: 'Too many transactions from the account within the last hour',
    weight: 25,
    severity: 'high',
    evaluate: ({ account }) => {
      const count = account?.transactionsLastHour ?? 0;
      if (count < AML_THRESHOLDS.velocityPerHour) return null;
      return {
        ruleId: 'velocity_per_hour',
        name: 'Transaction velocity (hourly)',
        description: 'Hourly transaction velocity limit exceeded',
        weight: 25,
        severity: 'high',
        details: { count, threshold: AML_THRESHOLDS.velocityPerHour },
      };
    },
  },
  {
    id: 'velocity_per_day',
    name: 'Transaction velocity (daily)',
    description: 'Too many transactions from the account within the last 24 hours',
    weight: 15,
    severity: 'medium',
    evaluate: ({ account }) => {
      const count = account?.transactionsLast24h ?? 0;
      if (count < AML_THRESHOLDS.velocityPer24h) return null;
      return {
        ruleId: 'velocity_per_day',
        name: 'Transaction velocity (daily)',
        description: 'Daily transaction velocity limit exceeded',
        weight: 15,
        severity: 'medium',
        details: { count, threshold: AML_THRESHOLDS.velocityPer24h },
      };
    },
  },
  {
    id: 'fan_out',
    name: 'Rapid fan-out to many counterparties',
    description: 'Account interacted with an abnormal number of distinct counterparties in 24h',
    weight: 20,
    severity: 'high',
    evaluate: ({ account }) => {
      const count = account?.distinctCounterpartiesLast24h ?? 0;
      if (count < AML_THRESHOLDS.distinctCounterparties24h) return null;
      return {
        ruleId: 'fan_out',
        name: 'Rapid fan-out to many counterparties',
        description: 'Abnormal number of distinct counterparties within 24h',
        weight: 20,
        severity: 'high',
        details: { count, threshold: AML_THRESHOLDS.distinctCounterparties24h },
      };
    },
  },
  {
    id: 'amount_spike',
    name: 'Amount spike versus baseline',
    description: 'Transaction amount is far above the account historical baseline',
    weight: 20,
    severity: 'high',
    evaluate: ({ transaction, account }) => {
      const baseline = account?.baselineAmount ?? 0;
      if (baseline <= 0) return null;
      const ratio = transaction.amount / baseline;
      if (ratio < AML_THRESHOLDS.amountBaselineMultiplier) return null;
      return {
        ruleId: 'amount_spike',
        name: 'Amount spike versus baseline',
        description: 'Transaction is far above the account baseline',
        weight: 20,
        severity: 'high',
        details: { amount: transaction.amount, baseline, ratio: Number(ratio.toFixed(2)) },
      };
    },
  },
  {
    id: 'unverified_account',
    name: 'Unverified account',
    description: 'Account has not completed KYC verification',
    weight: 25,
    severity: 'high',
    evaluate: ({ account }) => {
      if (!account || account.kycVerified !== false) return null;
      return {
        ruleId: 'unverified_account',
        name: 'Unverified account',
        description: 'Account has not completed KYC verification',
        weight: 25,
        severity: 'high',
        details: { accountId: account.accountId },
      };
    },
  },
  {
    id: 'new_account_high_value',
    name: 'New account with high-value movement',
    description: 'Recently opened account is moving large amounts',
    weight: 15,
    severity: 'medium',
    evaluate: ({ transaction, account }) => {
      const age = account?.accountAgeDays;
      if (age === undefined || age >= AML_THRESHOLDS.newAccountDays) return null;
      if (transaction.amount < AML_THRESHOLDS.ctrAmount) return null;
      return {
        ruleId: 'new_account_high_value',
        name: 'New account with high-value movement',
        description: 'New account is moving high-value amounts',
        weight: 15,
        severity: 'medium',
        details: { accountAgeDays: age, amount: transaction.amount },
      };
    },
  },
  {
    id: 'unusual_hour',
    name: 'Unusual transaction hour',
    description: 'Transaction executed outside the account normal activity window',
    weight: 10,
    severity: 'medium',
    evaluate: ({ transaction }) => {
      if (!isUnusualHour(transaction.timestamp)) return null;
      return {
        ruleId: 'unusual_hour',
        name: 'Unusual transaction hour',
        description: 'Transaction executed outside business hours',
        weight: 10,
        severity: 'medium',
        details: { timestamp: new Date(toEpochMs(transaction.timestamp)).toISOString() },
      };
    },
  },
  {
    id: 'round_amount',
    name: 'Large round amount',
    description: 'Large round-number transfer, a common laundering signal',
    weight: 5,
    severity: 'medium',
    evaluate: ({ transaction }) => {
      if (!isRoundAmount(transaction.amount)) return null;
      return {
        ruleId: 'round_amount',
        name: 'Large round amount',
        description: 'Large round-number transfer',
        weight: 5,
        severity: 'medium',
        details: { amount: transaction.amount },
      };
    },
  },
  {
    id: 'unknown_counterparty',
    name: 'First-time counterparty',
    description: 'Counterparty has never transacted with this account before',
    weight: 10,
    severity: 'medium',
    evaluate: ({ transaction, account }) => {
      if (!account?.knownCounterparties) return null;
      if (!transaction.counterpartyId) return null;
      if (account.knownCounterparties.includes(transaction.counterpartyId)) return null;
      return {
        ruleId: 'unknown_counterparty',
        name: 'First-time counterparty',
        description: 'First-time counterparty for this account',
        weight: 10,
        severity: 'medium',
        details: { counterpartyId: transaction.counterpartyId },
      };
    },
  },
  highRiskCountryRule,
];

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function classifyRiskLevel(score: number): AmlRiskLevel {
  for (const band of LEVEL_BANDS) {
    if (score >= band.min) return band.level;
  }
  return 'low';
}

function recommendedActionFor(level: AmlRiskLevel, matches: AmlRuleMatch[]): AmlAssessment['recommendedAction'] {
  const sanctioned = matches.some((m) => m.ruleId === 'sanctions_exposure');
  if (sanctioned || level === 'critical') return 'block_and_report';
  if (level === 'high') return 'review';
  if (level === 'medium') return 'monitor';
  return 'allow';
}

/**
 * Score a single transaction against the AML rule catalogue.
 */
export function scoreAmlRisk(
  transaction: AmlTransaction,
  account?: AmlAccountContext,
): AmlAssessment {
  const matches: AmlRuleMatch[] = [];
  for (const rule of AML_RULES) {
    const match = rule.evaluate({ transaction, account });
    if (match) matches.push(match);
  }

  const rawScore = matches.reduce((sum, match) => sum + match.weight, 0);
  const score = Math.min(100, rawScore);
  const level = classifyRiskLevel(score);
  const sanctioned = matches.some((m) => m.ruleId === 'sanctions_exposure');

  return {
    transactionId: transaction.transactionId,
    accountId: transaction.accountId,
    score,
    level,
    matches,
    recommendedAction: recommendedActionFor(level, matches),
    requiresSarFiling: sanctioned || level === 'critical',
    assessedAt: new Date().toISOString(),
  };
}

// ─── Alert store ──────────────────────────────────────────────────────────────

const alerts = new Map<string, AmlAlert>();

export function createAmlAlert(assessment: AmlAssessment): AmlAlert {
  const severity = ALERT_SEVERITY_BY_LEVEL[assessment.level];
  const now = new Date().toISOString();
  const alert: AmlAlert = {
    id: `aml_${randomUUID()}`,
    transactionId: assessment.transactionId,
    accountId: assessment.accountId,
    severity,
    status: 'open',
    score: assessment.score,
    level: assessment.level,
    reasons: assessment.matches.map((m) => m.name),
    matches: assessment.matches,
    createdAt: now,
    updatedAt: now,
  };
  alerts.set(alert.id, alert);
  return alert;
}

export function getAmlAlerts(filter?: {
  status?: AmlAlertStatus;
  severity?: AmlAlertSeverity;
  accountId?: string;
}): AmlAlert[] {
  let list = Array.from(alerts.values());
  if (filter?.status) list = list.filter((a) => a.status === filter.status);
  if (filter?.severity) list = list.filter((a) => a.severity === filter.severity);
  if (filter?.accountId) list = list.filter((a) => a.accountId === filter.accountId);
  return list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function getAmlAlert(id: string): AmlAlert | null {
  return alerts.get(id) ?? null;
}

export function resolveAmlAlert(
  id: string,
  status: Exclude<AmlAlertStatus, 'open'>,
  options: { reviewedBy?: string; resolution?: string } = {},
): AmlAlert {
  const alert = alerts.get(id);
  if (!alert) throw new Error(`AML alert not found: ${id}`);
  if (alert.status === 'resolved' || alert.status === 'dismissed') {
    throw new Error(`AML alert ${id} is already ${alert.status}`);
  }
  alert.status = status;
  alert.reviewedBy = options.reviewedBy;
  alert.resolution = options.resolution;
  alert.updatedAt = new Date().toISOString();
  alerts.set(id, alert);
  return alert;
}

/** Test/ops helper to reset the in-memory alert store. */
export function clearAmlAlerts(): void {
  alerts.clear();
}

// ─── Batch monitoring ─────────────────────────────────────────────────────────

const LEVEL_ORDER: AmlRiskLevel[] = ['low', 'medium', 'high', 'critical'];

export function monitorAmlTransactions(
  transactions: AmlTransaction[],
  accountContexts: Record<string, AmlAccountContext> = {},
): { assessments: AmlAssessment[]; alerts: AmlAlert[]; summary: AmlMonitoringSummary } {
  const assessments: AmlAssessment[] = [];
  const created: AmlAlert[] = [];
  const byLevel: Record<AmlRiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };

  let totalScore = 0;
  let highestScore = 0;

  for (const transaction of transactions) {
    const context = accountContexts[transaction.accountId];
    const assessment = scoreAmlRisk(transaction, context);
    assessments.push(assessment);
    byLevel[assessment.level] += 1;
    totalScore += assessment.score;
    highestScore = Math.max(highestScore, assessment.score);

    if (LEVEL_ORDER.indexOf(assessment.level) >= LEVEL_ORDER.indexOf('high')) {
      created.push(createAmlAlert(assessment));
    }
  }

  return {
    assessments,
    alerts: created,
    summary: {
      assessed: assessments.length,
      alertsCreated: created.length,
      byLevel,
      highestScore,
      averageScore: assessments.length > 0 ? Number((totalScore / assessments.length).toFixed(2)) : 0,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function getAmlRuleCatalogue(): Array<Omit<AmlRule, 'evaluate'>> {
  return AML_RULES.map(({ id, name, description, weight, severity }) => ({
    id,
    name,
    description,
    weight,
    severity,
  }));
}
