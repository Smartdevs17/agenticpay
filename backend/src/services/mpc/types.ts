/**
 * Shared types for the MPC (multi-party computation) threshold-signing
 * service. Kept deliberately in a single file so the coordinator's state
 * machine stays readable.
 */

export type NodeId = string;
export type KeyId = string;
export type SessionId = string;
export type CeremonyId = string;

export type NodeStatus = 'active' | 'degraded' | 'offline' | 'revoked';

export interface MpcNode {
  id: NodeId;
  label?: string;
  status: NodeStatus;
  registeredAt: number;
  lastSeenAt: number;
  /**
   * Per-node public identity key, used to authenticate contributions and
   * detect equivocation. Raw 32-byte Ed25519 public key, hex-encoded.
   */
  identityPublicKey: string;
}

export interface Share {
  /** x-coordinate in GF(256). Non-zero. */
  x: number;
  /** y-coordinates, one per secret byte. */
  y: Buffer;
}

export interface ShareRecord {
  nodeId: NodeId;
  keyId: KeyId;
  share: Share;
  distributedAt: number;
}

export type KeyStatus = 'active' | 'rotating' | 'revoked';

export interface ManagedKey {
  id: KeyId;
  label?: string;
  /** Ed25519 public key, hex-encoded. Safe to expose. */
  publicKey: string;
  threshold: number;
  nodes: NodeId[];
  status: KeyStatus;
  version: number;
  createdAt: number;
  rotatedAt?: number;
  /** Ceremony that produced the current share set. */
  ceremonyId: CeremonyId;
  notes?: string;
}

export type CeremonyStatus = 'pending' | 'active' | 'completed' | 'failed';

export interface Ceremony {
  id: CeremonyId;
  keyId: KeyId;
  label?: string;
  threshold: number;
  nodes: NodeId[];
  status: CeremonyStatus;
  startedAt: number;
  completedAt?: number;
  failureReason?: string;
  /**
   * Participants that have confirmed receipt of their share. A ceremony
   * is only marked completed once every participant acknowledges.
   */
  acknowledgements: NodeId[];
}

export type SigningSessionStatus =
  | 'pending'
  | 'ready'
  | 'signed'
  | 'rejected'
  | 'expired';

export interface Contribution {
  nodeId: NodeId;
  approvedAt: number;
  /**
   * Signature over `sha256(sessionId || payload)` from the node's
   * identity key. Lets the coordinator detect equivocation and replay.
   */
  approvalSignature: string;
}

export interface SigningSession {
  id: SessionId;
  keyId: KeyId;
  /** hex-encoded payload (arbitrary bytes the coordinator will sign). */
  payloadHex: string;
  /** sha256(payload), hex-encoded, used for reviewability. */
  payloadDigest: string;
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
  status: SigningSessionStatus;
  /** Node IDs allowed to contribute (subset of the key's node set). */
  quorum: NodeId[];
  contributions: Contribution[];
  /** Final signature, only present when status === 'signed'. */
  signatureHex?: string;
  failureReason?: string;
}
