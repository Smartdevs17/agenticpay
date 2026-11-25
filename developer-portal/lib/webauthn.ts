/**
 * Step-up WebAuthn for the developer portal admin area (#1646).
 *
 * The admin surface used to be reachable by any caller holding a base operator
 * session, so a single leaked session cookie was enough to drive privileged
 * actions. Every admin request now has to *also* present a fresh WebAuthn
 * assertion from a passkey the operator enrolled — a step-up factor that a
 * cookie thief cannot reproduce.
 *
 * This module owns everything that makes that gate trustworthy:
 *
 *   - single-use, time-bounded challenges, consumed on the first verification
 *     attempt so a captured response can never be replayed;
 *   - durable credentials keyed by operator, including the signature counter,
 *     which is checked on every assertion to detect cloned authenticators;
 *   - short-lived step-up sessions bound to the operator *and* to the
 *     credential that proved possession, so revoking one authenticator drops
 *     the capability it granted;
 *   - base operator sessions, resolved from an opaque, HttpOnly cookie;
 *   - the admin-access decision, kept as a pure function so the whole gate can
 *     be unit-tested without a browser or an authenticator;
 *   - structured security events (logs + counters) for every gate outcome.
 *
 * Store backends are injected, so the same orchestrator runs against the
 * in-memory stores used in tests and the file-backed credential store used in
 * production. Challenges and step-up sessions are deliberately ephemeral: if
 * they are lost, the operator simply authenticates again.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  Base64URLString,
  CredentialDeviceType,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  Uint8Array_,
  WebAuthnCredential,
} from '@simplewebauthn/server';

/** Acceptable values for the WebAuthn user-verification requirement. */
export type UserVerification = 'required' | 'preferred' | 'discouraged';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface PortalWebAuthnConfig {
  /** Relying-party ID, i.e. the registrable domain (e.g. `portal.agenticpay.dev`). */
  rpID: string;
  /** Human-readable name shown by the browser during a ceremony. */
  rpName: string;
  /** Full origin the ceremony runs on, including scheme (e.g. `https://portal.agenticpay.dev`). */
  origin: string;
  /** How long a challenge stays valid between `begin*` and `finish*`. */
  challengeTtlMs: number;
  /** How long a step-up session grants access to the admin area. */
  stepUpTtlMs: number;
  /** Whether the authenticator must verify the user (biometric/PIN). */
  userVerification: UserVerification;
}

export const DEFAULT_CHALLENGE_TTL_MS = 60_000;
export const DEFAULT_STEP_UP_TTL_MS = 5 * 60_000;
export const DEFAULT_USER_VERIFICATION: UserVerification = 'required';

export class WebAuthnConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebAuthnConfigError';
  }
}

function readPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function readUserVerification(value: string | undefined): UserVerification {
  if (value === 'required' || value === 'preferred' || value === 'discouraged') return value;
  return DEFAULT_USER_VERIFICATION;
}

/**
 * Read the WebAuthn deployment settings from the environment. `rpID` and
 * `origin` are required: without them the portal cannot pin a ceremony to its
 * own domain, and the gate fails to a safe (closed) state rather than guessing.
 */
