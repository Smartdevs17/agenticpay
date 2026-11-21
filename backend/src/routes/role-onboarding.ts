// Issue #632: Role-based onboarding checklist (minimal real slice).
//
// Distinct from the existing document-review merchant `onboarding.ts`
// router: this covers a lightweight, role-based task checklist (owner /
// admin / member / viewer), not merchant KYC document review.
//
// Deferred: automated cross-team task assignment, onboarding analytics,
// notifications, completion incentives.

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../middleware/errorHandler.js';
import { onboardingChecklistService, type OnboardingRole } from '../services/onboarding/onboarding-checklist.js';

export const roleOnboardingRouter = Router();

const VALID_ROLES: OnboardingRole[] = ['owner', 'admin', 'member', 'viewer'];

function resolveTenant(req: any): string {
  return (req.headers['x-tenant-id'] as string) ?? 'default';
}

function resolveUser(req: any): string {
  return (req.headers['x-user-id'] as string) ?? 'unknown';
}

roleOnboardingRouter.get('/checklist', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const userId = resolveUser(req);
  const role = (req.query.role as string) ?? 'member';

  if (!VALID_ROLES.includes(role as OnboardingRole)) {
    throw new AppError(400, `Invalid role: ${role}`, 'INVALID_ROLE');
  }

  const checklist = await onboardingChecklistService.getOrCreateChecklist(tenantId, userId, role as OnboardingRole);
  res.json(checklist);
}));

roleOnboardingRouter.post('/checklist/tasks/:taskId/complete', asyncHandler(async (req, res) => {
  const tenantId = resolveTenant(req);
  const userId = resolveUser(req);
  const checklist = await onboardingChecklistService.completeTask(tenantId, userId, req.params.taskId as string);
  res.json(checklist);
}));
