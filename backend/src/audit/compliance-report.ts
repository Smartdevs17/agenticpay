/**
 * Compliance reporting over the audit log — Issue #396
 *
 * Acceptance criterion: *"Compliance reporting (SOC2, PCI-DSS relevant
 * fields)."*
 *
 * Auditors do not ask for a log dump, they ask "show me evidence for control
 * CC6.1 in this window". This module maps audit events onto the SOC2 Trust
 * Services Criteria and the PCI-DSS v4 logging requirements, reports whether
 * each control has supporting evidence, and flags records that are missing the
 * fields PCI-DSS 10.3 requires.
 */

import { checkPciDssFieldCompleteness, escapeCsvCell, normalizeTimestamp, type AuditEvent } from './event-schema.js';

export type ComplianceFramework = 'SOC2' | 'PCI-DSS';

export type ControlCoverage = 'satisfied' | 'gap';

export interface ComplianceControl {
  framework: ComplianceFramework;
  /** Official control identifier, e.g. `CC6.1` or `10.2.4`. */
  id: string;
  title: string;
  requirement: string;
  matcher: (event: AuditEvent) => boolean;
}

const text = (event: AuditEvent): string =>
  `${event.action} ${event.resource} ${event.requestPath ?? ''}`.toLowerCase();

const contains = (event: AuditEvent, ...needles: string[]): boolean =>
  needles.some((needle) => text(event).includes(needle));

/**
 * Controls that audit logging is expected to evidence. The mapping is
 * deliberately conservative: a control is only listed when the audit stream can
 * genuinely produce evidence for it.
 */
export const COMPLIANCE_CONTROLS: ComplianceControl[] = [
  // ── SOC2 Trust Services Criteria ──────────────────────────────────────────
  {
    framework: 'SOC2',
    id: 'CC6.1',
    title: 'Logical and physical access controls',
    requirement: 'Authentication activity is recorded for principals accessing the system.',
    matcher: (event) => contains(event, 'auth', 'login', 'oauth', 'token', 'session'),
  },
  {
    framework: 'SOC2',
    id: 'CC6.2',
    title: 'Access provisioning and authorization',
    requirement: 'Granting of access rights (roles, permissions, scopes) is recorded.',
    matcher: (event) => contains(event, 'roles', 'permissions', 'scopes', 'api-keys', 'workspaces', 'teams'),
  },
  {
    framework: 'SOC2',
    id: 'CC7.2',
    title: 'Monitoring for anomalies',
    requirement: 'System components and security events are monitored for anomalies.',
    matcher: (event) => event.suspicious !== true && contains(event, 'admin', 'config', 'flags', 'security'),
  },
  {
    framework: 'SOC2',
    id: 'CC7.3',
    title: 'Evaluation of security events',
    requirement: 'Security incidents and failed operations are evaluated and tracked.',
    matcher: (event) => event.outcome === 'failure',
  },
  {
    framework: 'SOC2',
    id: 'CC8.1',
    title: 'Change management',
    requirement: 'Changes to infrastructure, data and software are authorized and recorded.',
    matcher: (event) => contains(event, 'migration', 'config', 'feature-flags', 'deploy', 'release'),
  },
  {
    framework: 'SOC2',
    id: 'CC4.1',
    title: 'Monitoring activities over audit evidence',
    requirement: 'Audit evidence integrity is periodically verified.',
    matcher: (event) => contains(event, 'audit', 'integrity', 'chain', 'anchor'),
  },

  // ── PCI-DSS v4.0 requirement 10 ───────────────────────────────────────────
  {
    framework: 'PCI-DSS',
    id: '10.2.1',
    title: 'Access to cardholder data',
    requirement: 'All individual user access to cardholder data is logged.',
    matcher: (event) => contains(event, 'card', 'payment-methods', 'payments'),
  },
  {
    framework: 'PCI-DSS',
    id: '10.2.2',
    title: 'Actions by privileged users',
    requirement: 'All actions taken by any individual with administrative access are logged.',
    matcher: (event) => contains(event, 'admin', 'impersonate', 'merchants', 'config'),
  },
  {
    framework: 'PCI-DSS',
    id: '10.2.3',
    title: 'Access to audit logs',
    requirement: 'Access to all audit logs is recorded.',
    matcher: (event) => contains(event, 'audit') && contains(event, 'get', 'export', 'query', 'read'),
  },
  {
    framework: 'PCI-DSS',
    id: '10.2.4',
    title: 'Invalid access attempts',
    requirement: 'Invalid logical access attempts are logged.',
    matcher: (event) => event.outcome === 'failure' && contains(event, 'auth', 'login', 'token', '2fa', 'otp'),
  },
  {
    framework: 'PCI-DSS',
    id: '10.2.5',
    title: 'Authentication credential changes',
    requirement: 'Changes to authentication credentials are logged.',
    matcher: (event) => contains(event, 'password', '2fa', 'mfa', 'api-key', 'secret', 'credential', 'rotate'),
  },
  {
    framework: 'PCI-DSS',
    id: '10.2.7',
    title: 'Creation and deletion of system objects',
    requirement: 'Creation and deletion of system-level objects is logged.',
    matcher: (event) => contains(event, 'delete', 'create', 'purge', 'revoke'),
  },
  {
    framework: 'PCI-DSS',
    id: '10.3.1',
    title: 'Recorded audit fields',
    requirement: 'Records contain user identification, event type, date/time, success/failure and origin.',
    matcher: (event) => checkPciDssFieldCompleteness(event).complete,
  },
  {
    framework: 'PCI-DSS',
    id: '10.3.2',
    title: 'Log integrity protection',
    requirement: 'Audit log files are protected from modification and backed by an integrity mechanism.',
    matcher: (event) => contains(event, 'audit', 'integrity', 'hash', 'anchor', 'tamper'),
  },
];

