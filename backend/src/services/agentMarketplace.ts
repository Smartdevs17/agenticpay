/** Signed, versioned agent capability manifests (#1388). */
import { createHash, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

export interface CapabilityManifest {
  agentId: string;
  version: string;
  capabilities: string[];
  endpoint: string;
  publishedAt: string;
}

export interface SignedManifest {
  manifest: CapabilityManifest;
  digest: string;
  publicKey: string;
  signature: string;
}

function canonical(manifest: CapabilityManifest): string {
  return JSON.stringify({ ...manifest, capabilities: [...manifest.capabilities].sort() });
}

export class AgentMarketplace {
  private readonly entries = new Map<string, SignedManifest>();
  private readonly revoked = new Set<string>();

  publish(manifest: CapabilityManifest, privateKey: KeyObject): SignedManifest {
    if (!manifest.agentId || !manifest.version || !manifest.endpoint || manifest.capabilities.length === 0) {
      throw new Error('manifest requires an agent, version, endpoint and capability');
    }
    const payload = canonical(manifest);
    const digest = createHash('sha256').update(payload).digest('hex');
    const publicKey = privateKey.export({ type: 'spki', format: 'pem' }).toString();
    const signed = { manifest, digest, publicKey, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
    this.entries.set(`${manifest.agentId}@${manifest.version}`, signed);
    return signed;
  }

  get(agentId: string, version?: string): SignedManifest | undefined {
    const matches = [...this.entries.values()].filter((entry) => entry.manifest.agentId === agentId && !this.revoked.has(entry.digest));
    if (version) return matches.find((entry) => entry.manifest.version === version);
    return matches.sort((a, b) => b.manifest.version.localeCompare(a.manifest.version))[0];
  }

  verify(entry: SignedManifest): boolean {
    if (this.revoked.has(entry.digest)) return false;
    const payload = canonical(entry.manifest);
    return createHash('sha256').update(payload).digest('hex') === entry.digest && verify(null, Buffer.from(payload), entry.publicKey, Buffer.from(entry.signature, 'base64'));
  }

  revoke(digest: string): boolean {
    if (!this.entriesHasDigest(digest) || this.revoked.has(digest)) return false;
    this.revoked.add(digest);
    return true;
  }
  private entriesHasDigest(digest: string): boolean { return [...this.entries.values()].some((entry) => entry.digest === digest); }
  list(): SignedManifest[] { return [...this.entries.values()].filter((entry) => !this.revoked.has(entry.digest)); }
}

export function createSigningKeyPair() { return generateKeyPairSync('ed25519'); }
