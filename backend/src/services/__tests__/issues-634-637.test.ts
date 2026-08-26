import { beforeEach, describe, expect, it } from 'vitest';
import {
  registerMilestoneTrigger,
  getMilestoneTriggers,
  removeMilestoneTrigger,
  generateInvoiceFromMilestone,
  buildInvoiceAnalytics,
} from '../invoice.js';
import {
  buildRevenueForecastWithAccuracy,
  forecastService,
  ForecastAccuracyTracker,
} from '../analytics.js';
import {
  ContractAuditService,
  SeverityLevel,
} from '../contractAuditService.js';
import {
  RealTimeNotificationService,
  NotificationHistoryService,
} from '../notificationService.js';

// ── Issue #636: Automated Invoice Generation from Milestone Completion ─────────

describe('Issue #636 — Milestone-Triggered Invoicing', () => {
  beforeEach(() => {
    // Reset singleton state by re-importing fresh
  });

  it('registers a milestone trigger', () => {
    registerMilestoneTrigger({
      projectId: 'p_1',
      merchantId: 'm_1',
      autoSend: true,
      recipientEmail: 'client@test.com',
    });
    const triggers = getMilestoneTriggers('p_1');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].merchantId).toBe('m_1');
    expect(triggers[0].autoSend).toBe(true);
  });

  it('returns empty list for unknown project', () => {
    const triggers = getMilestoneTriggers('p_unknown');
    expect(triggers).toHaveLength(0);
  });

  it('removes a milestone trigger', () => {
    registerMilestoneTrigger({ projectId: 'p_2', merchantId: 'm_1' });
    registerMilestoneTrigger({ projectId: 'p_2', merchantId: 'm_2' });
    const removed = removeMilestoneTrigger('p_2', 'm_1');
    expect(removed).toBe(true);
    const triggers = getMilestoneTriggers('p_2');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].merchantId).toBe('m_2');
  });

  it('returns false when removing non-existent trigger', () => {
    const removed = removeMilestoneTrigger('p_nonexist', 'm_1');
    expect(removed).toBe(false);
  });

  it('generates an invoice from a milestone', async () => {
    registerMilestoneTrigger({
      projectId: 'p_3',
      merchantId: 'm_1',
      countryCode: 'US',
    });

    const result = await generateInvoiceFromMilestone(
      { id: 'ms_1', title: 'Phase 1', deliverable: 'Initial setup', amount: 5000 },
      { projectId: 'p_3', merchantId: 'm_1' },
    );

    expect(result.milestoneId).toBe('ms_1');
    expect(result.projectId).toBe('p_3');
    expect(result.invoice.merchantId).toBe('m_1');
    expect(result.invoice.total).toBeGreaterThan(0);
    expect(result.invoice.lineItems[0].description).toContain('Phase 1');
  });
});

describe('Issue #636 — Invoice Analytics', () => {
  it('returns analytics with zero invoices', () => {
    const analytics = buildInvoiceAnalytics();
    expect(analytics.totalInvoices).toBe(0);
    expect(analytics.totalAmount).toBe(0);
  });

  it('computes status breakdown', () => {
    const analytics = buildInvoiceAnalytics();
    expect(analytics).toHaveProperty('statusBreakdown');
    expect(analytics).toHaveProperty('monthlyTrend');
    expect(analytics).toHaveProperty('agingBreakdown');
    expect(analytics).toHaveProperty('generatedAt');
  });
});

// ── Issue #637: Payment Analytics with Revenue Forecasting ──────────────────