export function readWebAuthnConfig(env: Record<string, string | undefined> = process.env): PortalWebAuthnConfig {
  const rpID = env.WEBAUTHN_RP_ID?.trim();
  const origin = env.WEBAUTHN_ORIGIN?.trim();
  if (!rpID) {
    throw new WebAuthnConfigError('WEBAUTHN_RP_ID is required to gate the admin area');
  }
  if (!origin) {
    throw new WebAuthnConfigError('WEBAUTHN_ORIGIN is required to gate the admin area');
  }
  return {
    rpID,
    rpName: env.WEBAUTHN_RP_NAME?.trim() || 'AgenticPay Developer Portal',
    origin,
    challengeTtlMs: readPositiveInt(env.WEBAUTHN_CHALLENGE_TTL_MS, DEFAULT_CHALLENGE_TTL_MS),
    stepUpTtlMs: readPositiveInt(env.WEBAUTHN_STEP_UP_TTL_MS, DEFAULT_STEP_UP_TTL_MS),
    userVerification: readUserVerification(env.WEBAUTHN_USER_VERIFICATION),
  };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type WebAuthnErrorCode =
  | 'NO_CREDENTIALS'
  | 'CHALLENGE_INVALID'
  | 'CREDENTIAL_UNKNOWN'
  | 'VERIFICATION_FAILED'
  | 'COUNTER_REPLAYED';

export class WebAuthnError extends Error {
  readonly code: WebAuthnErrorCode;

  constructor(code: WebAuthnErrorCode, message: string) {
    super(message);
    this.name = 'WebAuthnError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/** A base operator session: proof the caller signed in. Does not grant admin. */
export interface OperatorSession {
  sessionId: string;
  operatorId: string;
  expiresAt: number;
}

/** A step-up session: proof the caller asserted a passkey recently. Grants admin. */
export interface StepUpSession {
  sessionId: string;
  operatorId: string;
  /** The credential whose assertion minted this session. */
  credentialId: Base64URLString;
  issuedAt: number;
  expiresAt: number;
}

/** A registered passkey. `publicKey` is base64url so the record is JSON-safe. */
export interface StoredCredential {
  id: Base64URLString;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  operatorId: string;
  deviceType: CredentialDeviceType;
  backedUp: boolean;
  createdAt: number;
  lastUsedAt: number;
}

export type Ceremony = 'registration' | 'authentication';

export interface ChallengeRecord {
  challenge: string;
  operatorId: string;
  ceremony: Ceremony;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export interface OperatorSessionStore {
  issue(operatorId: string): Promise<OperatorSession>;
  find(sessionId: string): Promise<OperatorSession | null>;
  revoke(sessionId: string): Promise<void>;
}

export interface StepUpSessionStore {
  issue(input: { operatorId: string; credentialId: Base64URLString }): Promise<StepUpSession>;
  find(sessionId: string): Promise<StepUpSession | null>;
  revoke(sessionId: string): Promise<void>;
  /** Revoke every step-up session for an operator, e.g. after a credential change. */
  revokeForOperator(operatorId: string): Promise<void>;
}

export interface ChallengeStore {
  put(record: ChallengeRecord): Promise<void>;
  /** Return the record and delete it in one step, so it can never be reused. */
  take(challenge: string): Promise<ChallengeRecord | null>;
}

export interface CredentialStore {
  list(operatorId: string): Promise<StoredCredential[]>;
  find(credentialId: string): Promise<StoredCredential | null>;
  save(credential: StoredCredential): Promise<void>;
  updateCounter(credentialId: string, counter: number, usedAt: number): Promise<void>;
  remove(credentialId: string): Promise<void>;
}

export interface Clock {
  now(): number;
}

interface BaseStoreOptions {
  clock?: Clock;
}

const systemClock: Clock = { now: () => Date.now() };

/** Drop records whose `expiresAt` is at or before `now`, and stale non-expiring entries. */
function isExpired(expiresAt: number, now: number): boolean {
  return expiresAt <= now;
}

export function createInMemoryOperatorSessionStore(
  options: BaseStoreOptions & { ttlMs?: number } = {},
): OperatorSessionStore {
  const clock = options.clock ?? systemClock;
  const ttlMs = options.ttlMs ?? 12 * 60 * 60 * 1000;
  const sessions = new Map<string, OperatorSession>();
  return {
    async issue(operatorId) {
      const sessionId = randomUUID();
      const session: OperatorSession = { sessionId, operatorId, expiresAt: clock.now() + ttlMs };
      sessions.set(sessionId, session);
      return session;
    },
    async find(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      if (isExpired(session.expiresAt, clock.now())) {
        sessions.delete(sessionId);
        return null;
      }
      return session;
    },
    async revoke(sessionId) {
      sessions.delete(sessionId);
    },
  };
}

export function createInMemoryStepUpSessionStore(
  options: BaseStoreOptions & { ttlMs?: number } = {},
): StepUpSessionStore {
  const clock = options.clock ?? systemClock;
  const ttlMs = options.ttlMs ?? DEFAULT_STEP_UP_TTL_MS;
  const sessions = new Map<string, StepUpSession>();
  return {
    async issue({ operatorId, credentialId }) {
      const sessionId = randomUUID();
      const issuedAt = clock.now();
      const session: StepUpSession = { sessionId, operatorId, credentialId, issuedAt, expiresAt: issuedAt + ttlMs };
      sessions.set(sessionId, session);
      return session;
    },
    async find(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      if (isExpired(session.expiresAt, clock.now())) {
        sessions.delete(sessionId);
        return null;
      }
      return session;
    },
    async revoke(sessionId) {
      sessions.delete(sessionId);
    },
    async revokeForOperator(operatorId) {
      for (const [sessionId, session] of sessions) {
        if (session.operatorId === operatorId) sessions.delete(sessionId);
      }
    },
  };
}

export function createInMemoryChallengeStore(options: BaseStoreOptions = {}): ChallengeStore {
  const clock = options.clock ?? systemClock;
  const challenges = new Map<string, ChallengeRecord>();
  const prune = (now: number) => {
    for (const [challenge, record] of challenges) {
      if (isExpired(record.expiresAt, now)) challenges.delete(challenge);
    }
  };
  return {
    async put(record) {
      const now = clock.now();
      prune(now);
      challenges.set(record.challenge, record);
    },
    async take(challenge) {
      const record = challenges.get(challenge);
      if (!record) return null;
      // Single use: the record is gone whether or not it has expired.
      challenges.delete(challenge);
      if (isExpired(record.expiresAt, clock.now())) return null;
      return record;
    },
  };
}

export function createInMemoryCredentialStore(): CredentialStore {
  const credentials = new Map<string, StoredCredential>();
  return {
    async list(operatorId) {
      return [...credentials.values()].filter((credential) => credential.operatorId === operatorId);
    },
    async find(credentialId) {
      return credentials.get(credentialId) ?? null;
    },
    async save(credential) {
      credentials.set(credential.id, { ...credential });
    },
    async updateCounter(credentialId, counter, usedAt) {
      const credential = credentials.get(credentialId);
      if (credential) credentials.set(credentialId, { ...credential, counter, lastUsedAt: usedAt });
    },
    async remove(credentialId) {
      credentials.delete(credentialId);
    },
  };
}

/**
 * Durable credential store backed by a single JSON file. Credentials must
 * survive a restart — losing them locks every operator out — so this is the
 * default in production while challenges and step-up sessions stay in memory.
 */
export function createFileCredentialStore(options: { filePath: string }): CredentialStore {
  const { filePath } = options;
  let loaded: Promise<Map<string, StoredCredential>> | null = null;
  // Serialise writes so concurrent saves cannot interleave their read-modify-write.
  let writeChain: Promise<unknown> = Promise.resolve();

  const load = (): Promise<Map<string, StoredCredential>> => {
    loaded ??= readFile(filePath, 'utf8')
      .then((raw) => {
        const records = JSON.parse(raw) as StoredCredential[];
        return new Map(records.map((record) => [record.id, record]));
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return new Map<string, StoredCredential>();
        throw error;
      });
    return loaded;
  };

  const persist = async (): Promise<void> => {
    const records = [...(await load()).values()];
    const tempPath = `${filePath}.${randomUUID()}.tmp`;
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tempPath, JSON.stringify(records, null, 2), 'utf8');
    await rename(tempPath, filePath);
  };

  const mutate = <T>(change: (records: Map<string, StoredCredential>) => T): Promise<T> => {
    const result = writeChain.then(async () => {
      const records = await load();
      const value = change(records);
      await persist();
      return value;
    });
    writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    async list(operatorId) {
      return [...(await load()).values()].filter((credential) => credential.operatorId === operatorId);
    },
    async find(credentialId) {
      return (await load()).get(credentialId) ?? null;
    },
    save(credential) {
      return mutate((records) => {
        records.set(credential.id, { ...credential });
      });
    },
    updateCounter(credentialId, counter, usedAt) {
      return mutate((records) => {
        const credential = records.get(credentialId);
        if (credential) records.set(credentialId, { ...credential, counter, lastUsedAt: usedAt });
      });
    },
    remove(credentialId) {
      return mutate((records) => {
        records.delete(credentialId);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Security events (structured logs + counters)
// ---------------------------------------------------------------------------

export type SecurityEventName =
  | 'admin.access_granted'
  | 'admin.access_denied'
  | 'webauthn.registration_started'
  | 'webauthn.registration_completed'
  | 'webauthn.registration_failed'
  | 'webauthn.authentication_started'
  | 'webauthn.step_up_issued'
  | 'webauthn.authentication_failed';

export interface SecurityEvent {
  name: SecurityEventName;
  outcome: 'success' | 'failure';
  operatorId?: string;
  credentialId?: Base64URLString;
  /** Failure reason or a short note, e.g. `challenge-invalid`. */
  reason?: string;
  /** Correlates the event with the inbound request (`x-trace-id` / `x-request-id`). */
  traceId?: string;
  requestId?: string;
}

/** Request correlation carried from a route handler into the ceremony events. */
export type SecurityEventContext = Pick<SecurityEvent, 'traceId' | 'requestId'>;

export interface SecurityEvents {
  emit(event: SecurityEvent): void;
  /** Counters keyed by `event name + outcome`, for a metrics scrape or a test. */
  snapshot(): Readonly<Record<string, number>>;
}

/**
 * Default sink: one JSON line per event (scraped like the backend's pino logs)
 * plus an in-process counter registry exposed via {@link SecurityEvents.snapshot}.
 */
export function createSecurityEvents(
  options: { write?: (line: string) => void } = {},
): SecurityEvents {
  const counters = new Map<string, number>();
  const write = options.write ?? ((line: string) => console.info(line));
  return {
    emit(event) {
      const key = `${event.name}.${event.outcome}`;
      counters.set(key, (counters.get(key) ?? 0) + 1);
      write(
        JSON.stringify({
          level: event.outcome === 'failure' ? 'warn' : 'info',
          service: 'agenticpay-developer-portal',
          event: event.name,
          outcome: event.outcome,
          ...(event.operatorId ? { operatorId: event.operatorId } : {}),
          ...(event.credentialId ? { credentialId: event.credentialId } : {}),
          ...(event.reason ? { reason: event.reason } : {}),
          ...(event.traceId ? { traceId: event.traceId } : {}),
          ...(event.requestId ? { requestId: event.requestId } : {}),
        }),
      );
    },
    snapshot() {
      return Object.fromEntries(counters);
    },
  };
}

// ---------------------------------------------------------------------------
// Admin access decision (pure)
// ---------------------------------------------------------------------------

export type AdminDenialReason =
  | 'no-operator-session'
  | 'no-step-up-session'
  | 'step-up-expired'
  | 'step-up-operator-mismatch';

export type AdminAccessDecision =
  | { allow: true; operatorId: string; stepUp: StepUpSession }
  | { allow: false; reason: AdminDenialReason };

/**
 * The whole gate, as a pure function. A request reaches the admin area only
 * when it carries both a valid base operator session *and* an unexpired step-up
 * session minted for that same operator. Anything short of that is denied.
 */
export function decideAdminAccess(input: {
  operatorSession: OperatorSession | null;
  stepUpSession: StepUpSession | null;
  now: number;
}): AdminAccessDecision {
  const { operatorSession, stepUpSession, now } = input;
  if (!operatorSession || isExpired(operatorSession.expiresAt, now)) {
    return { allow: false, reason: 'no-operator-session' };
  }
  if (!stepUpSession) {
    return { allow: false, reason: 'no-step-up-session' };
  }
  if (stepUpSession.operatorId !== operatorSession.operatorId) {
    return { allow: false, reason: 'step-up-operator-mismatch' };
  }
  if (isExpired(stepUpSession.expiresAt, now)) {
    return { allow: false, reason: 'step-up-expired' };
  }
  return { allow: true, operatorId: operatorSession.operatorId, stepUp: stepUpSession };
}

// ---------------------------------------------------------------------------
// Ceremony orchestration
// ---------------------------------------------------------------------------

export interface WebAuthnServiceDeps {
  config: PortalWebAuthnConfig;
  credentials: CredentialStore;
  challenges: ChallengeStore;
  stepUpSessions: StepUpSessionStore;
  events: SecurityEvents;
  clock?: Clock;
}

export interface WebAuthnService {
  listCredentials(operatorId: string): Promise<StoredCredential[]>;
  beginRegistration(
    operatorId: string,
    context?: SecurityEventContext,
  ): Promise<PublicKeyCredentialCreationOptionsJSON>;
  finishRegistration(
    operatorId: string,
    response: RegistrationResponseJSON,
    context?: SecurityEventContext,
  ): Promise<StoredCredential>;
  beginAuthentication(
    operatorId: string,
    context?: SecurityEventContext,
  ): Promise<PublicKeyCredentialRequestOptionsJSON>;
  finishAuthentication(
    operatorId: string,
    response: AuthenticationResponseJSON,
    context?: SecurityEventContext,
  ): Promise<StepUpSession>;
}

function toBase64Url(bytes: Uint8Array_): string {
  return Buffer.from(bytes).toString('base64url');
}

function fromBase64Url(value: string): Uint8Array_ {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** WebAuthn user handle: a stable, opaque 32-byte digest of the operator id. */
function userHandle(operatorId: string): Uint8Array_ {
  return new Uint8Array(createHash('sha256').update(operatorId).digest());
}

function toWebAuthnCredential(credential: StoredCredential): WebAuthnCredential {
  return {
    id: credential.id,
    publicKey: fromBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports,
  };
}

/**
 * A counter that fails to advance hints at a cloned authenticator. Both sides
 * being zero is fine: some authenticators never increment. Any other value that
 * does not move forward (including a drop back to zero) is treated as a replay.
 */
export function isCounterReplay(previous: number, next: number): boolean {
  return (next > 0 || previous > 0) && next <= previous;
}

/**
 * The signature counter an authenticator reported, read from `authenticatorData`
 * (32-byte RP ID hash, 1 flag byte, then the 4-byte big-endian counter).
 */
function readAuthenticatorCounter(authenticatorData: string): number {
  const bytes = Buffer.from(authenticatorData, 'base64url');
  if (bytes.length < 37) {
    throw new WebAuthnError('VERIFICATION_FAILED', 'authenticator data is shorter than a counter requires');
  }
  return bytes.readUInt32BE(33);
}

/**
 * Run a library verification, translating the client-caused errors it throws
 * (bad origin, wrong type, missing user presence, non-advancing counter…) into
 * our own {@link WebAuthnError} so callers answer 401 instead of a generic 500.
 */
async function verifyOrFail<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WebAuthnError) throw error;
    throw new WebAuthnError(
      'VERIFICATION_FAILED',
      error instanceof Error ? error.message : 'the ceremony response did not verify',
    );
  }
}

/**
 * The challenge a ceremony response is answering lives inside the base64url
 * `clientDataJSON`. Read it so the stored, single-use challenge can be looked
 * up and consumed before any cryptographic verification runs.
 */
function readClientChallenge(clientDataJSON: string): string {
  let parsed: { challenge?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
  } catch {
    throw new WebAuthnError('CHALLENGE_INVALID', 'client data is not valid JSON');
  }
  if (typeof parsed.challenge !== 'string' || parsed.challenge.length === 0) {
    throw new WebAuthnError('CHALLENGE_INVALID', 'response carried no challenge');
  }
  return parsed.challenge;
}

function failureReason(error: unknown): string {
  return error instanceof WebAuthnError ? error.code : 'verification-error';
}

export function createWebAuthnService(deps: WebAuthnServiceDeps): WebAuthnService {
  const { config, credentials, challenges, stepUpSessions, events } = deps;
  const clock = deps.clock ?? systemClock;

  const takeChallenge = async (
    operatorId: string,
    ceremony: Ceremony,
    challenge: string,
  ): Promise<ChallengeRecord> => {
    const record = await challenges.take(challenge);
    // Unknown, expired or already-used challenges are indistinguishable on purpose.
    if (!record || record.ceremony !== ceremony || record.operatorId !== operatorId) {
      throw new WebAuthnError('CHALLENGE_INVALID', 'challenge is unknown, expired or already used');
    }
    return record;
  };

  return {
    listCredentials(operatorId) {
      return credentials.list(operatorId);
    },

    async beginRegistration(operatorId, context) {
      const existing = await credentials.list(operatorId);
      const options = await generateRegistrationOptions({
        rpName: config.rpName,
        rpID: config.rpID,
        userName: operatorId,
        userID: userHandle(operatorId),
        challenge: randomBytes(32).toString('base64url'),
        excludeCredentials: existing.map(({ id, transports }) => ({ id, transports })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: config.userVerification,
        },
      });
      // Persist the challenge the browser will actually echo back, not the raw
      // input: the library re-encodes a string challenge, so `options.challenge`
      // is the only value the client data can be matched against.
      await challenges.put({
        challenge: options.challenge,
        operatorId,
        ceremony: 'registration',
        expiresAt: clock.now() + config.challengeTtlMs,
      });
      events.emit({
        name: 'webauthn.registration_started',
        outcome: 'success',
        operatorId,
        ...(context ?? {}),
      });
      return options;
    },

    async finishRegistration(operatorId, response, context) {
      try {
        const record = await takeChallenge(
          operatorId,
          'registration',
          readClientChallenge(response.response.clientDataJSON),
        );
        const verification = await verifyOrFail(() =>
          verifyRegistrationResponse({
            response,
            expectedChallenge: record.challenge,
            expectedOrigin: config.origin,
            expectedRPID: config.rpID,
            requireUserVerification: config.userVerification === 'required',
          }),
        );
        if (!verification.verified) {
          throw new WebAuthnError('VERIFICATION_FAILED', 'attestation did not verify');
        }
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        const now = clock.now();
        const stored: StoredCredential = {
          id: credential.id,
          publicKey: toBase64Url(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports,
          operatorId,
          deviceType: credentialDeviceType,
          backedUp: credentialBackedUp,
          createdAt: now,
          lastUsedAt: now,
        };
        await credentials.save(stored);
        // A new credential must not inherit a step-up minted by a different one.
        await stepUpSessions.revokeForOperator(operatorId);
        events.emit({
          name: 'webauthn.registration_completed',
          outcome: 'success',
          operatorId,
          credentialId: stored.id,
          ...(context ?? {}),
        });
        return stored;
      } catch (error) {
        events.emit({
          name: 'webauthn.registration_failed',
          outcome: 'failure',
          operatorId,
          reason: failureReason(error),
          ...(context ?? {}),
        });
        throw error;
      }
    },

    async beginAuthentication(operatorId, context) {
      const existing = await credentials.list(operatorId);
      if (existing.length === 0) {
        throw new WebAuthnError('NO_CREDENTIALS', 'no passkey is registered for this operator');
      }
      const options = await generateAuthenticationOptions({
        rpID: config.rpID,
        challenge: randomBytes(32).toString('base64url'),
        allowCredentials: existing.map(({ id, transports }) => ({ id, transports })),
        userVerification: config.userVerification,
      });
      // Store the challenge the client will echo back (see `beginRegistration`).
      await challenges.put({
        challenge: options.challenge,
        operatorId,
        ceremony: 'authentication',
        expiresAt: clock.now() + config.challengeTtlMs,
      });
      events.emit({
        name: 'webauthn.authentication_started',
        outcome: 'success',
        operatorId,
        ...(context ?? {}),
      });
      return options;
    },

    async finishAuthentication(operatorId, response, context) {
      let credential: StoredCredential | null = null;
      try {
        const record = await takeChallenge(
          operatorId,
          'authentication',
          readClientChallenge(response.response.clientDataJSON),
        );
        credential = await credentials.find(response.id);
        // A credential that exists but belongs to someone else is reported as
        // unknown, so the response never confirms another operator's credential id.
        if (!credential || credential.operatorId !== operatorId) {
          throw new WebAuthnError('CREDENTIAL_UNKNOWN', 'no registered passkey matches this assertion');
        }
        // Bind to a `const` so the narrowing above survives into the verification
        // callback below (TypeScript does not keep `let` narrowing in closures).
        const registered = credential;
        // Reject a non-advancing counter before verification so the replay is
        // reported as such instead of as a generic failure.
        if (isCounterReplay(registered.counter, readAuthenticatorCounter(response.response.authenticatorData))) {
          throw new WebAuthnError('COUNTER_REPLAYED', 'authenticator counter did not advance');
        }
        const verification = await verifyOrFail(() =>
          verifyAuthenticationResponse({
            response,
            expectedChallenge: record.challenge,
            expectedOrigin: config.origin,
            expectedRPID: config.rpID,
            credential: toWebAuthnCredential(registered),
            requireUserVerification: config.userVerification === 'required',
          }),
        );
        if (!verification.verified) {
          throw new WebAuthnError('VERIFICATION_FAILED', 'assertion did not verify');
        }
        const { newCounter } = verification.authenticationInfo;
        const now = clock.now();
        await credentials.updateCounter(credential.id, newCounter, now);
        // One live step-up session per operator: minting a new one retires the old.
        await stepUpSessions.revokeForOperator(operatorId);
        const session = await stepUpSessions.issue({ operatorId, credentialId: credential.id });
        events.emit({
          name: 'webauthn.step_up_issued',
          outcome: 'success',
          operatorId,
          credentialId: credential.id,
          ...(context ?? {}),
        });
        return session;
      } catch (error) {
        events.emit({
          name: 'webauthn.authentication_failed',
          outcome: 'failure',
          operatorId,
          ...(credential ? { credentialId: credential.id } : {}),
          reason: failureReason(error),
          ...(context ?? {}),
        });
        throw error;
      }
    },
  };
}
