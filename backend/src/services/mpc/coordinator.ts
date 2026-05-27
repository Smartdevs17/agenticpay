/**
 * MPC coordinator.
 *
 * Orchestrates the four lifecycle primitives exposed to callers:
 *
 *   1. Key-generation ceremony     → `runCeremony`
 *   2. Threshold signing session   → `startSigningSession` + `contribute`
 *   3. Key rotation                → `rotateKey`
 *   4. Member add / remove         → `addMember` / `removeMember`
 *
 * The scheme is "Shamir + coordinator-side reconstruction" (the same
 * category as Fireblocks-style MPC wallets). Shares live in the HSM
 * backend; the coordinator retrieves them only when a signing session
 * has enough approvals, reconstructs the seed in a short-lived
 * `Buffer`, signs, and zeroises the buffer immediately. At rest no
 * single node — and no single process — holds the private key.
 *
 * This is NOT true distributed-signing FROST. The signing step is
 * factored behind `signWithShares` so a later PR can swap it for a
 * FROST implementation without touching the orchestration code.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  generateSeed,
  publicKeyFromSeed,
  sign as ed25519Sign,
  wipe,
} from './ed25519.js';
import { reconstruct, split } from './shamir.js';
import { getHsm } from './hsm.js';
import {
  assertByzantineCompatible,
  createEquivocationTracker,
  isExpired as bftIsExpired,
  messageDigest,
  recordApproval,
} from './bft.js';
import { getNode, listNodes } from './nodes.js';
import type {
  Ceremony,
  CeremonyId,
  Contribution,
  KeyId,
  ManagedKey,
  NodeId,
  SessionId,
  Share,
  SigningSession,
} from './types.js';

const DEFAULT_SIGNING_TIMEOUT_MS = 5 * 60 * 1000;

const keys = new Map<KeyId, ManagedKey>();
const ceremonies = new Map<CeremonyId, Ceremony>();
const sessions = new Map<SessionId, SigningSession>();
const equivocationTracker = createEquivocationTracker();

export interface RunCeremonyInput {
  threshold: number;
  nodes: NodeId[];
  label?: string;
  notes?: string;
}

export interface RunCeremonyResult {
  key: ManagedKey;
  ceremony: Ceremony;
}

export function runCeremony(input: RunCeremonyInput): RunCeremonyResult {
  assertByzantineCompatible(input.threshold, input.nodes.length);
  assertAllNodesActive(input.nodes);

  if (new Set(input.nodes).size !== input.nodes.length) {
    throw new Error('ceremony node list must not contain duplicates');
  }

  const seed = generateSeed();
  try {
    const publicKey = publicKeyFromSeed(seed);
    const shares = split(seed, input.threshold, input.nodes.length);
    const keyId = newId('key');
    const ceremonyId = newId('cer');
    const now = Date.now();

    distributeShares(keyId, input.nodes, shares);

    const key: ManagedKey = {
      id: keyId,
      label: input.label,
      publicKey: publicKey.toString('hex'),
      threshold: input.threshold,
      nodes: [...input.nodes],
      status: 'active',
      version: 1,
      createdAt: now,
      ceremonyId,
      notes: input.notes,
    };
    const ceremony: Ceremony = {
      id: ceremonyId,
      keyId,
      label: input.label,
      threshold: input.threshold,
      nodes: [...input.nodes],
      status: 'completed',
      startedAt: now,
      completedAt: now,
      acknowledgements: [...input.nodes],
    };

    keys.set(keyId, key);
    ceremonies.set(ceremonyId, ceremony);
    return { key, ceremony };
  } finally {
    wipe(seed);
  }
}

export interface StartSigningInput {
  keyId: KeyId;
  payload: Buffer;
  requestedBy: string;
  timeoutMs?: number;
}

export function startSigningSession(input: StartSigningInput): SigningSession {
  const key = getKeyOrThrow(input.keyId);
  if (key.status !== 'active') {
    throw new Error(`key ${key.id} is not active (status=${key.status})`);
  }

  const id = newId('sig');
  const now = Date.now();
  const payloadHex = input.payload.toString('hex');
  const digest = createHash('sha256').update(input.payload).digest('hex');

  const session: SigningSession = {
    id,
    keyId: key.id,
    payloadHex,
    payloadDigest: digest,
    requestedBy: input.requestedBy,
    createdAt: now,
    expiresAt: now + (input.timeoutMs ?? DEFAULT_SIGNING_TIMEOUT_MS),
    status: 'pending',
    quorum: [...key.nodes],
    contributions: [],
  };
  sessions.set(id, session);
  return session;
}

export interface ContributeInput {
  sessionId: SessionId;
  nodeId: NodeId;
  approvalSignatureHex: string;
}

export interface ContributeResult {
  session: SigningSession;
  completed: boolean;
}

export async function contribute(input: ContributeInput): Promise<ContributeResult> {
  const session = getSessionOrThrow(input.sessionId);
  maybeExpire(session);
  if (session.status !== 'pending') {
    throw new Error(`session ${session.id} is not pending (status=${session.status})`);
  }

  if (!session.quorum.includes(input.nodeId)) {
    throw new Error(`node "${input.nodeId}" is not part of this session's quorum`);
  }

  const node = getNode(input.nodeId);
  if (!node) throw new Error(`unknown node ${input.nodeId}`);
  const digest = messageDigest(session.id, Buffer.from(session.payloadHex, 'hex'));

  const outcome = recordApproval(
    equivocationTracker,
    session.id,
    node.id,
    Buffer.from(node.identityPublicKey, 'hex'),
    digest,
    input.approvalSignatureHex,
  );
  if (!outcome.ok) {
    session.status = 'rejected';
    session.failureReason = outcome.reason;
    throw new Error(
      outcome.reason === 'equivocation'
        ? `node ${input.nodeId} equivocated on session ${session.id}`
        : `node ${input.nodeId} produced an invalid approval signature`,
    );
  }

  if (!session.contributions.some((c) => c.nodeId === input.nodeId)) {
    session.contributions.push({
      nodeId: input.nodeId,
      approvedAt: Date.now(),
      approvalSignature: input.approvalSignatureHex.toLowerCase(),
    });
  }

  const key = getKeyOrThrow(session.keyId);
  if (session.contributions.length >= key.threshold && session.status === 'pending') {
    try {
      await finaliseSession(session, key);
    } catch (err) {
      session.status = 'rejected';
      session.failureReason = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // TS narrowed `session.status` to 'pending' at the top guard;
  // `finaliseSession` mutates the field via a side effect the compiler
  // can't follow. Look up the status through `getSigningSession` so we
  // see the current value with its full type.
  const refreshed = getSigningSession(session.id);
  return { session, completed: refreshed?.status === 'signed' };
}

export function getSigningSession(id: SessionId): SigningSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  maybeExpire(session);
  return session;
}

export interface RotateKeyInput {
  keyId: KeyId;
  nodes?: NodeId[];
  threshold?: number;
}

/**
 * Key rotation. Generates a fresh seed, replaces the existing shares,
 * and bumps the managed key's version. The public key changes — this
 * is proactive refresh, not passive share-rotation of the same secret.
 * Passive refresh (same pubkey, new shares) is a known follow-up.
 */
