/**
 * Real-time critical-event audit alerting — Issue #396
 */
import { describe, expect, it, vi } from 'vitest';

import {
  AuditAlerter,
  CRITICAL_EVENT_RULES,
  SEVERITY_ORDER,
  webhookAlertSink,
  type AuditAlert,
  type AuditAlertSink,
} from '../alerting.js';
import { normalizeAuditEvent, type AuditEvent } from '../event-schema.js';

function event(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return { ...normalizeAuditEvent({ action: 'auth.post', resource: 'auth' }), ...overrides };
}

function collectingSink(): AuditAlertSink & { alerts: AuditAlert[] } {
  const alerts: AuditAlert[] = [];
  return {
    name: 'test',
    alerts,
    async send(alert) {
      alerts.push(alert);
    },
  };
}

describe('CRITICAL_EVENT_RULES', () => {
  it('flags role and permission changes as critical', () => {
    const rule = CRITICAL_EVENT_RULES.find((candidate) => candidate.id === 'privilege.escalation')!;
    expect(rule.severity).toBe('critical');
    expect(rule.match(event({ action: 'roles.post', resource: 'roles' }))).toBe(true);
  });

  it('flags failed authentication as a medium-severity event', () => {
    const rule = CRITICAL_EVENT_RULES.find((candidate) => candidate.id === 'auth.failure')!;
    expect(rule.match(event({ action: 'auth.post', resource: 'auth', outcome: 'failure' }))).toBe(true);
    expect(rule.match(event({ action: 'auth.post', resource: 'auth', outcome: 'success' }))).toBe(false);
  });

  it('flags large payments as high severity but ignores small ones', () => {
    const rule = CRITICAL_EVENT_RULES.find((candidate) => candidate.id === 'payment.large_value')!;

    expect(
      rule.match(event({ action: 'payments.post', resource: 'payments', details: { amount: 250_000 } }))
    ).toBe(true);
    expect(
      rule.match(event({ action: 'payments.post', resource: 'payments', details: { amount: 12 } }))
    ).toBe(false);
  });

  it('flags sanctions hits as critical', () => {
    const rule = CRITICAL_EVENT_RULES.find((candidate) => candidate.id === 'compliance.sanctions_hit')!;
    expect(rule.match(event({ action: 'sanctions.screen', resource: 'sanctions' }))).toBe(true);
  });

  it('orders severities so thresholds are comparable', () => {
    expect(SEVERITY_ORDER.critical).toBeGreaterThan(SEVERITY_ORDER.high);
    expect(SEVERITY_ORDER.high).toBeGreaterThan(SEVERITY_ORDER.medium);
  });
});

describe('AuditAlerter', () => {
  it('dispatches an alert for an above-threshold event', async () => {
    const sink = collectingSink();
    const alerter = new AuditAlerter({ sinks: [sink] });

    const alert = await alerter.dispatch(event({ action: 'roles.delete', resource: 'roles' }));

    expect(alert?.ruleId).toBe('privilege.escalation');
    expect(alert?.severity).toBe('critical');
    expect(sink.alerts).toHaveLength(1);
  });

  it('ignores events below the configured threshold', async () => {
    const sink = collectingSink();
    const alerter = new AuditAlerter({ sinks: [sink], minSeverity: 'critical' });

    const alert = await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure' }));

    expect(alert).toBeUndefined();
    expect(sink.alerts).toHaveLength(0);
  });

  it('ignores events that match no rule', async () => {
    const sink = collectingSink();
    const alerter = new AuditAlerter({ sinks: [sink] });

    const alert = await alerter.dispatch(event({ action: 'projects.get', resource: 'projects' }));

    expect(alert).toBeUndefined();
    expect(sink.alerts).toHaveLength(0);
  });

  it('folds repeats inside the dedupe window into one alert with an occurrence count', async () => {
    const sink = collectingSink();
    const alerter = new AuditAlerter({ sinks: [sink], dedupeWindowMs: 60_000 });

    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u1' }));
    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u1' }));
    const third = await alerter.dispatch(
      event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u1' })
    );

    expect(third?.occurrences).toBe(3);
    expect(sink.alerts).toHaveLength(1);
    expect(alerter.listRecentAlerts()).toHaveLength(1);
  });

  it('raises a fresh alert once the dedupe window has elapsed', async () => {
    const sink = collectingSink();
    let now = 1_000_000;
    const alerter = new AuditAlerter({ sinks: [sink], dedupeWindowMs: 1_000, now: () => now });

    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u1' }));
    now += 5_000;
    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u1' }));

    expect(sink.alerts).toHaveLength(2);
    expect(alerter.listRecentAlerts()).toHaveLength(2);
  });

  it('keeps alerts from different actors separate', async () => {
    const sink = collectingSink();
    const alerter = new AuditAlerter({ sinks: [sink] });

    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u1' }));
    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u2' }));

    expect(sink.alerts).toHaveLength(2);
  });

  it('never rejects when a sink fails', async () => {
    const failing: AuditAlertSink = {
      name: 'failing',
      send: vi.fn().mockRejectedValue(new Error('webhook down')),
    };
    const alerter = new AuditAlerter({ sinks: [failing] });

    await expect(
      alerter.dispatch(event({ action: 'roles.delete', resource: 'roles' }))
    ).resolves.toBeDefined();
  });

  it('classifies and reports alertability without dispatching', () => {
    const alerter = new AuditAlerter({ sinks: [], minSeverity: 'high' });

    expect(alerter.isAlertable(event({ action: 'roles.post', resource: 'roles' }))).toBe(true);
    expect(alerter.isAlertable(event({ action: 'auth.post', resource: 'auth', outcome: 'failure' }))).toBe(false);
  });

  it('counts retained alerts by severity', async () => {
    const alerter = new AuditAlerter({ sinks: [] });

    await alerter.dispatch(event({ action: 'roles.post', resource: 'roles', actor: 'u1' }));
    await alerter.dispatch(event({ action: 'auth.post', resource: 'auth', outcome: 'failure', actor: 'u2' }));

    expect(alerter.alertCounts().critical).toBe(1);
    expect(alerter.alertCounts().medium).toBe(1);
  });

  it('caps retained alert history', async () => {
    const alerter = new AuditAlerter({ sinks: [], maxRecentAlerts: 2 });

    await alerter.dispatch(event({ action: 'roles.post', resource: 'roles', actor: 'a' }));
    await alerter.dispatch(event({ action: 'roles.post', resource: 'roles', actor: 'b' }));
    await alerter.dispatch(event({ action: 'roles.post', resource: 'roles', actor: 'c' }));

    expect(alerter.listRecentAlerts()).toHaveLength(2);
  });
});

describe('webhookAlertSink', () => {
  it('POSTs the alert payload to the configured URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const sink = webhookAlertSink('https://hooks.example.test/audit', fetchMock as unknown as typeof fetch);

    await sink.send({
      id: 'a1',
      ruleId: 'privilege.escalation',
      severity: 'critical',
      description: 'Role change',
      occurrences: 1,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      actor: 'u1',
      action: 'roles.post',
      resource: 'roles',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.test/audit');
    expect(JSON.parse((init as RequestInit).body as string).alert.ruleId).toBe('privilege.escalation');
  });
});
