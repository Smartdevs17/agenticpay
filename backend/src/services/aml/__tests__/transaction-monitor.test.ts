import { beforeEach, describe, expect, it } from 'vitest';
import {
  AML_THRESHOLDS,
  AmlTransaction,
  clearAmlAlerts,
  classifyRiskLevel,
  createAmlAlert,
  getAmlAlert,
  getAmlAlerts,
  getAmlRuleCatalogue,
  isRoundAmount,
  isUnusualHour,
  monitorAmlTransactions,
  resolveAmlAlert,
  scoreAmlRisk,
} from '../transaction-monitor.js';

function baseTransaction(overrides: Partial<AmlTransaction> = {}): AmlTransaction {
  return {
    transactionId: 'tx_1',
    accountId: 'acct_1',
    counterpartyId: 'cp_1',
    amount: 250,
    currency: 'USD',
    timestamp: Date.parse('2026-01-02T14:30:00.000Z'),
    ...overrides,
  };
}

describe('AML risk scoring (#922)', () => {
  beforeEach(() => clearAmlAlerts());

  it('keeps a small, verified, known-counterparty payment at low risk', () => {
    const assessment = scoreAmlRisk(
      baseTransaction(),
      { accountId: 'acct_1', kycVerified: true, knownCounterparties: ['cp_1'] },
    );

    expect(assessment.level).toBe('low');
    expect(assessment.score).toBe(0);
    expect(assessment.matches).toHaveLength(0);
    expect(assessment.recommendedAction).toBe('allow');
    expect(assessment.requiresSarFiling).toBe(false);
  });

  it('flags near-threshold amounts as potential structuring', () => {
    const assessment = scoreAmlRisk(
      baseTransaction({ amount: 9_500 }),
      { accountId: 'acct_1', kycVerified: true, knownCounterparties: ['cp_1'] },
    );

    expect(assessment.matches.map((m) => m.ruleId)).toContain('structuring');
    expect(assessment.score).toBeGreaterThanOrEqual(35);
    expect(['medium', 'high', 'critical']).toContain(assessment.level);
  });

  it('escalates sanctioned counterparties to critical and requires a SAR', () => {
    const assessment = scoreAmlRisk(
      baseTransaction({ counterpartySanctioned: true }),
      { accountId: 'acct_1', kycVerified: true, knownCounterparties: ['cp_1'] },
    );

    expect(assessment.level).toBe('critical');
    expect(assessment.requiresSarFiling).toBe(true);
    expect(assessment.recommendedAction).toBe('block_and_report');
    expect(assessment.matches.some((m) => m.ruleId === 'sanctions_exposure')).toBe(true);
  });

  it('aggregates multiple weak signals into a higher score', () => {
    const assessment = scoreAmlRisk(
      baseTransaction({
        amount: 25_000,
        structuringSignals: 3,
        originCountry: 'XX',
        timestamp: Date.parse('2026-01-02T02:00:00.000Z'),
        counterpartyIsPep: true,
      }),
      {
        accountId: 'acct_1',
        kycVerified: false,
        accountAgeDays: 5,
        baselineAmount: 1_000,
        transactionsLastHour: 12,
        transactionsLast24h: 45,
        distinctCounterpartiesLast24h: 15,
        highRiskCountries: ['XX'],
      },
    );

    expect(assessment.score).toBe(100);
    expect(assessment.level).toBe('critical');
    expect(new Set(assessment.matches.map((m) => m.ruleId)).size).toBe(assessment.matches.length);
  });

  it('never exceeds a score of 100', () => {
    const assessment = scoreAmlRisk(
      baseTransaction({
        amount: 1_000_000,
        counterpartySanctioned: true,
        counterpartyIsPep: true,
        structuringSignals: 5,
      }),
      { accountId: 'acct_1', kycVerified: false, transactionsLastHour: 100 },
    );
    expect(assessment.score).toBeLessThanOrEqual(100);
  });

  it('classifies scores into the documented bands', () => {
    expect(classifyRiskLevel(0)).toBe('low');
    expect(classifyRiskLevel(19)).toBe('low');
    expect(classifyRiskLevel(20)).toBe('medium');
    expect(classifyRiskLevel(39)).toBe('medium');
    expect(classifyRiskLevel(40)).toBe('high');
    expect(classifyRiskLevel(69)).toBe('high');
    expect(classifyRiskLevel(70)).toBe('critical');
  });

  it('exposes the rule catalogue without the evaluator functions', () => {
    const catalogue = getAmlRuleCatalogue();
    expect(catalogue.length).toBeGreaterThan(5);
    expect(catalogue.every((rule) => typeof rule.id === 'string' && rule.weight > 0)).toBe(true);
    expect('evaluate' in catalogue[0]).toBe(false);
  });

  it('exposes stable thresholds', () => {
    expect(AML_THRESHOLDS.ctrAmount).toBe(10_000);
    expect(AML_THRESHOLDS.structuringBand).toBeLessThan(1);
  });
});

