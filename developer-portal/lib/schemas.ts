/**
 * Validation schemas for every untrusted value that enters the developer portal.
 *
 * The WebAuthn service in `lib/webauthn.ts` accepts the typed JSON shapes from
 * `@simplewebauthn/server`, but ceremony responses arrive from the browser as
 * plain JSON. Parsing them here (once, for both server actions and HTTP route
 * handlers) means the rest of the portal can rely on typed inputs instead of
 * sprinkling casts at each entry point.
 *
 * Schemas are deliberately forward-compatible: unknown fields are preserved so
 * a newer authenticator/browser cannot break the ceremony, while every field
 * the verifier actually consumes is checked.
 */
import { z } from 'zod';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

/** Base64URL values are opaque to us, but must be non-empty and URL-safe. */
const base64Url = z.string().min(1).regex(/^[A-Za-z0-9_-]+$/, 'expected a base64url value');

const authenticatorTransport = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);

/** The three extension outputs `@simplewebauthn` understands today. */
const clientExtensionResults = z
  .object({
    appid: z.boolean().optional(),
    credProps: z.object({ rk: z.boolean().optional() }).passthrough().optional(),
    hmacCreateSecret: z.boolean().optional(),
  })
  .passthrough();

const credentialCommon = {
  id: base64Url,
  rawId: base64Url,
  type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  clientExtensionResults,
};

/** `navigator.credentials.create()` JSON, posted by the enrol ceremony. */
export const registrationResponseSchema = z
  .object({
    ...credentialCommon,
    response: z
      .object({
        clientDataJSON: base64Url,
        attestationObject: base64Url,
        authenticatorData: base64Url.optional(),
        transports: z.array(authenticatorTransport).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64Url.optional(),
      })
      .passthrough(),
  })
  .passthrough();

/** `navigator.credentials.get()` JSON, posted by the step-up ceremony. */
export const authenticationResponseSchema = z
  .object({
    ...credentialCommon,
    response: z
      .object({
        clientDataJSON: base64Url,
        authenticatorData: base64Url,
        signature: base64Url,
        userHandle: base64Url.optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type ValidatedRegistrationResponse = z.infer<typeof registrationResponseSchema>;
export type ValidatedAuthenticationResponse = z.infer<typeof authenticationResponseSchema>;

/**
 * Parse a registration response into the type the WebAuthn verifier expects.
 * Returns `null` for anything else; callers turn that into a typed invalid-input
 * result rather than throwing an untyped error across the action boundary.
 */
export function parseRegistrationResponse(input: unknown): RegistrationResponseJSON | null {
  const parsed = registrationResponseSchema.safeParse(input);
  return parsed.success ? (parsed.data as RegistrationResponseJSON) : null;
}

/** Parse an authentication response into the type the WebAuthn verifier expects. */
export function parseAuthenticationResponse(input: unknown): AuthenticationResponseJSON | null {
  const parsed = authenticationResponseSchema.safeParse(input);
  return parsed.success ? (parsed.data as AuthenticationResponseJSON) : null;
}