describe('Issue #637 — Revenue Forecasting with Accuracy Tracking', () => {
  beforeEach(() => {
    forecastService.resetForTests();
  });

  it('tracks forecast accuracy', () => {
    forecastService.recordPrediction('day', 1000, 1100);
    forecastService.recordPrediction('day', 2000, 1900);
    const accuracy = forecastService.getAccuracyMetrics();
    expect(accuracy.totalPredictions).toBe(2);
    expect(accuracy.mae).toBeGreaterThan(0);
    expect(accuracy.mape).toBeGreaterThan(0);
  });

  it('returns zero metrics with no predictions', () => {
    const accuracy = forecastService.getAccuracyMetrics();
    expect(accuracy.totalPredictions).toBe(0);
    expect(accuracy.mae).toBe(0);
    expect(accuracy.rmse).toBe(0);
  });

  it('computes forecast bias correctly', () => {
    forecastService.recordPrediction('day', 1000, 900);
    forecastService.recordPrediction('day', 1000, 800);
    forecastService.recordPrediction('day', 1000, 700);
    const accuracy = forecastService.getAccuracyMetrics();
    expect(accuracy.bias).toBeLessThan(0);
  });

  it('tracks accuracy per granularity', () => {
    forecastService.recordPrediction('day', 500, 520);
    forecastService.recordPrediction('hour', 100, 110);
    const accuracy = forecastService.getAccuracyMetrics();
    expect(accuracy.byGranularity).toHaveProperty('day');
    expect(accuracy.byGranularity).toHaveProperty('hour');
  });

  it('builds forecast with accuracy data', () => {
    forecastService.recordPrediction('day', 1000, 1050);
    forecastService.recordPrediction('day', 1100, 1080);
    const result = buildRevenueForecastWithAccuracy();
    expect(result).toHaveProperty('forecast');
    expect(result).toHaveProperty('accuracy');
    expect(result.accuracy.totalPredictions).toBe(2);
  });
});

describe('Issue #637 — Trend Analysis', () => {
  it('detects upward trend', () => {
    const data = [100, 200, 300, 400, 500];
    const trend = forecastService.analyzeTrend(data);
    expect(trend.direction).toBe('up');
    expect(trend.slope).toBeGreaterThan(0);
  });

  it('detects downward trend', () => {
    const data = [500, 400, 300, 200, 100];
    const trend = forecastService.analyzeTrend(data);
    expect(trend.direction).toBe('down');
    expect(trend.slope).toBeLessThan(0);
  });

  it('detects stable trend', () => {
    const data = [100, 101, 99, 100, 102];
    const trend = forecastService.analyzeTrend(data);
    expect(trend.direction).toBe('stable');
  });

  it('handles empty data', () => {
    const trend = forecastService.analyzeTrend([]);
    expect(trend.direction).toBe('stable');
    expect(trend.slope).toBe(0);
  });
});

// ── Issue #634: Automated Contract Auditing with Security Scoring ────────────

