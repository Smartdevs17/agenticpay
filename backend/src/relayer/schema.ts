import { z } from 'zod';

const authorizationDomainSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  networkPassphrase: z.enum(['testnet', 'public']),
  contractId: z.string().min(1),
});

const authorizationMessageSchema = z.object({
  from: z.string().min(56).max(56),
  to: z.string().min(56).max(56),
  nonce: z.number().int().nonnegative(),
  validUntil: z.number().int().positive(),
  operation: z.string().min(1),
  maxFee: z.string().min(1),
});

export const relayRequestSchema = z.object({
  token: z.object({
    domain: authorizationDomainSchema,
    message: authorizationMessageSchema,
    signature: z.string().regex(/^[0-9a-fA-F]{128}$/, 'Signature must be 64-byte hex string'),
  }),
});
