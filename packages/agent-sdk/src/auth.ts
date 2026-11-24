import { createHmac, randomUUID } from 'node:crypto';

export const AGENT_TOKEN_HEADER = 'x-agent-token';
export const AGENT_TOKEN_TYPE = 'agent+jwt';
export const AGENT_TOKEN_AUDIENCE = 'agenticpay-agent';
export const AGENT_TOKEN_ISSUER = 'agenticpay-agent-sdk';
export const MAX_AGENT_TOKEN_TTL_SECONDS = 300;
export const MIN_AGENT_TOKEN_SECRET_LENGTH = 32;

const SCOPE_PATTERN = /^[a-z0-9][a-z0-9:._-]{1,127}$/i;

export interface AgentTokenInput {
  secret: string;
  agentId: string;
  scopes: string[];
  subject?: string;
  tenantId?: string;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
  issuedAt?: number;
  jti?: string;
}

export interface AgentTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  agentId: string;
  jti: string;
  iat: number;
  exp: number;
  scope: string[];
  tenantId?: string;
}

function encodeSegment(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function assertNonEmpty(value: string | undefined, name: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`${name} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

export function createAgentToken(input: AgentTokenInput): string {
  if (typeof input.secret !== 'string' || input.secret.length < MIN_AGENT_TOKEN_SECRET_LENGTH) {
    throw new Error(`Agent token secret must be at least ${MIN_AGENT_TOKEN_SECRET_LENGTH} characters`);
  }

  const agentId = assertNonEmpty(input.agentId, 'agentId');
  const subject = assertNonEmpty(input.subject ?? input.agentId, 'subject');
  const tenantId = input.tenantId === undefined ? undefined : assertNonEmpty(input.tenantId, 'tenantId');
  const jti = assertNonEmpty(input.jti ?? randomUUID(), 'jti', 256);
  const issuer = assertNonEmpty(input.issuer ?? AGENT_TOKEN_ISSUER, 'issuer');
  const audience = assertNonEmpty(input.audience ?? AGENT_TOKEN_AUDIENCE, 'audience');
  const ttlSeconds = input.ttlSeconds ?? MAX_AGENT_TOKEN_TTL_SECONDS;
  const issuedAt = input.issuedAt ?? Math.floor(Date.now() / 1000);

  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_AGENT_TOKEN_TTL_SECONDS) {
    throw new Error(`ttlSeconds must be between 1 and ${MAX_AGENT_TOKEN_TTL_SECONDS}`);
  }
  if (!Number.isInteger(issuedAt) || issuedAt < 0) {
    throw new Error('issuedAt must be a non-negative integer timestamp in seconds');
  }
  if (!Array.isArray(input.scopes) || input.scopes.length === 0 || input.scopes.length > 50) {
    throw new Error('scopes must contain between 1 and 50 entries');
  }
  for (const scope of input.scopes) {
    if (typeof scope !== 'string' || !SCOPE_PATTERN.test(scope)) {
      throw new Error(`Invalid agent scope: ${String(scope)}`);
    }
  }

  const payload: AgentTokenClaims = {
    iss: issuer,
    aud: audience,
    sub: subject,
    agentId,
    jti,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
    scope: [...input.scopes],
    tenantId,
  };

  const header = encodeSegment({ alg: 'HS256', typ: AGENT_TOKEN_TYPE });
  const body = encodeSegment(payload as unknown as Record<string, unknown>);
  const signingInput = `${header}.${body}`;
  const signature = createHmac('sha256', input.secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function buildAgentAuthHeaders(token: string): Record<string, string> {
  return { [AGENT_TOKEN_HEADER]: token };
}

export function createAgentAuthHeaders(input: AgentTokenInput): Record<string, string> {
  return buildAgentAuthHeaders(createAgentToken(input));
}