describe('Issue #634 — Contract Audit Service', () => {
  let auditService: ContractAuditService;

  beforeEach(() => {
    auditService = new ContractAuditService();
  });

  it('analyzes a contract and returns a report', async () => {
    const source = 'contract Test { uint x; function set(uint _x) public { x = _x; } }';
    const report = await auditService.analyze(source, 'solidity');
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(report.overallScore).toBeLessThanOrEqual(100);
    expect(report.findings).toBeInstanceOf(Array);
    expect(report.metadata.language).toBe('solidity');
    expect(report.metadata.linesOfCode).toBeGreaterThan(0);
  });

  it('detects reentrancy vulnerability', async () => {
    const vulnerable = `
      contract Vulnerable {
        mapping(address => uint) balances;
        function withdraw() public {
          uint amount = balances[msg.sender];
          (bool ok, ) = msg.sender.call{value: amount}("");
          require(ok);
          balances[msg.sender] = 0;
        }
      }`;
    const report = await auditService.analyze(vulnerable, 'solidity');
    const reentrancyFinding = report.findings.find((f) =>
      f.type.toLowerCase().includes('reentrancy'),
    );
    expect(reentrancyFinding).toBeDefined();
    expect(reentrancyFinding!.severity).toBe('high');
  });

  it('detects unchecked external call', async () => {
    const source = `
      contract Test {
        function call(address t) public {
          t.call(abi.encodeWithSignature("foo()"));
        }
      }`;
    const report = await auditService.analyze(source, 'solidity');
    const uncheckedCall = report.findings.find((f) =>
      f.type.toLowerCase().includes('unchecked'),
    );
    expect(uncheckedCall).toBeDefined();
  });

  it('returns passing score for a safe contract', async () => {
    const safe = `
      contract Safe {
        uint public x;
        event Set(uint val);
        function set(uint _x) public { x = _x; emit Set(_x); }
      }`;
    const report = await auditService.analyze(safe, 'solidity');
    expect(report.overallScore).toBeGreaterThanOrEqual(80);
    expect(report.summary.passed).toBe(true);
  });

  it('handles empty or invalid source', async () => {
    const report = await auditService.analyze('', 'solidity');
    expect(report.overallScore).toBe(0);
    expect(report.summary.passed).toBe(false);
  });

  it('generates an audit report with all required fields', async () => {
    const source = 'contract T { uint x; }';
    const report = await auditService.analyze(source, 'solidity');
    expect(report).toHaveProperty('reportId');
    expect(report).toHaveProperty('overallScore');
    expect(report).toHaveProperty('findings');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('metadata');
    expect(report).toHaveProperty('generatedAt');
    expect(report.summary).toHaveProperty('totalFindings');
    expect(report.summary).toHaveProperty('criticalCount');
    expect(report.summary).toHaveProperty('highCount');
    expect(report.summary).toHaveProperty('mediumCount');
    expect(report.summary).toHaveProperty('lowCount');
    expect(report.summary).toHaveProperty('passed');
  });

  it('tracks audit history', async () => {
    const source = 'contract H { uint x; }';
    await auditService.analyze(source, 'solidity');
    await auditService.analyze(source, 'solidity');
    const history = auditService.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0]).toHaveProperty('reportId');
    expect(history[0]).toHaveProperty('overallScore');
  });

  it('filters history by score range', async () => {
    const source = 'contract F { uint x; }';
    await auditService.analyze(source, 'solidity');
    const highScore = auditService.getHistory({ minScore: 0 });
    expect(highScore.length).toBeGreaterThanOrEqual(1);
  });

  it('exports report as JSON', async () => {
    const source = 'contract E { uint x; }';
    const report = await auditService.analyze(source, 'solidity');
    const json = auditService.exportReport(report.reportId, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.reportId).toBe(report.reportId);
  });

  it('exports report as CSV', async () => {
    const source = 'contract C { uint x; }';
    const report = await auditService.analyze(source, 'solidity');
    const csv = auditService.exportReport(report.reportId, 'csv');
    expect(csv).toContain('Type');
    expect(csv).toContain('Severity');
  });
});

describe('Issue #634 — Security Scoring Algorithm', () => {
  it('computes score based on finding severity weights', () => {
    const service = new ContractAuditService();
    const findings = [
      { type: 'Reentrancy', severity: 'high' as SeverityLevel, line: 5, description: '', recommendation: '' },
      { type: 'Unchecked Call', severity: 'medium' as SeverityLevel, line: 10, description: '', recommendation: '' },
    ];
    const score = service.computeScore(findings);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(100);
  });

  it('returns 100 for no findings', () => {
    const service = new ContractAuditService();
    const score = service.computeScore([]);
    expect(score).toBe(100);
  });

  it('weight critical higher than low', () => {
    const service = new ContractAuditService();
    const critical = [
      { type: 'Critical', severity: 'critical' as SeverityLevel, line: 1, description: '', recommendation: '' },
    ];
    const low = [
      { type: 'Low', severity: 'low' as SeverityLevel, line: 1, description: '', recommendation: '' },
    ];
    expect(service.computeScore(critical)).toBeLessThan(service.computeScore(low));
  });
});

// ── Issue #635: Real-Time Notification System ────────────────────────────────

