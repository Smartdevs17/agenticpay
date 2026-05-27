/**
 * Public façade for the MPC module. Keep this file thin — all the
 * behaviour lives in the individual submodules so tests can target each
 * layer in isolation.
 */
export * as coordinator from './coordinator.js';
export * as nodes from './nodes.js';
export * as bft from './bft.js';
export * as hsm from './hsm.js';
export * as ed25519 from './ed25519.js';
export * as shamir from './shamir.js';
export type {
  Ceremony,
  CeremonyId,
  Contribution,
  KeyId,
  ManagedKey,
  MpcNode,
  NodeId,
  NodeStatus,
  SessionId,
  Share,
  SigningSession,
  SigningSessionStatus,
} from './types.js';
