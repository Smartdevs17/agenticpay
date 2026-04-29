import { describe, it, expect, beforeEach } from 'vitest';
import * as StellarSdk from '@stellar/stellar-sdk';
import { buildAuthorizationHash, validateAuthorizationToken } from '../signature.js';
import type { AuthorizationDomain, AuthorizationMessage, AuthorizationToken } from '../types.js';

const keypair = StellarSdk.Keypair.random();
const relayerKeypair = StellarSdk.Keypair.random();

const domain: AuthorizationDomain = {
  name: 'AgenticPay',
  version: '1',
  networkPassphrase: 'testnet',
  contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
};

function makeMessage(overrides: Partial<AuthorizationMessage> = {}): AuthorizationMessage {
  return {
    from: keypair.publicKey(),
    to: relayerKeypair.publicKey(),
    nonce: 1,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    operation: Buffer.from('test-op').toString('base64'),
    maxFee: '0.0000200',
    ...overrides,
  };
}

function signToken(message: AuthorizationMessage): AuthorizationToken {
  const hash = buildAuthorizationHash(domain, message);
  const sig = keypair.sign(hash);
  return { domain, message, signature: Buffer.from(sig).toString('hex') };
}

describe('buildAuthorizationHash', () => {
  it('produces a 32-byte buffer', () => {
    const hash = buildAuthorizationHash(domain, makeMessage());
    expect(hash).toBeInstanceOf(Buffer);
    expect(hash.length).toBe(32);
  });

  it('is deterministic for the same inputs', () => {
    const msg = makeMessage();
    const h1 = buildAuthorizationHash(domain, msg);
    const h2 = buildAuthorizationHash(domain, msg);
    expect(h1.toString('hex')).toBe(h2.toString('hex'));
  });

  it('differs when nonce changes', () => {
    const h1 = buildAuthorizationHash(domain, makeMessage({ nonce: 1 }));
    const h2 = buildAuthorizationHash(domain, makeMessage({ nonce: 2 }));
    expect(h1.toString('hex')).not.toBe(h2.toString('hex'));
  });
});

describe('validateAuthorizationToken', () => {
  it('accepts a valid token', () => {
    const token = signToken(makeMessage());
    const result = validateAuthorizationToken(token);
    expect(result.valid).toBe(true);
  });

  it('rejects an expired token', () => {
    const token = signToken(makeMessage({ validUntil: Math.floor(Date.now() / 1000) - 1 }));
    const result = validateAuthorizationToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('rejects a tampered signature', () => {
    const token = signToken(makeMessage());
    const tampered: AuthorizationToken = { ...token, signature: 'a'.repeat(128) };
    const result = validateAuthorizationToken(tampered);
    expect(result.valid).toBe(false);
  });

  it('rejects an invalid signer public key', () => {
    const msg = makeMessage({ from: 'INVALID_KEY' });
    const token: AuthorizationToken = { domain, message: msg, signature: 'a'.repeat(128) };
    const result = validateAuthorizationToken(token);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/public key/i);
  });

  it('rejects a signature from a different keypair', () => {
    const otherKeypair = StellarSdk.Keypair.random();
    const msg = makeMessage();
    const hash = buildAuthorizationHash(domain, msg);
    const sig = otherKeypair.sign(hash);
    const token: AuthorizationToken = {
      domain,
      message: msg,
      signature: Buffer.from(sig).toString('hex'),
    };
    const result = validateAuthorizationToken(token);
    expect(result.valid).toBe(false);
  });
});