describe('Issue #635 — Real-Time Notification Service', () => {
  let notificationService: RealTimeNotificationService;

  beforeEach(() => {
    notificationService = new RealTimeNotificationService();
  });

  it('sends a real-time notification to a connected user', async () => {
    const result = await notificationService.sendToUser('user_1', {
      title: 'Test',
      body: 'Test body',
      type: 'test',
    });
    expect(result.success).toBe(true);
    expect(result.userId).toBe('user_1');
  });

  it('queues notifications for disconnected users', async () => {
    const result = await notificationService.sendToUser('user_offline', {
      title: 'Offline',
      body: 'You missed this',
      type: 'alert',
    });
    expect(result.queued).toBe(true);
    const queue = notificationService.getQueue('user_offline');
    expect(queue).toHaveLength(1);
  });

  it('delivers queued notifications on reconnect', async () => {
    await notificationService.sendToUser('user_reconnect', {
      title: 'Queued 1',
      body: 'First',
      type: 'alert',
    });
    await notificationService.sendToUser('user_reconnect', {
      title: 'Queued 2',
      body: 'Second',
      type: 'alert',
    });
    const delivered = notificationService.drainQueue('user_reconnect');
    expect(delivered).toHaveLength(2);
    const queue = notificationService.getQueue('user_reconnect');
    expect(queue).toHaveLength(0);
  });

  it('broadcasts to all connected users', async () => {
    const result = await notificationService.broadcast({
      title: 'Broadcast',
      body: 'To everyone',
      type: 'announcement',
    });
    expect(result.success).toBe(true);
  });

  it('tracks channel delivery status', async () => {
    const result = await notificationService.sendToUser('user_track', {
      title: 'Tracked',
      body: 'test',
      type: 'test',
    });
    expect(result.channelResults).toBeDefined();
    for (const [, status] of Object.entries(result.channelResults)) {
      expect(status).toHaveProperty('success');
    }
  });
});

describe('Issue #635 — Notification History Service', () => {
  let historyService: NotificationHistoryService;

  beforeEach(() => {
    historyService = new NotificationHistoryService();
  });

  it('records notification history', () => {
    historyService.record({
      userId: 'u_1',
      title: 'Test',
      body: 'Body',
      type: 'alert',
      channel: 'in-app',
      status: 'sent',
    });
    const history = historyService.getHistory('u_1');
    expect(history).toHaveLength(1);
  });

  it('returns empty history for unknown user', () => {
    const history = historyService.getHistory('u_unknown');
    expect(history).toHaveLength(0);
  });

  it('filters history by type', () => {
    historyService.record({ userId: 'u_2', title: 'A', body: '', type: 'alert', channel: 'email', status: 'sent' });
    historyService.record({ userId: 'u_2', title: 'B', body: '', type: 'promotion', channel: 'email', status: 'sent' });
    const alerts = historyService.getHistory('u_2', { type: 'alert' });
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('A');
  });

  it('filters history by status', () => {
    historyService.record({ userId: 'u_3', title: 'Failed', body: '', type: 'alert', channel: 'sms', status: 'failed' });
    historyService.record({ userId: 'u_3', title: 'Sent', body: '', type: 'alert', channel: 'email', status: 'sent' });
    const failed = historyService.getHistory('u_3', { status: 'failed' });
    expect(failed).toHaveLength(1);
  });

  it('filters history by date range', () => {
    historyService.record({ userId: 'u_4', title: 'Old', body: '', type: 'alert', channel: 'email', status: 'sent' });
    const recent = historyService.getHistory('u_4', {
      startDate: new Date(Date.now() - 3600000).toISOString(),
    });
    expect(recent).toHaveLength(1);
  });

  it('paginates history results', () => {
    for (let i = 0; i < 15; i++) {
      historyService.record({ userId: 'u_5', title: `N${i}`, body: '', type: 'alert', channel: 'email', status: 'sent' });
    }
    const page1 = historyService.getHistory('u_5', { limit: 10, offset: 0 });
    expect(page1).toHaveLength(10);
    const page2 = historyService.getHistory('u_5', { limit: 10, offset: 10 });
    expect(page2).toHaveLength(5);
  });
});
