/**
 * A minimal in-process WebAuthn authenticator for tests.
 *
 * Verification in `@simplewebauthn/server` is real cryptography, so faking the
 * service would not prove anything. This helper produces genuine `none`-format
 * attestations and ES256 assertions — a real P-256 key pair, real CBOR-encoded
 * COSE public key, real signature over `authData || SHA-256(clientDataJSON)` —
 * so the tests drive the same code path a browser and a security key would.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Tiny CBOR encoder (only the subset an authenticator needs)
// ---------------------------------------------------------------------------

function encodeHeader(major: number, value: number): number[] {
  const base = major << 5;
  if (value < 24) return [base | value];
  if (value < 0x100) return [base | 24, value];
  if (value < 0x10000) return [base | 25, (value >> 8) & 0xff, value & 0xff];
  return [base | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

const cborInteger = (value: number): number[] =>
  value >= 0 ? encodeHeader(0, value) : encodeHeader(1, -1 - value);
const cborBytes = (bytes: Uint8Array): number[] => [...encodeHeader(2, bytes.length), ...bytes];
const cborText = (text: string): number[] => {
  const bytes = encoder.encode(text);
  return [...encodeHeader(3, bytes.length), ...bytes];
};
const cborMap = (pairs: number[][][]): number[] => [...encodeHeader(5, pairs.length), ...pairs.flat(2)];

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function sha256(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash('sha256').update(bytes).digest());
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(parts.map((part) => Buffer.from(part))));
}

function u32be(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function clientDataJSON(type: string, challenge: string, origin: string): Uint8Array {
  return encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

// ---------------------------------------------------------------------------

export interface CeremonyOverrides {
  /** Signature counter the authenticator reports. */
  counter?: number;
  /** Override the origin baked into `clientDataJSON` (defaults to the real one). */
  origin?: string;
  /** Override the `type` field of `clientDataJSON`. */
  clientDataType?: string;
}

export class VirtualAuthenticator {
  readonly credentialId: Uint8Array;
  private readonly privateKey: KeyObject;
  private readonly x: Uint8Array;
  private readonly y: Uint8Array;

  constructor(credentialId: Uint8Array = randomBytes(16)) {
    this.credentialId = credentialId;
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' }) as { x?: string; y?: string };
    if (!jwk.x || !jwk.y) throw new Error('failed to export the P-256 public key');
    this.x = new Uint8Array(Buffer.from(jwk.x, 'base64url'));
    this.y = new Uint8Array(Buffer.from(jwk.y, 'base64url'));
  }

  get credentialIdBase64Url(): string {
    return toBase64Url(this.credentialId);
  }

  private cosePublicKey(): Uint8Array {
    return new Uint8Array(
      cborMap([
        [cborInteger(1), cborInteger(2)], // kty: EC2
        [cborInteger(3), cborInteger(-7)], // alg: ES256
        [cborInteger(-1), cborInteger(1)], // crv: P-256
        [cborInteger(-2), cborBytes(this.x)],
        [cborInteger(-3), cborBytes(this.y)],
      ]),
    );
  }

  /** Build a `navigator.credentials.create()` response (`webauthn.create`). */
  registrationResponse(
    rpID: string,
    origin: string,
    challenge: string,
    overrides: CeremonyOverrides = {},
  ): RegistrationResponseJSON {
    const flags = 0x01 | 0x04 | 0x40; // UP | UV | AT
    const authData = concat(sha256(encoder.encode(rpID)), new Uint8Array([flags]), u32be(overrides.counter ?? 0));
    const credentialIdLength = new Uint8Array(2);
    new DataView(credentialIdLength.buffer).setUint16(0, this.credentialId.length);
    const attestedCredentialData = concat(
      new Uint8Array(16), // AAGUID
      credentialIdLength,
      this.credentialId,
      this.cosePublicKey(),
    );
    const attestationObject = new Uint8Array(
      cborMap([
        [cborText('fmt'), cborText('none')],
        [cborText('attStmt'), cborMap([])],
        [cborText('authData'), cborBytes(concat(authData, attestedCredentialData))],
      ]),
    );
    const data = clientDataJSON(overrides.clientDataType ?? 'webauthn.create', challenge, overrides.origin ?? origin);
    return {
      id: this.credentialIdBase64Url,
      rawId: this.credentialIdBase64Url,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(data),
        attestationObject: toBase64Url(attestationObject),
      },
    };
  }

  /** Build a `navigator.credentials.get()` response (`webauthn.get`). */
  authenticationResponse(
    rpID: string,
    origin: string,
    challenge: string,
    overrides: CeremonyOverrides = {},
  ): AuthenticationResponseJSON {
    const flags = 0x01 | 0x04; // UP | UV
    const authenticatorData = concat(
      sha256(encoder.encode(rpID)),
      new Uint8Array([flags]),
      u32be(overrides.counter ?? 1),
    );
    const data = clientDataJSON(overrides.clientDataType ?? 'webauthn.get', challenge, overrides.origin ?? origin);
    const signedData = concat(authenticatorData, sha256(data));
    const signature = createSign('sha256').update(Buffer.from(signedData)).sign(this.privateKey);
    return {
      id: this.credentialIdBase64Url,
      rawId: this.credentialIdBase64Url,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(data),
        authenticatorData: toBase64Url(authenticatorData),
        signature: toBase64Url(new Uint8Array(signature)),
      },
    };
  }
}

/** Decode the `challenge` out of a ceremony's `clientDataJSON`. */
export function challengeFromClientData(clientDataJSON: string): string {
  const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge: string };
  return parsed.challenge;
}
