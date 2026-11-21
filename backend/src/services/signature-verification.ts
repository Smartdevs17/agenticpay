import { randomBytes, timingSafeEqual } from 'node:crypto';
import { verifyTypedData, type Address, isAddress } from 'viem';
import { auditService } from './auditService.js';

export interface SignatureChallengeRequest {
  signer: string;
  chainId: number;
  origin: string;
  action: string;
  payloadHash: string;
  ttlSeconds?: number;
}

export interface SignatureVerifyRequest {
  signer: string;
  signature: string;
  nonce: string;
  chainId: number;
  origin: string;
  action: string;
  payloadHash: string;
  expiresAt: number;
}

interface SignatureState {
  nonce: string;
  expiresAt: number;
  signer: Address;
  action: string;
  payloadHash: string;
  chainId: number;
  origin: string;
  used: boolean;
}

export const SIGNATURE_DOMAIN_NAME = 'AgenticPay';
export const SIGNATURE_DOMAIN_VERSION = '1';

const MAX_TTL_SECONDS = 15 * 60;
const DEFAULT_TTL_SECONDS = 5 * 60;
const NONCE_BYTES = 16;

const challengeStore = new Map<string, SignatureState>();

function normalizeOrigin(origin: string): string {
  try {
    const parsed = new URL(origin);
    return parsed.origin.toLowerCase();
  } catch {
    throw new Error('Invalid origin');
  }
}

function allowedOrigins(): string[] {
  const raw = process.env.AGENTICPAY_ALLOWED_SIGNATURE_ORIGINS || 'https://agenticpay.com,http://localhost:3000';
  return raw.split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

function assertAllowedOrigin(origin: string): void {
  const normalized = normalizeOrigin(origin);
  const allowed = allowedOrigins();
  if (!allowed.includes(normalized)) {
    throw new Error('Origin is not allowed for signature verification');
  }
}

function assertAddress(signer: string): Address {
  if (!isAddress(signer)) {
    throw new Error('Invalid signer address');
  }
  return signer as Address;
}

export function clearSignatureStateForTests(): void {
  challengeStore.clear();
}

export function getSignatureDomain(chainId: number) {
  return {
    name: SIGNATURE_DOMAIN_NAME,
    version: SIGNATURE_DOMAIN_VERSION,
    chainId,
  } as const;
}

export function buildSignatureMessage(input: {
  action: string;
  nonce: string;
  payloadHash: string;
  origin: string;
  expiresAt: number;
}) {
  return {
    action: input.action,
    nonce: input.nonce,
    payloadHash: input.payloadHash,
    origin: input.origin,
    expiresAt: input.expiresAt,
  } as const;
}

const signatureTypes = {
  SignatureIntent: [
    { name: 'action', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'payloadHash', type: 'bytes32' },
    { name: 'origin', type: 'string' },
    { name: 'expiresAt', type: 'uint256' },
  ],
} as const;

function validateHex32(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value`);
  }
}

function secureEqualHex(a: string, b: string): boolean {
  const aBuf = Buffer.from(a.slice(2), 'hex');
  const bBuf = Buffer.from(b.slice(2), 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function createSignatureChallenge(input: SignatureChallengeRequest) {
  const signer = assertAddress(input.signer);
  validateHex32(input.payloadHash, 'payloadHash');
  assertAllowedOrigin(input.origin);

  const ttl = Math.min(Math.max(1, input.ttlSeconds ?? DEFAULT_TTL_SECONDS), MAX_TTL_SECONDS);
  const nonce = `0x${randomBytes(NONCE_BYTES).toString('hex').padEnd(64, '0')}`;
  const expiresAt = Math.floor(Date.now() / 1000) + ttl;
  const origin = normalizeOrigin(input.origin);

  challengeStore.set(nonce, {
    nonce,
    expiresAt,
    signer,
    action: input.action,
    payloadHash: input.payloadHash,
    chainId: input.chainId,
    origin,
    used: false,
  });

  return {
    domain: getSignatureDomain(input.chainId),
    types: signatureTypes,
    primaryType: 'SignatureIntent' as const,
    message: buildSignatureMessage({
      action: input.action,
      nonce,
      payloadHash: input.payloadHash,
      origin,
      expiresAt,
    }),
    signer,
    nonce,
    expiresAt,
  };
}

export async function verifySignatureIntent(input: SignatureVerifyRequest) {
  const signer = assertAddress(input.signer);
  validateHex32(input.payloadHash, 'payloadHash');
  validateHex32(input.nonce, 'nonce');

  const normalizedOrigin = normalizeOrigin(input.origin);
  assertAllowedOrigin(normalizedOrigin);

  const state = challengeStore.get(input.nonce);
  if (!state) {
    await auditService.logAction({
      action: 'signature.verify.failed',
      resource: 'signature',
      details: { reason: 'nonce_not_found', nonce: input.nonce, signer },
    });
    throw new Error('Unknown nonce');
  }

  if (state.used) {
    await auditService.logAction({
      action: 'signature.verify.failed',
      resource: 'signature',
      details: { reason: 'nonce_replay', nonce: input.nonce, signer },
    });
    throw new Error('Nonce already used');
  }

  const now = Math.floor(Date.now() / 1000);
  if (state.expiresAt < now || input.expiresAt < now) {
    await auditService.logAction({
      action: 'signature.verify.failed',
      resource: 'signature',
      details: { reason: 'signature_expired', nonce: input.nonce, signer },
    });
    throw new Error('Signature has expired');
  }

  if (
    state.signer !== signer ||
    state.chainId !== input.chainId ||
    state.action !== input.action ||
    state.origin !== normalizedOrigin ||
    !secureEqualHex(state.payloadHash, input.payloadHash)
  ) {
    await auditService.logAction({
      action: 'signature.verify.failed',
      resource: 'signature',
      details: {
        reason: 'challenge_mismatch',
        nonce: input.nonce,
        signer,
        origin: normalizedOrigin,
      },
    });
    throw new Error('Signature context mismatch');
  }

  const valid = await verifyTypedData({
    address: signer,
    domain: getSignatureDomain(input.chainId),
    types: signatureTypes,
    primaryType: 'SignatureIntent',
    message: buildSignatureMessage({
      action: input.action,
      nonce: input.nonce,
      payloadHash: input.payloadHash,
      origin: normalizedOrigin,
      expiresAt: input.expiresAt,
    }),
    signature: input.signature as `0x${string}`,
  });

  if (!valid) {
    await auditService.logAction({
      action: 'signature.verify.failed',
      resource: 'signature',
      details: { reason: 'invalid_signature', nonce: input.nonce, signer },
    });
    throw new Error('Invalid signature');
  }

  state.used = true;

  await auditService.logAction({
    action: 'signature.verify.success',
    resource: 'signature',
    details: {
      signer,
      nonce: input.nonce,
      action: input.action,
      origin: normalizedOrigin,
      chainId: input.chainId,
    },
  });

  return {
    valid: true,
    signer,
    nonce: input.nonce,
    verifiedAt: new Date().toISOString(),
  };
}
