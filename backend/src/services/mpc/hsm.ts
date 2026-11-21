/**
 * Pluggable HSM interface for share custody.
 *
 * The in-memory backend is the default — suitable for local dev, tests,
 * and the reference deployment. Production operators are expected to
 * plug in a backend that terminates in real custody (AWS KMS, GCP KMS,
 * HashiCorp Vault Transit, CloudHSM, Fireblocks API). The interface is
 * intentionally narrow so it can be re-implemented without rewriting
 * the coordinator.
 *
 * A "share" here is the Shamir share produced by `shamir.split`. It is
 * owned by a single node and is sealed by the backend before being
 * handed back; the coordinator never holds a plaintext share in its own
 * long-lived state.
 */
import type { KeyId, NodeId, Share } from './types.js';

export interface HsmBackend {
  /** Stable identifier for diagnostics / audit. */
  readonly name: string;

  /** Stash a share for `nodeId` against `keyId`. Overwrites any prior value. */
  put(keyId: KeyId, nodeId: NodeId, share: Share): Promise<void>;

  /** Retrieve a share, or undefined if it does not exist / is unavailable. */
  get(keyId: KeyId, nodeId: NodeId): Promise<Share | undefined>;

  /** Delete a single share (e.g. on member removal). */
  delete(keyId: KeyId, nodeId: NodeId): Promise<void>;

  /** Delete all shares for a key (e.g. on key revocation). */
  deleteKey(keyId: KeyId): Promise<void>;

  /** List the node IDs that currently hold a share for a key. */
  listNodes(keyId: KeyId): Promise<NodeId[]>;

  /**
   * Check whether `nodeId` is currently reachable — used by the BFT
   * layer to decide whether to count a non-responding node as faulty
   * or temporarily offline. In-memory backend always returns true.
   */
  isAvailable(nodeId: NodeId): Promise<boolean>;
}

export class InMemoryHsm implements HsmBackend {
  readonly name = 'in-memory';
  private readonly store = new Map<string, Share>();
  private readonly unavailable = new Set<NodeId>();

  private key(keyId: KeyId, nodeId: NodeId): string {
    return `${keyId}::${nodeId}`;
  }

  async put(keyId: KeyId, nodeId: NodeId, share: Share): Promise<void> {
    // Clone the buffer so callers can't mutate stored state by accident.
    this.store.set(this.key(keyId, nodeId), {
      x: share.x,
      y: Buffer.from(share.y),
    });
  }

  async get(keyId: KeyId, nodeId: NodeId): Promise<Share | undefined> {
    const hit = this.store.get(this.key(keyId, nodeId));
    if (!hit) return undefined;
    if (this.unavailable.has(nodeId)) return undefined;
    return { x: hit.x, y: Buffer.from(hit.y) };
  }

  async delete(keyId: KeyId, nodeId: NodeId): Promise<void> {
    this.store.delete(this.key(keyId, nodeId));
  }

  async deleteKey(keyId: KeyId): Promise<void> {
    for (const k of Array.from(this.store.keys())) {
      if (k.startsWith(`${keyId}::`)) this.store.delete(k);
    }
  }

  async listNodes(keyId: KeyId): Promise<NodeId[]> {
    const prefix = `${keyId}::`;
    return Array.from(this.store.keys())
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  async isAvailable(nodeId: NodeId): Promise<boolean> {
    return !this.unavailable.has(nodeId);
  }

  /** Test-only: simulate a node going offline or coming back. */
  setNodeAvailable(nodeId: NodeId, available: boolean): void {
    if (available) this.unavailable.delete(nodeId);
    else this.unavailable.add(nodeId);
  }

  /** Test-only: expose store size for assertions. */
  size(): number {
    return this.store.size;
  }
}

let activeBackend: HsmBackend = new InMemoryHsm();

export function getHsm(): HsmBackend {
  return activeBackend;
}

export function setHsm(backend: HsmBackend): void {
  activeBackend = backend;
}

export function resetHsm(): void {
  activeBackend = new InMemoryHsm();
}
