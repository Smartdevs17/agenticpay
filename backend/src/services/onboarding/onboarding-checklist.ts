// Issue #632: Minimal role-based onboarding checklist.
//
// Given a user's role, returns (and persists) an ordered list of onboarding
// tasks from a small hardcoded per-role template, tracks completion, and
// computes an overall completion percentage.
//
// Reuses the existing `WorkspaceRole` enum (owner/admin/member/viewer) as the
// role taxonomy since this codebase has no separate onboarding-specific role
// model.
//
// Deferred (see PR body): automated cross-team task assignment, onboarding
// analytics, notifications, completion incentives.

import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../middleware/errorHandler.js';

export type OnboardingRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface OnboardingTask {
  id: string;
  title: string;
  completed: boolean;
  completedAt: string | null;
}

const TASK_TEMPLATES: Record<OnboardingRole, Array<{ id: string; title: string }>> = {
  owner: [
    { id: 'create-workspace', title: 'Create your workspace' },
    { id: 'invite-team', title: 'Invite your team' },
    { id: 'configure-billing', title: 'Configure billing settings' },
    { id: 'connect-payment-method', title: 'Connect a payment method' },
    { id: 'review-security-settings', title: 'Review security settings' },
  ],
  admin: [
    { id: 'accept-invite', title: 'Accept workspace invite' },
    { id: 'configure-permissions', title: 'Configure member permissions' },
    { id: 'review-audit-log', title: 'Review the audit log' },
    { id: 'set-up-webhooks', title: 'Set up webhooks' },
  ],
  member: [
    { id: 'accept-invite', title: 'Accept workspace invite' },
    { id: 'complete-profile', title: 'Complete your profile' },
    { id: 'create-first-payment', title: 'Create your first payment' },
  ],
  viewer: [
    { id: 'accept-invite', title: 'Accept workspace invite' },
    { id: 'complete-profile', title: 'Complete your profile' },
    { id: 'explore-dashboard', title: 'Explore the dashboard' },
  ],
};

function buildInitialTasks(role: OnboardingRole): OnboardingTask[] {
  const template = TASK_TEMPLATES[role];
  if (!template) {
    throw new AppError(400, `Unknown onboarding role: ${role}`, 'UNKNOWN_ROLE');
  }
  return template.map((t) => ({ id: t.id, title: t.title, completed: false, completedAt: null }));
}

function computeCompletionPercent(tasks: OnboardingTask[]): number {
  if (tasks.length === 0) return 100;
  const done = tasks.filter((t) => t.completed).length;
  return Math.round((done / tasks.length) * 100);
}

export class OnboardingChecklistService {
  /**
   * Returns the user's onboarding checklist, creating it from the role's
   * task template on first access.
   */
  async getOrCreateChecklist(tenantId: string, userId: string, role: OnboardingRole) {
    let checklist = await prisma.onboardingChecklist.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });

    if (!checklist) {
      const tasks = buildInitialTasks(role);
      checklist = await prisma.onboardingChecklist.create({
        data: {
          tenantId,
          userId,
          role: role as any,
          tasks: tasks as any,
          completionPercent: computeCompletionPercent(tasks),
        },
      });
    }

    return checklist;
  }

  /**
   * Marks a single task complete and recomputes overall completion percentage.
   */
  async completeTask(tenantId: string, userId: string, taskId: string) {
    const checklist = await prisma.onboardingChecklist.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!checklist) {
      throw new AppError(404, 'Onboarding checklist not found', 'CHECKLIST_NOT_FOUND');
    }

    const tasks = (checklist.tasks as unknown as OnboardingTask[]).map((t) =>
      t.id === taskId ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
    );

    if (!tasks.some((t) => t.id === taskId)) {
      throw new AppError(404, `Unknown onboarding task: ${taskId}`, 'TASK_NOT_FOUND');
    }

    const completionPercent = computeCompletionPercent(tasks);
    const allComplete = completionPercent === 100;

    return prisma.onboardingChecklist.update({
      where: { tenantId_userId: { tenantId, userId } },
      data: {
        tasks: tasks as any,
        completionPercent,
        completedAt: allComplete ? new Date() : null,
      },
    });
  }
}

export const onboardingChecklistService = new OnboardingChecklistService();