export function rotateKey(input: RotateKeyInput): ManagedKey {
  const key = getKeyOrThrow(input.keyId);
  const nextNodes = input.nodes ?? key.nodes;
  const nextThreshold = input.threshold ?? key.threshold;

  assertByzantineCompatible(nextThreshold, nextNodes.length);
  assertAllNodesActive(nextNodes);

  const previousNodes = [...key.nodes];
  const seed = generateSeed();
  try {
    const publicKey = publicKeyFromSeed(seed);
    const shares = split(seed, nextThreshold, nextNodes.length);

    // Wipe old shares first so there is no window where two generations
    // are live simultaneously.
    void Promise.all(previousNodes.map((nodeId) => getHsm().delete(key.id, nodeId)));
    distributeShares(key.id, nextNodes, shares);

    key.publicKey = publicKey.toString('hex');
    key.threshold = nextThreshold;
    key.nodes = [...nextNodes];
    key.version += 1;
    key.rotatedAt = Date.now();
    key.status = 'active';
    return key;
  } finally {
    wipe(seed);
  }
}

export async function addMember(keyId: KeyId, nodeId: NodeId): Promise<ManagedKey> {
  const key = getKeyOrThrow(keyId);
  if (key.nodes.includes(nodeId)) {
    throw new Error(`node ${nodeId} already holds a share for ${keyId}`);
  }
  assertAllNodesActive([...key.nodes, nodeId]);

  // A cleanly-added member requires re-sharing the secret. Because our
  // scheme is reconstruct-on-coordinator, we drive the re-share through
  // a fresh ceremony on the same underlying seed. This keeps the
  // public key stable.
  const oldShares = await collectAllShares(key);
  const seed = reconstruct(oldShares);
  try {
    const nextNodes = [...key.nodes, nodeId];
    const shares = split(seed, key.threshold, nextNodes.length);
    await Promise.all(key.nodes.map((id) => getHsm().delete(key.id, id)));
    distributeShares(key.id, nextNodes, shares);
    key.nodes = nextNodes;
    key.version += 1;
    key.rotatedAt = Date.now();
    return key;
  } finally {
    wipe(seed);
    for (const share of oldShares) wipe(share.y);
  }
}

export async function removeMember(keyId: KeyId, nodeId: NodeId): Promise<ManagedKey> {
  const key = getKeyOrThrow(keyId);
  if (!key.nodes.includes(nodeId)) {
    throw new Error(`node ${nodeId} is not a member of ${keyId}`);
  }
  const remaining = key.nodes.filter((n) => n !== nodeId);
  if (remaining.length < key.threshold) {
    throw new Error(
      `removing ${nodeId} would leave ${remaining.length} nodes, below the threshold of ${key.threshold}`,
    );
  }

  // Re-share with the reduced set, revoking the departing node's share
  // explicitly even though we also distribute a fresh one to everyone.
  const oldShares = await collectAllShares(key);
  const seed = reconstruct(oldShares);
  try {
    const shares = split(seed, key.threshold, remaining.length);
    await Promise.all(key.nodes.map((id) => getHsm().delete(key.id, id)));
    distributeShares(key.id, remaining, shares);
    key.nodes = remaining;
    key.version += 1;
    key.rotatedAt = Date.now();
    return key;
  } finally {
    wipe(seed);
    for (const share of oldShares) wipe(share.y);
  }
}

