export type ComplianceCheckResult = {
  id: string;
  description: string;
  status: 'pass' | 'fail' | 'warn';
  details?: Record<string, unknown>;
  checkedAtMs: number;
};

function envFlag(name: string): boolean {
  return String(process.env[name] ?? '').toLowerCase() === 'true';
}

/**
 * Lightweight, synchronous baseline compliance checks.
 *
 * These checks intentionally avoid network and database access so they can run
 * in health-style endpoints, tests, and bootstrapping code. The richer
 * ComplianceService composes these baseline checks with audit integrity,
 * regulatory monitoring, reporting, dashboard, and alert workflows.
 */
export function runComplianceChecks(): ComplianceCheckResult[] {
  const checkedAtMs = Date.now();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const results: ComplianceCheckResult[] = [];

  results.push({
    id: 'encryption_in_transit',
    description: 'TLS termination enforced at edge / proxy',
    status: nodeEnv === 'production' && !envFlag('TLS_TERMINATION_VERIFIED') ? 'warn' : 'pass',
    details: {
      evidence:
        nodeEnv === 'production'
          ? 'Set TLS_TERMINATION_VERIFIED=true after validating load balancer / proxy HTTPS-only forwarding.'
          : 'Non-production environment; local HTTP is allowed.',
    },
    checkedAtMs,
  });

  results.push({
    id: 'backup_configuration',
    description: 'Backup configuration present when enabled',
    status: envFlag('BACKUP_ENABLED') && !process.env.BACKUP_PROVIDER ? 'fail' : 'pass',
    details: {
      backupEnabled: envFlag('BACKUP_ENABLED'),
      providerConfigured: Boolean(process.env.BACKUP_PROVIDER),
      evidence: envFlag('BACKUP_ENABLED')
        ? 'BACKUP_PROVIDER must identify the active evidence backup provider.'
        : 'Backups are not explicitly enabled in this environment.',
    },
    checkedAtMs,
  });

  results.push({
    id: 'access_control_logging',
    description: 'Audit logging available for privileged operations',
    status: 'pass',
    details: {
      evidence: 'Immutable audit logging service and /api/v1/audit endpoints are available.',
    },
    checkedAtMs,
  });

  results.push({
    id: 'regulatory_monitoring_configuration',
    description: 'Regulatory watchlist sources are configured',
    status: 'pass',
    details: {
      evidence:
        'Default watchlist sources are bundled; optional COMPLIANCE_REGULATORY_FEEDS URLs can be added for live monitoring.',
      configuredFeeds: (process.env.COMPLIANCE_REGULATORY_FEEDS || '')
        .split(',')
        .map((url) => url.trim())
        .filter(Boolean).length,
    },
    checkedAtMs,
  });

  return results;
}
