import { apiCall } from '@/lib/api/client';

export interface SignatureChallengeResponse {
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  types: {
    SignatureIntent: Array<{ name: string; type: string }>;
  };
  primaryType: 'SignatureIntent';
  message: {
    action: string;
    nonce: string;
    payloadHash: string;
    origin: string;
    expiresAt: string;
  };
  signer: string;
  nonce: string;
  expiresAt: number;
}

export interface SignatureVerifyResult {
  valid: boolean;
  signer: string;
  nonce: string;
  verifiedAt: string;
}

export const SIGNATURE_SAFETY_NOTICE =
  'Only sign AgenticPay requests when your browser URL matches agenticpay.com. Never sign wallet prompts from lookalike domains.';

export async function requestSignatureChallenge(payload: {
  signer: string;
  chainId: number;
  origin: string;
  action: string;
  payloadHash: string;
}) {
  return apiCall<SignatureChallengeResponse>('/signatures/challenge', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function verifySignature(payload: {
  signer: string;
  signature: string;
  nonce: string;
  chainId: number;
  origin: string;
  action: string;
  payloadHash: string;
  expiresAt: number;
}) {
  return apiCall<SignatureVerifyResult>('/signatures/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
