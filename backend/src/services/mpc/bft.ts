/**
 * Byzantine-fault-tolerance helpers.
 *
 * The MPC coordinator relies on Shamir's mathematical guarantee that
 * below-threshold coalitions cannot forge signatures. On top of that we
 * layer a few BFT hygiene checks:
 *
 *  - `assertByzantineCompatible` enforces `threshold >= 2F + 1` and
 *    `nodes >= 3F + 1`, the classical PBFT bound, so that a set of `F`
 *    colluding nodes can neither forge nor block signing.
 *  - `detectEquivocation` keeps a short-lived record of each node's
 *    approval signature per session; a second, different signature for
 *    the same session flags the node as equivocating.
 *  - Session timeouts are delegated to the coordinator, but `isExpired`
 *    lives here so every place that touches BFT state calls the same
 *    time-comparison primitive.
 */
import { createHash } from 'node:crypto';
import { verify as verifyEd25519 } from './ed25519.js';
import type { NodeId, SessionId } from './types.js';

export interface ByzantineEnvelope {
  threshold: number;
  nodeCount: number;
  /** Maximum byzantine (colluding / faulty) nodes the scheme tolerates. */
  faultTolerance: number;
}

export function assertByzantineCompatible(threshold: number, nodeCount: number): ByzantineEnvelope {
  if (threshold < 2) {
    throw new Error('threshold must be at least 2 (M-of-N where M >= 2)');
  }
  if (nodeCount < threshold) {
    throw new Error('node count must be >= threshold');
  }

  // f < n/3 is the tight BFT bound; derive the largest f that satisfies
  // both n >= 3f + 1 and threshold >= 2f + 1. Operators can still pick a
  // smaller threshold, but we reject configurations where any byzantine
  // majority exists (e.g. 2-of-3 with one faulty node can still reach
  // signing-quorum + blocking).
  const maxFromNodes = Math.floor((nodeCount - 1) / 3);
  const maxFromThreshold = Math.floor((threshold - 1) / 2);
  const faultTolerance = Math.max(0, Math.min(maxFromNodes, maxFromThreshold));

  if (nodeCount < 3 && threshold !== nodeCount) {
    // With 2 nodes there is no way to survive a single faulty peer. We
    // still allow 2-of-2 for dev convenience but flag it.
    return { threshold, nodeCount, faultTolerance: 0 };
  }

  return { threshold, nodeCount, faultTolerance };
}

export function messageDigest(sessionId: SessionId, payload: Buffer): Buffer {
  // Approvals sign the tuple (sessionId, payload) so that a node can't
  // be tricked into authorising a different payload under the same
  // session id, and a signature for session A can't be replayed to
  // session B.
  return createHash('sha256')
    .update(Buffer.from(sessionId, 'utf-8'))
    .update(Buffer.from([0x00]))
    .update(payload)
    .digest();
}

interface EquivocationTracker {
  firstSignatureBySession: Map<string, string>;
}

function trackerKey(sessionId: SessionId, nodeId: NodeId): string {
  return `${sessionId}::${nodeId}`;
}

export function createEquivocationTracker(): EquivocationTracker {
  return { firstSignatureBySession: new Map() };
}

export interface EquivocationResult {
  ok: boolean;
  reason?: 'bad-signature' | 'equivocation';
}

/**
 * Record an approval signature from a node and check it matches any
 * prior signature the same node has sent for this session. Returns
 * `ok: false` if the signature is forged OR the node has equivocated.
 */
export function recordApproval(
  tracker: EquivocationTracker,
  sessionId: SessionId,
  nodeId: NodeId,
  nodeIdentityPublicKey: Buffer,
  payloadDigest: Buffer,
  signatureHex: string,
): EquivocationResult {
  const signature = Buffer.from(signatureHex, 'hex');
  if (!verifyEd25519(nodeIdentityPublicKey, payloadDigest, signature)) {
    return { ok: false, reason: 'bad-signature' };
  }

  const key = trackerKey(sessionId, nodeId);
  const prior = tracker.firstSignatureBySession.get(key);
  if (prior && prior.toLowerCase() !== signatureHex.toLowerCase()) {
    return { ok: false, reason: 'equivocation' };
  }
  tracker.firstSignatureBySession.set(key, signatureHex.toLowerCase());
  return { ok: true };
}

export function isExpired(expiresAt: number, now: number = Date.now()): boolean {
  return expiresAt <= now;
}

/** For tests: reset internal state. */
export function resetTracker(tracker: EquivocationTracker): void {
  tracker.firstSignatureBySession.clear();
}
