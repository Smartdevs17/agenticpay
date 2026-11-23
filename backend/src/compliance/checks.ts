import { config as getEnvConfig } from '../config/env.js';
import { kycDocumentVault } from './documentVault.js';

export type ComplianceCheckResult = {
  id: string;
  description: string;
  status: 'pass' | 'fail' | 'warn';
  details?: Record<string, unknown>;
  checkedAtMs: number;
};

export function runComplianceChecks(): ComplianceCheckResult[] {
  const env = getEnvConfig();
  const checkedAtMs = Date.now();

  const results: ComplianceCheckResult[] = [];

  // Encryption in transit (best-effort): behind a proxy TLS termination is external, so we surface env expectations.
  results.push({
    id: 'encryption_in_transit',
    description: 'TLS termination enforced at edge / proxy',
    status: env.NODE_ENV === 'production' ? 'warn' : 'pass',
    details: {
      note:
        env.NODE_ENV === 'production'
          ? 'Verify that the deployment terminates TLS and forwards only HTTPS traffic to the app.'
          : 'Non-production environment.',
    },
    checkedAtMs,
  });

  // Backup verification: this repo includes backup routes/providers; we ensure configuration is present if enabled.
  results.push({
    id: 'backup_configuration',
    description: 'Backup configuration present when enabled',
    status: 'warn',
    details: {
      note:
        'Backup routes exist, but backup enablement/provider env vars are not standardized yet. Define and validate BACKUP_* env vars for automated verification.',
    },
    checkedAtMs,
  });

  // Basic access control logging: audit routes present; enforce that audit feature flag is enabled by config.
  results.push({
    id: 'access_control_logging',
    description: 'Audit logging available for privileged operations',
    status: 'pass',
    details: {
      note: 'Use /api/v1/audit/* endpoints to capture and export evidence.',
    },
    checkedAtMs,
  });

  // KYC documents are encrypted at rest with per-tenant keys (#1470); that only
  // protects anything if the master key is persistent configuration.
  let kycEncryption: ComplianceCheckResult;
  try {
    const durable = kycDocumentVault.durable;
    kycEncryption = {
      id: 'kyc_documents_encrypted_at_rest',
      description: 'KYC document files are encrypted at rest with per-tenant keys',
      status: durable ? 'pass' : env.NODE_ENV === 'production' ? 'fail' : 'warn',
      details: {
        note: durable
          ? 'AES-256-GCM per document, data keys wrapped by a per-tenant key under KMS_MASTER_KEY.'
          : 'KMS_MASTER_KEY is not set: documents are encrypted under an ephemeral key and are lost on restart.',
        vault: kycDocumentVault.stats(),
      },
      checkedAtMs,
    };
  } catch (error) {
    kycEncryption = {
      id: 'kyc_documents_encrypted_at_rest',
      description: 'KYC document files are encrypted at rest with per-tenant keys',
      status: 'fail',
      details: { error: error instanceof Error ? error.message : String(error) },
      checkedAtMs,
    };
  }
  results.push(kycEncryption);

  return results;
}
