import { z } from 'zod';

const nodeId = z.string().trim().min(1).max(128);
const keyId = z.string().trim().min(1);
const sessionId = z.string().trim().min(1);

export const registerNodeSchema = z.object({
  id: nodeId,
  identityPublicKey: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'identityPublicKey must be 32 bytes (64 hex chars)'),
  label: z.string().optional(),
});

export const ceremonySchema = z.object({
  threshold: z.number().int().min(2).max(254),
  nodes: z.array(nodeId).min(2).max(254),
  label: z.string().optional(),
  notes: z.string().optional(),
});

export const signingRequestSchema = z.object({
  keyId,
  payload: z
    .string()
    .regex(/^[0-9a-fA-F]*$/, 'payload must be hex')
    .refine((s) => s.length > 0 && s.length % 2 === 0, 'payload must be non-empty and even length'),
  requestedBy: z.string().trim().min(1),
  timeoutMs: z.number().int().positive().max(60 * 60 * 1000).optional(),
});

export const contributeSchema = z.object({
  nodeId,
  approvalSignature: z
    .string()
    .regex(/^[0-9a-fA-F]{128}$/, 'approvalSignature must be 64 bytes (128 hex chars)'),
});

export const rotateKeySchema = z.object({
  nodes: z.array(nodeId).min(2).max(254).optional(),
  threshold: z.number().int().min(2).max(254).optional(),
});

export const addMemberSchema = z.object({
  nodeId,
});

export type RegisterNodeInput = z.infer<typeof registerNodeSchema>;
export type CeremonyInput = z.infer<typeof ceremonySchema>;
export type SigningRequestInput = z.infer<typeof signingRequestSchema>;
export type ContributeInput = z.infer<typeof contributeSchema>;
export type RotateKeyInput = z.infer<typeof rotateKeySchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;

// Re-export the param identifiers so callers can reuse the same
// constraints when matching path segments.
export const identifiers = { nodeId, keyId, sessionId };
