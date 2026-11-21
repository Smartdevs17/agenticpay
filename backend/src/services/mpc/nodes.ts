/**
 * MPC node registry. Tracks the M-of-N participants that hold Shamir
 * shares, their identity public keys (for approval-signature
 * verification), and liveness.
 *
 * Kept as a plain in-memory store with a small facade so the coordinator
 * can swap it for a DB-backed registry later without rippling through.
 */
import type { MpcNode, NodeId, NodeStatus } from './types.js';

const nodes = new Map<NodeId, MpcNode>();

export interface RegisterNodeInput {
  id: NodeId;
  identityPublicKey: string;
  label?: string;
}

export function registerNode(input: RegisterNodeInput): MpcNode {
  if (!input.id.trim()) throw new Error('node id must be non-empty');
  if (input.identityPublicKey.length !== 64) {
    throw new Error('identityPublicKey must be 32 bytes (64 hex chars)');
  }
  if (nodes.has(input.id)) {
    throw new Error(`node "${input.id}" already registered`);
  }

  const now = Date.now();
  const node: MpcNode = {
    id: input.id,
    label: input.label,
    identityPublicKey: input.identityPublicKey.toLowerCase(),
    status: 'active',
    registeredAt: now,
    lastSeenAt: now,
  };
  nodes.set(input.id, node);
  return node;
}

export function unregisterNode(id: NodeId): boolean {
  return nodes.delete(id);
}

export function getNode(id: NodeId): MpcNode | undefined {
  return nodes.get(id);
}

export function listNodes(): MpcNode[] {
  return Array.from(nodes.values());
}

export function setNodeStatus(id: NodeId, status: NodeStatus): MpcNode | undefined {
  const node = nodes.get(id);
  if (!node) return undefined;
  node.status = status;
  node.lastSeenAt = Date.now();
  return node;
}

export function heartbeat(id: NodeId): MpcNode | undefined {
  const node = nodes.get(id);
  if (!node) return undefined;
  node.lastSeenAt = Date.now();
  if (node.status === 'offline' || node.status === 'degraded') {
    node.status = 'active';
  }
  return node;
}

export function clearNodes(): void {
  nodes.clear();
}

export function countActive(ids: NodeId[]): number {
  let n = 0;
  for (const id of ids) {
    const node = nodes.get(id);
    if (node && node.status === 'active') n += 1;
  }
  return n;
}