describe('AML helper predicates (#922)', () => {
  it('recognises unusual hours in UTC', () => {
    expect(isUnusualHour(Date.parse('2026-01-02T02:00:00.000Z'))).toBe(true);
    expect(isUnusualHour(Date.parse('2026-01-02T14:00:00.000Z'))).toBe(false);
  });

  it('recognises large round amounts only', () => {
    expect(isRoundAmount(5_000)).toBe(true);
    expect(isRoundAmount(5_500)).toBe(false);
    expect(isRoundAmount(500)).toBe(false);
    expect(isRoundAmount(0)).toBe(false);
  });
});

describe('AML batch monitoring and alerting (#922)', () => {
  beforeEach(() => clearAmlAlerts());

  it('creates alerts only for high and critical assessments', () => {
    const quiet = baseTransaction({ transactionId: 'tx_quiet' });
    const sanctioned = baseTransaction({ transactionId: 'tx_bad', counterpartySanctioned: true });

    const result = monitorAmlTransactions(
      [quiet, sanctioned],
      { acct_1: { accountId: 'acct_1', kycVerified: true, knownCounterparties: ['cp_1'] } },
    );

    expect(result.assessments).toHaveLength(2);
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0].transactionId).toBe('tx_bad');
    expect(result.summary.byLevel.critical).toBe(1);
    expect(result.summary.byLevel.low).toBe(1);
    expect(result.summary.highestScore).toBeGreaterThanOrEqual(70);
    expect(result.summary.averageScore).toBeGreaterThan(0);
  });

  it('lists, filters and resolves alerts', () => {
    const assessment = scoreAmlRisk(
      baseTransaction({ transactionId: 'tx_alert', counterpartySanctioned: true }),
      { accountId: 'acct_1' },
    );
    const alert = createAmlAlert(assessment);

    expect(getAmlAlerts()).toHaveLength(1);
    expect(getAmlAlerts({ status: 'open' })).toHaveLength(1);
    expect(getAmlAlerts({ status: 'resolved' })).toHaveLength(0);
    expect(getAmlAlerts({ accountId: 'other' })).toHaveLength(0);
    expect(getAmlAlert(alert.id)?.id).toBe(alert.id);
    expect(getAmlAlert('missing')).toBeNull();

    const resolved = resolveAmlAlert(alert.id, 'resolved', { reviewedBy: 'analyst', resolution: 'cleared' });
    expect(resolved.status).toBe('resolved');
    expect(resolved.reviewedBy).toBe('analyst');
    expect(getAmlAlerts({ status: 'open' })).toHaveLength(0);
  });

  it('rejects resolution of an unknown alert', () => {
    expect(() => resolveAmlAlert('missing', 'resolved')).toThrow(/not found/i);
  });

  it('rejects resolving an already finalised alert', () => {
    const assessment = scoreAmlRisk(baseTransaction({ counterpartySanctioned: true }), { accountId: 'acct_1' });
    const alert = createAmlAlert(assessment);
    resolveAmlAlert(alert.id, 'dismissed');
    expect(() => resolveAmlAlert(alert.id, 'resolved')).toThrow(/already/i);
  });

  it('handles an empty batch', () => {
    const result = monitorAmlTransactions([]);
    expect(result.assessments).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
    expect(result.summary.averageScore).toBe(0);
  });
});
