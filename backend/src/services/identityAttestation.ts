/** Revocable agent identity attestations with signed, verifiable credentials (#1384). */
import { randomUUID, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

export interface VerifiableCredential { id: string; subject: string; claims: Record<string, string>; issuer: string; issuedAt: string; expiresAt?: string; signature: string; publicKey: string; }

export class IdentityAttestationService {
  private readonly revoked = new Set<string>();

  issue(subject: string, claims: Record<string, string>, issuer: string, privateKey: KeyObject, expiresAt?: string): VerifiableCredential {
    if (!subject || !issuer || Object.keys(claims).length === 0) throw new Error('subject, issuer and claims are required');
    const credential = { id: `vc-${randomUUID()}`, subject, claims, issuer, issuedAt: new Date().toISOString(), ...(expiresAt ? { expiresAt } : {}) };
    const payload = JSON.stringify(credential);
    return { ...credential, signature: sign(null, Buffer.from(payload), privateKey).toString('base64'), publicKey: privateKey.export({ type: 'spki', format: 'pem' }).toString() };
  }

  verifyCredential(credential: VerifiableCredential, at = new Date()): boolean {
    if (this.revoked.has(credential.id) || (credential.expiresAt && new Date(credential.expiresAt) <= at)) return false;
    const { signature, publicKey, ...unsigned } = credential;
    return verify(null, Buffer.from(JSON.stringify(unsigned)), publicKey, Buffer.from(signature, 'base64'));
  }

  revoke(id: string): void { this.revoked.add(id); }
  isRevoked(id: string): boolean { return this.revoked.has(id); }
}

export function createAttestationKeyPair() { return generateKeyPairSync('ed25519'); }