export interface ControlEvidence {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
  resource: string;
  outcome?: 'success' | 'failure';
}

export interface ControlReport {
  framework: ComplianceFramework;
  id: string;
  title: string;
  requirement: string;
  coverage: ControlCoverage;
  matchedEvents: number;
  /** Up to five representative events, newest first, for the auditor. */
  evidence: ControlEvidence[];
}

export interface ComplianceReport {
  generatedAt: string;
  from?: string;
  to?: string;
  totalEvents: number;
  controls: ControlReport[];
  summary: {
    satisfied: number;
    gaps: number;
    byFramework: Record<ComplianceFramework, { satisfied: number; gaps: number }>;
  };
  fieldCompleteness: {
    pciDssComplete: number;
    missingFields: Record<string, number>;
  };
}

export interface ComplianceReportOptions {
  frameworks?: ComplianceFramework[];
  from?: number | string | Date;
  to?: number | string | Date;
  evidenceLimit?: number;
}

const TO_ISO = (value: number | string | Date | undefined): string | undefined =>
  value === undefined ? undefined : new Date(normalizeTimestamp(value)).toISOString();

/**
 * Build a control-by-control compliance report for the given audit events.
 * Events outside the `from`/`to` window are ignored.
 */
export function generateComplianceReport(
  events: AuditEvent[],
  options: ComplianceReportOptions = {}
): ComplianceReport {
  const frameworks = options.frameworks ?? ['SOC2', 'PCI-DSS'];
  const from = options.from === undefined ? undefined : normalizeTimestamp(options.from);
  const to = options.to === undefined ? undefined : normalizeTimestamp(options.to);
  const evidenceLimit = options.evidenceLimit ?? 5;

  const inWindow = events.filter(
    (event) =>
      (from === undefined || event.timestamp >= from) && (to === undefined || event.timestamp <= to)
  );

  const attempted = inWindow.filter((event) => checkPciDssFieldCompleteness(event).complete).length;

  const missingFields: Record<string, number> = {};
  for (const event of inWindow) {
    for (const field of checkPciDssFieldCompleteness(event).missing) {
      missingFields[field] = (missingFields[field] ?? 0) + 1;
    }
  }

  const controls: ControlReport[] = COMPLIANCE_CONTROLS.filter((control) =>
    frameworks.includes(control.framework)
  ).map((control) => {
    const matches = inWindow
      .filter((event) => control.matcher(event))
      .sort((a, b) => b.timestamp - a.timestamp);

    return {
      framework: control.framework,
      id: control.id,
      title: control.title,
      requirement: control.requirement,
      coverage: matches.length > 0 ? 'satisfied' : 'gap',
      matchedEvents: matches.length,
      evidence: matches.slice(0, evidenceLimit).map((event) => ({
        id: event.id ?? event.correlationId ?? `${event.timestamp}`,
        timestamp: new Date(event.timestamp).toISOString(),
        actor: event.actor,
        action: event.action,
        resource: event.resource,
        outcome: event.outcome,
      })),
    };
  });

  const summary = {
    satisfied: controls.filter((control) => control.coverage === 'satisfied').length,
    gaps: controls.filter((control) => control.coverage === 'gap').length,
    byFramework: {
      SOC2: summarizeFramework(controls, 'SOC2'),
      'PCI-DSS': summarizeFramework(controls, 'PCI-DSS'),
    },
  };

  return {
    generatedAt: new Date().toISOString(),
    from: TO_ISO(options.from),
    to: TO_ISO(options.to),
    totalEvents: inWindow.length,
    controls,
    summary,
    fieldCompleteness: { pciDssComplete: attempted, missingFields },
  };
}

function summarizeFramework(
  controls: ControlReport[],
  framework: ComplianceFramework
): { satisfied: number; gaps: number } {
  const scoped = controls.filter((control) => control.framework === framework);
  return {
    satisfied: scoped.filter((control) => control.coverage === 'satisfied').length,
    gaps: scoped.filter((control) => control.coverage === 'gap').length,
  };
}

/** Render a compliance report as CSV for auditor hand-off. */
export function complianceReportToCsv(report: ComplianceReport): string {
  const header = ['Framework', 'Control', 'Title', 'Coverage', 'Matched Events', 'Requirement'].map(escapeCsvCell).join(',');
  const rows = report.controls.map((control) =>
    [
      control.framework,
      control.id,
      control.title,
      control.coverage,
      control.matchedEvents,
      control.requirement,
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  return [header, ...rows].join('\n');
}