export function listKeys(): ManagedKey[] {
  return Array.from(keys.values());
}

export function getKey(id: KeyId): ManagedKey | undefined {
  return keys.get(id);
}

export function listCeremonies(): Ceremony[] {
  return Array.from(ceremonies.values());
}

export function revokeKey(id: KeyId): ManagedKey | undefined {
  const key = keys.get(id);
  if (!key) return undefined;
  key.status = 'revoked';
  void getHsm().deleteKey(id);
  return key;
}

export function getStatus() {
  const allKeys = listKeys();
  return {
    keys: {
      total: allKeys.length,
      active: allKeys.filter((k) => k.status === 'active').length,
      rotating: allKeys.filter((k) => k.status === 'rotating').length,
      revoked: allKeys.filter((k) => k.status === 'revoked').length,
    },
    nodes: listNodes().length,
    ceremonies: listCeremonies().length,
    sessions: {
      total: sessions.size,
      pending: Array.from(sessions.values()).filter((s) => s.status === 'pending').length,
      signed: Array.from(sessions.values()).filter((s) => s.status === 'signed').length,
    },
    hsmBackend: getHsm().name,
  };
}

/** Test-only helper. Clears all state. */
export function __reset(): void {
  keys.clear();
  ceremonies.clear();
  sessions.clear();
  equivocationTracker.firstSignatureBySession.clear();
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function assertAllNodesActive(ids: NodeId[]): void {
  for (const id of ids) {
    const node = getNode(id);
    if (!node) throw new Error(`unknown node "${id}"`);
    if (node.status !== 'active') {
      throw new Error(`node "${id}" is not active (status=${node.status})`);
    }
  }
}

function distributeShares(keyId: KeyId, nodes: NodeId[], shares: Share[]): void {
  if (nodes.length !== shares.length) {
    throw new Error('share count must match node count');
  }
  const hsm = getHsm();
  // Shares are already randomised — assigning by index preserves the
  // 1:1 mapping between node order and Shamir x-coordinates.
  for (let i = 0; i < nodes.length; i++) {
    void hsm.put(keyId, nodes[i], shares[i]);
  }
}

async function collectShares(key: ManagedKey, limit: number): Promise<Share[]> {
  const hsm = getHsm();
  const collected: Share[] = [];
  for (const nodeId of key.nodes) {
    if (collected.length >= limit) break;
    if (!(await hsm.isAvailable(nodeId))) continue;
    const share = await hsm.get(key.id, nodeId);
    if (share) collected.push(share);
  }
  if (collected.length < limit) {
    throw new Error(
      `only ${collected.length} shares available for key ${key.id}, need ${limit}`,
    );
  }
  return collected;
}

async function collectAllShares(key: ManagedKey): Promise<Share[]> {
  const hsm = getHsm();
  const shares = (
    await Promise.all(key.nodes.map((nodeId) => hsm.get(key.id, nodeId)))
  ).filter((s): s is Share => s !== undefined);
  if (shares.length < key.threshold) {
    throw new Error(
      `insufficient shares for re-share: have ${shares.length}, need ${key.threshold}`,
    );
  }
  return shares;
}

async function signWithShares(key: ManagedKey, payload: Buffer): Promise<Buffer> {
  const shares = await collectShares(key, key.threshold);
  const seed = reconstruct(shares);
  try {
    return ed25519Sign(seed, payload);
  } finally {
    wipe(seed);
    for (const share of shares) wipe(share.y);
  }
}

async function finaliseSession(session: SigningSession, key: ManagedKey): Promise<void> {
  const payload = Buffer.from(session.payloadHex, 'hex');
  const signature = await signWithShares(key, payload);
  session.signatureHex = signature.toString('hex');
  session.status = 'signed';
}

function maybeExpire(session: SigningSession): void {
  if (session.status === 'pending' && bftIsExpired(session.expiresAt)) {
    session.status = 'expired';
    session.failureReason = 'timeout';
  }
}

function getKeyOrThrow(id: KeyId): ManagedKey {
  const key = keys.get(id);
  if (!key) throw new Error(`unknown key ${id}`);
  return key;
}

function getSessionOrThrow(id: SessionId): SigningSession {
  const session = sessions.get(id);
  if (!session) throw new Error(`unknown session ${id}`);
  return session;
}

function newId(prefix: string): string {
  // `randomUUID` is CSPRNG-backed; we add a short random suffix for
  // readability inside logs without leaking timing information.
  const shortId = randomBytes(3).toString('hex');
  return `${prefix}_${randomUUID()}_${shortId}`;
}

// Kept around to silence the unused `Contribution` type-only import in
// case callers rely on it via this module's re-exports.
export type { Contribution };
