import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';
import { VirtualAuthenticator } from '../test/virtual-authenticator';
import {
  authenticationResponseSchema,
  parseAuthenticationResponse,
  parseRegistrationResponse,
  registrationResponseSchema,
} from './schemas';

const authenticator = new VirtualAuthenticator();

const registration = () =>
  authenticator.registrationResponse('portal.agenticpay.dev', 'https://portal.agenticpay.dev', 'challenge');
const authentication = () =>
  authenticator.authenticationResponse('portal.agenticpay.dev', 'https://portal.agenticpay.dev', 'challenge', {
    counter: 1,
  });

describe('registrationResponseSchema', () => {
  it('accepts a browser registration response and produces the verifier type', () => {
    const response = registration();
    expect(registrationResponseSchema.safeParse(response).success).toBe(true);
    expect(parseRegistrationResponse(response)).toEqual(response);
  });

  it('preserves fields added by future browsers or authenticators', () => {
    const parsed = registrationResponseSchema.safeParse({ ...registration(), futureField: 'kept' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toMatchObject({ futureField: 'kept' });
  });

  const invalid: Array<[string, (value: RegistrationResponseJSON) => unknown]> = [
    [
      'a missing response',
      (value) => ({
        id: value.id,
        rawId: value.rawId,
        type: value.type,
        clientExtensionResults: value.clientExtensionResults,
      }),
    ],
    ['a non-public-key credential', (value) => ({ ...value, type: 'not-a-key' })],
    ['an empty id', (value) => ({ ...value, id: '' })],
    ['a non-base64url id', (value) => ({ ...value, id: 'not base64url!' })],
    ['a missing attestation object', (value) => ({ ...value, response: { clientDataJSON: value.response.clientDataJSON } })],
    ['an unknown transport', (value) => ({ ...value, response: { ...value.response, transports: ['carrier-pigeon'] } })],
  ];

  it.each(invalid)('rejects %s', (_label, change) => {
    const input = change(registration());
    expect(registrationResponseSchema.safeParse(input).success).toBe(false);
    expect(parseRegistrationResponse(input)).toBeNull();
  });
});

describe('authenticationResponseSchema', () => {
  it('accepts a browser assertion and produces the verifier type', () => {
    const response = authentication();
    expect(authenticationResponseSchema.safeParse(response).success).toBe(true);
    expect(parseAuthenticationResponse(response)).toEqual(response);
  });

  const invalid: Array<[string, (value: AuthenticationResponseJSON) => unknown]> = [
    ['a missing signature', (value) => ({ ...value, response: { ...value.response, signature: undefined } })],
    ['an empty authenticator data', (value) => ({ ...value, response: { ...value.response, authenticatorData: '' } })],
    ['a client payload that is not an object', () => 'not-an-object'],
    ['a null payload', () => null],
  ];

  it.each(invalid)('rejects %s', (_label, change) => {
    const input = change(authentication());
    expect(authenticationResponseSchema.safeParse(input).success).toBe(false);
    expect(parseAuthenticationResponse(input)).toBeNull();
  });
});
