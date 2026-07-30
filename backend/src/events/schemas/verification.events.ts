import { z } from 'zod';

// Verification domain events
export const VerificationRequestedSchema = z.object({
  verificationId: z.string().uuid(),
  projectId: z.string().uuid(),
  repositoryUrl: z.string().url(),
  branch: z.string().optional(),
  commitHash: z.string().optional(),
  requestedBy: z.string(),
  requestedAt: z.string().datetime(),
});

export const VerificationPassedSchema = z.object({
  verificationId: z.string().uuid(),
  projectId: z.string().uuid(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  details: z.object({
    codeQuality: z.number().min(0).max(100),
    security: z.number().min(0).max(100),
    documentation: z.number().min(0).max(100),
    testCoverage: z.number().min(0).max(100),
  }).optional(),
  verifiedAt: z.string().datetime(),
});

export const VerificationFailedSchema = z.object({
  verificationId: z.string().uuid(),
  projectId: z.string().uuid(),
  reason: z.enum(['repository_not_found', 'build_failed', 'security_issues', 'timeout', 'other']),
  error: z.string(),
  failedAt: z.string().datetime(),
});

// Event type to schema mapping
export const VerificationEventSchemas = {
  'verification.requested': VerificationRequestedSchema,
  'verification.passed': VerificationPassedSchema,
  'verification.failed': VerificationFailedSchema,
} as const;
