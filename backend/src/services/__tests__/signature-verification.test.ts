import { describe, it, beforeEach, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import {
  buildSignatureMessage,
  clearSignatureStateForTests,
  createSignatureChallenge,
  getSignatureDomain,
  verifySignatureIntent,
} from '../signature-verification.js';

describe('signature-verification anti-phishing', () => {
  const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f094538f9dc9e86dae88d8a8a1f4f2f4f8b95d47');

  beforeEach(() => {
    process.env.AGENTICPAY_ALLOWED_SIGNATURE_ORIGINS = 'https://agenticpay.com,http://localhost:3000';
    clearSignatureStateForTests();
  });

  it('verifies a domain-bound EIP-712 signature once', async () => {
    const challenge = await createSignatureChallenge({
      signer: account.address,
      chainId: 1,
      origin: 'https://agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '11'.repeat(32),
    });

    const signature = await account.signTypedData({
      domain: getSignatureDomain(1),
      types: challenge.types,
      primaryType: challenge.primaryType,
      message: buildSignatureMessage({
        action: 'invoice.sign',
        nonce: challenge.nonce,
        payloadHash: '0x' + '11'.repeat(32),
        origin: 'https://agenticpay.com',
        expiresAt: challenge.expiresAt,
      }),
    });

    const result = await verifySignatureIntent({
      signer: account.address,
      signature,
      nonce: challenge.nonce,
      chainId: 1,
      origin: 'https://agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '11'.repeat(32),
      expiresAt: challenge.expiresAt,
    });

    expect(result.valid).toBe(true);

    await expect(verifySignatureIntent({
      signer: account.address,
      signature,
      nonce: challenge.nonce,
      chainId: 1,
      origin: 'https://agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '11'.repeat(32),
      expiresAt: challenge.expiresAt,
    })).rejects.toThrow('Nonce already used');
  });

  it('rejects phishing origin mismatch', async () => {
    const challenge = await createSignatureChallenge({
      signer: account.address,
      chainId: 1,
      origin: 'https://agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '22'.repeat(32),
    });

    const signature = await account.signTypedData({
      domain: getSignatureDomain(1),
      types: challenge.types,
      primaryType: challenge.primaryType,
      message: buildSignatureMessage({
        action: 'invoice.sign',
        nonce: challenge.nonce,
        payloadHash: '0x' + '22'.repeat(32),
        origin: 'https://agenticpay.com',
        expiresAt: challenge.expiresAt,
      }),
    });

    await expect(verifySignatureIntent({
      signer: account.address,
      signature,
      nonce: challenge.nonce,
      chainId: 1,
      origin: 'https://evil-agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '22'.repeat(32),
      expiresAt: challenge.expiresAt,
    })).rejects.toThrow('Origin is not allowed for signature verification');
  });

  it('rejects expired signatures', async () => {
    const challenge = await createSignatureChallenge({
      signer: account.address,
      chainId: 1,
      origin: 'https://agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '33'.repeat(32),
      ttlSeconds: 1,
    });

    const signature = await account.signTypedData({
      domain: getSignatureDomain(1),
      types: challenge.types,
      primaryType: challenge.primaryType,
      message: buildSignatureMessage({
        action: 'invoice.sign',
        nonce: challenge.nonce,
        payloadHash: '0x' + '33'.repeat(32),
        origin: 'https://agenticpay.com',
        expiresAt: challenge.expiresAt,
      }),
    });

    const past = Math.max(1, challenge.expiresAt - 10);

    await expect(verifySignatureIntent({
      signer: account.address,
      signature,
      nonce: challenge.nonce,
      chainId: 1,
      origin: 'https://agenticpay.com',
      action: 'invoice.sign',
      payloadHash: '0x' + '33'.repeat(32),
      expiresAt: past,
    })).rejects.toThrow();
  });
});
