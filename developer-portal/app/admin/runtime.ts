/**
 * Process-wide wiring for the admin gate: build the WebAuthn service and the
 * session stores once from the environment, and hand the same instances to every
 * route handler and page.
 *
 * Credentials are persisted to disk (they must outlive a restart, or every
 * operator is locked out). Challenges and step-up sessions are intentionally
 * in-memory; losing them only forces the operator to authenticate again, so a
 * single-instance internal portal does not need a shared store for them.
 */
import { join } from 'node:path';
import {
  createFileCredentialStore,
  createInMemoryChallengeStore,
  createInMemoryOperatorSessionStore,
  createInMemoryStepUpSessionStore,
  createSecurityEvents,
  createWebAuthnService,
  readWebAuthnConfig,
  type WebAuthnService,
} from '@/lib/webauthn';
import type { AdminGuardDeps } from './guard';

export interface PortalRuntime extends AdminGuardDeps {
  service: WebAuthnService;
}

let cached: PortalRuntime | null = null;

export function createPortalRuntime(env: NodeJS.ProcessEnv = process.env): PortalRuntime {
  const config = readWebAuthnConfig(env);
  const stateDir = env.WEBAUTHN_STATE_DIR?.trim() || join(process.cwd(), '.data');
  const events = createSecurityEvents();
  const operatorSessions = createInMemoryOperatorSessionStore();
  const stepUpSessions = createInMemoryStepUpSessionStore({ ttlMs: config.stepUpTtlMs });
  const challenges = createInMemoryChallengeStore();
  const credentials = createFileCredentialStore({ filePath: join(stateDir, 'credentials.json') });
  const service = createWebAuthnService({
    config,
    credentials,
    challenges,
    stepUpSessions,
    events,
  });
  return { service, operatorSessions, stepUpSessions, events };
}

export function getPortalRuntime(): PortalRuntime {
  cached ??= createPortalRuntime();
  return cached;
}
