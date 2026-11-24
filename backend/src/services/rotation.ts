import {
  getRotationService,
  type Credential,
  type RotationPolicy,
} from '../config/credential-rotation.js';
import { auditService } from './auditService.js';
import { getWebhookKeyRegistry } from './webhookKeys.js';

const PROVIDER_SECRET_LABEL_PREFIX = 'provider:';
const WEBHOOK_SECRET_SUFFIX = ':webhook_signing_secret';
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const DEFAULT_OVERLAP_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface ProviderSecretRotationInput {
  provider: string;
  performedBy?: string;
  overlapMs?: number;
  eventType?: 'scheduled' | 'manual';
  rotationPolicyDays?: RotationPolicy;
}

export interface ProviderSecretRotationResult {
  provider: string;
  credentialLabel: string;
  keyId: string;
  previousKeyId?: string;
  overlapExpiresAt: string;
  rotationAuditId: string;
  auditId?: string;
}

function normalizeProvider(provider: string): string {
  if (typeof provider !== 'string' || !PROVIDER_PATTERN.test(provider)) {
    throw new Error(`Invalid provider identifier: ${String(provider)}`);
  }
  return provider.toLowerCase();
}

function positiveEnvNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function providerSecretLabel(provider: string): string {
  return `${PROVIDER_SECRET_LABEL_PREFIX}${normalizeProvider(provider)}${WEBHOOK_SECRET_SUFFIX}`;
}

export function providerFromCredential(credential: Credential): string | undefined {
  const metadataProvider = credential.metadata?.provider;
  if (typeof metadataProvider === 'string' && PROVIDER_PATTERN.test(metadataProvider)) {
    return metadataProvider.toLowerCase();
  }
  if (
    credential.kind === 'webhook_secret' &&
    credential.label.startsWith(PROVIDER_SECRET_LABEL_PREFIX) &&
    credential.label.endsWith(WEBHOOK_SECRET_SUFFIX)
  ) {
    const provider = credential.label.slice(
      PROVIDER_SECRET_LABEL_PREFIX.length,
      -WEBHOOK_SECRET_SUFFIX.length,
    );
    if (PROVIDER_PATTERN.test(provider)) return provider.toLowerCase();
  }
  return undefined;
}

export function registerProviderSecret(input: {
  provider: string;
  rotationPolicyDays?: RotationPolicy;
  performedBy?: string;
}): { credential: Credential; plaintext: string } {
  const provider = normalizeProvider(input.provider);
  const label = providerSecretLabel(provider);
  const rotationService = getRotationService();
  const existing = rotationService.getCredential(label);
  if (existing) throw new Error(`Credential '${label}' is already registered`);

  return rotationService.register({
    kind: 'webhook_secret',
    label,
    rotationPolicyDays: input.rotationPolicyDays ?? 90,
    metadata: {
      provider,
      registeredBy: input.performedBy ?? 'system',
    },
  });
}

export async function rotateProviderSecret(input: ProviderSecretRotationInput): Promise<ProviderSecretRotationResult> {
  const provider = normalizeProvider(input.provider);
  const label = providerSecretLabel(provider);
  const performedBy = input.performedBy ?? 'system';
  const overlapMs = input.overlapMs ?? positiveEnvNumber('PROVIDER_SECRET_OVERLAP_MS', DEFAULT_OVERLAP_MS);
  const rotationService = getRotationService();

  if (!rotationService.getCredential(label)) {
    rotationService.register({
      kind: 'webhook_secret',
      label,
      rotationPolicyDays: input.rotationPolicyDays ?? 90,
      metadata: {
        provider,
        registeredBy: performedBy,
      },
    });
  }

  const keyRegistry = getWebhookKeyRegistry();
  const previousKey = keyRegistry.getActiveKey(provider);
  const rotation = await rotationService.rotate(label, {
    performedBy,
    overlapMs,
    eventType: input.eventType ?? 'manual',
  });
  const keyRotation = previousKey
    ? keyRegistry.rotate({
        provider,
        secret: rotation.plaintext,
        label,
        overlapSeconds: Math.ceil(overlapMs / 1000),
      })
    : { active: keyRegistry.register({ provider, secret: rotation.plaintext, label }) };

  const auditResult = await auditService.logAction({
    userId: performedBy,
    action: 'provider.secret.rotated',
    resource: 'provider_secret',
    resourceId: provider,
    outcome: 'success',
    details: {
      provider,
      credentialLabel: label,
      previousKeyId: previousKey?.keyId,
      activeKeyId: keyRotation.active.keyId,
      overlapExpiresAt: rotation.overlapExpiresAt,
      rotationAuditId: rotation.auditId,
    },
  });

  return {
    provider,
    credentialLabel: label,
    keyId: keyRotation.active.keyId,
    previousKeyId: previousKey?.keyId,
    overlapExpiresAt: rotation.overlapExpiresAt,
    rotationAuditId: rotation.auditId,
    auditId: auditResult?.id,
  };
}

export async function rotateDueProviderSecrets(): Promise<string[]> {
  const rotationService = getRotationService();
  const due = rotationService.getDueForRotation();
  const rotated: string[] = [];

  for (const credential of due) {
    const provider = providerFromCredential(credential);
    try {
      if (provider) {
        const result = await rotateProviderSecret({ provider, performedBy: 'scheduler', eventType: 'scheduled' });
        rotated.push(result.credentialLabel);
      } else {
        await rotationService.rotate(credential.label, { performedBy: 'scheduler', eventType: 'scheduled' });
        rotated.push(credential.label);
      }
    } catch (error) {
      console.error('[ProviderSecretRotation] Failed to rotate credential', credential.label, error);
    }
  }

  return rotated;
}

let rotationTimer: ReturnType<typeof setInterval> | null = null;

export function startProviderSecretRotation(): void {
  if (rotationTimer) return;
  const intervalMs = positiveEnvNumber(
    'PROVIDER_SECRET_ROTATION_CHECK_INTERVAL_MS',
    DEFAULT_CHECK_INTERVAL_MS,
  );
  rotationTimer = setInterval(() => {
    void rotateDueProviderSecrets()
      .then((rotated) => {
        if (rotated.length > 0) console.log(`[ProviderSecretRotation] Rotated: ${rotated.join(', ')}`);
      })
      .catch((error) => console.error('[ProviderSecretRotation] Scheduled rotation failed', error));
  }, intervalMs);
}

export function stopProviderSecretRotation(): void {
  if (!rotationTimer) return;
  clearInterval(rotationTimer);
  rotationTimer = null;
}
