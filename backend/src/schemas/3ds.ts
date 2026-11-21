/**
 * 3DS Authentication Schemas
 * Zod validation schemas for 3D Secure authentication endpoints
 */

import { z } from 'zod';

// ── Initiate 3DS challenge ────────────────────────────────────────────────────

export const initiate3DSSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
  cardNumber: z
    .string()
    .regex(/^\d{13,19}$/, 'cardNumber must be 13–19 digits')
    .optional(),
  /** PAN token returned from a previous tokenisation call */
  cardToken: z.string().min(1).optional(),
  amount: z.number().positive('amount must be a positive number'),
  currency: z.string().length(3, 'currency must be a 3-letter ISO 4217 code').toUpperCase(),
  returnUrl: z.string().url('returnUrl must be a valid URL'),
  merchantId: z.string().min(1, 'merchantId is required'),
  customerId: z.string().optional(),
  /** BIN (first 6–8 digits) used for issuer routing when full PAN is unavailable */
  cardBin: z.string().regex(/^\d{6,8}$/).optional(),
}).refine(
  (d) => d.cardNumber !== undefined || d.cardToken !== undefined || d.cardBin !== undefined,
  { message: 'Provide at least one of cardNumber, cardToken, or cardBin' },
);

// ── Verify 3DS result ─────────────────────────────────────────────────────────

export const verify3DSSchema = z.object({
  threeDSSessionId: z.string().min(1, 'threeDSSessionId is required'),
  /** Value returned by the issuer ACS after the challenge */
  paRes: z.string().optional(),
  /** EMV 3DS 2.x: challenge result indicator (e.g. "Y", "N", "A", "U") */
  transStatus: z.enum(['Y', 'N', 'A', 'U', 'C', 'R']).optional(),
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
});

// ── Get 3DS status ────────────────────────────────────────────────────────────

export const get3DSStatusSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
});

// ── Cancel 3DS session ────────────────────────────────────────────────────────

export const cancel3DSSchema = z.object({
  threeDSSessionId: z.string().min(1, 'threeDSSessionId is required'),
  reason: z.string().max(255).optional(),
});

// ── Response types ────────────────────────────────────────────────────────────

export const ThreeDSStatusEnum = z.enum([
  'pending',
  'challenge_required',
  'authenticated',
  'failed',
  'cancelled',
  'not_enrolled',
  'error',
]);

export const ThreeDSVersionEnum = z.enum(['1.0', '2.1', '2.2']);

export const ThreeDSInitResponseSchema = z.object({
  threeDSSessionId: z.string(),
  status: ThreeDSStatusEnum,
  version: ThreeDSVersionEnum,
  acsUrl: z.string().url().optional(),
  pareq: z.string().optional(),
  /** Base64-encoded AReq for 3DS2 */
  creq: z.string().optional(),
  termUrl: z.string().url().optional(),
  enrolled: z.boolean(),
  message: z.string().optional(),
});

export const ThreeDSVerifyResponseSchema = z.object({
  threeDSSessionId: z.string(),
  paymentIntentId: z.string(),
  status: ThreeDSStatusEnum,
  eci: z.string().optional(),
  authenticationValue: z.string().optional(),
  transactionId: z.string().optional(),
  authenticated: z.boolean(),
  message: z.string().optional(),
});

// ── Exported TypeScript types ─────────────────────────────────────────────────

export type Initiate3DSRequest = z.infer<typeof initiate3DSSchema>;
export type Verify3DSRequest = z.infer<typeof verify3DSSchema>;
export type Get3DSStatusRequest = z.infer<typeof get3DSStatusSchema>;
export type Cancel3DSRequest = z.infer<typeof cancel3DSSchema>;
export type ThreeDSStatus = z.infer<typeof ThreeDSStatusEnum>;
export type ThreeDSVersion = z.infer<typeof ThreeDSVersionEnum>;
export type ThreeDSInitResponse = z.infer<typeof ThreeDSInitResponseSchema>;
export type ThreeDSVerifyResponse = z.infer<typeof ThreeDSVerifyResponseSchema>;
