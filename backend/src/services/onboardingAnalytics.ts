/**
 * onboardingAnalytics.ts — Issue #591
 *
 * Onboarding analytics service: tracks completion rates, drop-off points,
 * A/B test results, and role-specific funnel data.
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

export type UserRole = 'freelancer' | 'client' | 'merchant';
export type OnboardingVariant = 'A' | 'B';
export type StepStatus = 'not_started' | 'in_progress' | 'completed' | 'skipped';

export interface StepProgressRecord {
  stepId: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  skippedAt?: string;
  timeSpentMs?: number;
}

export interface DropOffEvent {
  stepId: string;
  timestamp: string;
  reason?: string;
}

export interface OnboardingSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  variant: OnboardingVariant;
  stepsProgress: StepProgressRecord[];
  dropOffEvents: DropOffEvent[];
  totalTimeMs: number;
  completionRate: number;
  startedAt: string;
  completedAt?: string;
  lastActiveAt: string;
}

export interface StepFunnelStat {
  stepId: string;
  totalStarted: number;
  totalCompleted: number;
  totalSkipped: number;
  totalDropped: number;
  completionRate: number;
  avgTimeSpentMs: number;
}

export interface VariantComparison {
  variant: OnboardingVariant;
  totalSessions: number;
  completedSessions: number;
  completionRate: number;
  avgCompletionTimeMs: number;
  dropOffByStep: Record<string, number>;
}

export interface OnboardingAnalyticsSummary {
  totalSessions: number;
  completedSessions: number;
  overallCompletionRate: number;
  avgCompletionTimeMs: number;
  byRole: Record<UserRole, { total: number; completed: number; completionRate: number }>;
  byVariant: VariantComparison[];
  stepFunnel: StepFunnelStat[];
  topDropOffSteps: Array<{ stepId: string; dropCount: number }>;
  generatedAt: string;
}

// ─── In-memory store (replace with DB in production) ─────────────────────────

const sessions = new Map<string, OnboardingSession>();

// ─── Service ──────────────────────────────────────────────────────────────────

export class OnboardingAnalyticsService {
  /**
   * Record or update a session from frontend analytics payload.
   */
  static upsertSession(payload: Omit<OnboardingSession, 'sessionId'> & { sessionId?: string }): OnboardingSession {
    const sessionId = payload.sessionId ?? `session_${randomUUID()}`;
    const existing = sessions.get(sessionId);

    const session: OnboardingSession = {
      ...(existing ?? {}),
      ...payload,
      sessionId,
    };

    sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get analytics summary across all sessions.
   */
  static getSummary(): OnboardingAnalyticsSummary {
    const allSessions = Array.from(sessions.values());
    const totalSessions = allSessions.length;
    const completedSessions = allSessions.filter((s) => !!s.completedAt).length;
    const overallCompletionRate = totalSessions > 0 ? (completedSessions / totalSessions) * 100 : 0;

    const completedTimings = allSessions.filter((s) => s.completedAt && s.totalTimeMs > 0).map((s) => s.totalTimeMs);
    const avgCompletionTimeMs =
      completedTimings.length > 0
        ? completedTimings.reduce((a, b) => a + b, 0) / completedTimings.length
        : 0;

    // By role
    const roles: UserRole[] = ['freelancer', 'client', 'merchant'];
    const byRole = Object.fromEntries(
      roles.map((role) => {
        const roleSessions = allSessions.filter((s) => s.role === role);
        const roleCompleted = roleSessions.filter((s) => !!s.completedAt).length;
        return [
          role,
          {
            total: roleSessions.length,
            completed: roleCompleted,
            completionRate: roleSessions.length > 0 ? (roleCompleted / roleSessions.length) * 100 : 0,
          },
        ];
      }),
    ) as Record<UserRole, { total: number; completed: number; completionRate: number }>;

    // By variant
    const variants: OnboardingVariant[] = ['A', 'B'];
    const byVariant: VariantComparison[] = variants.map((variant) => {
      const variantSessions = allSessions.filter((s) => s.variant === variant);
      const variantCompleted = variantSessions.filter((s) => !!s.completedAt).length;
      const variantTimings = variantSessions.filter((s) => s.completedAt && s.totalTimeMs > 0).map((s) => s.totalTimeMs);
      const avgTime = variantTimings.length > 0 ? variantTimings.reduce((a, b) => a + b, 0) / variantTimings.length : 0;

      // Drop-off by step
      const dropOffByStep: Record<string, number> = {};
      for (const session of variantSessions) {
        for (const event of session.dropOffEvents) {
          dropOffByStep[event.stepId] = (dropOffByStep[event.stepId] ?? 0) + 1;
        }
      }

      return {
        variant,
        totalSessions: variantSessions.length,
        completedSessions: variantCompleted,
        completionRate: variantSessions.length > 0 ? (variantCompleted / variantSessions.length) * 100 : 0,
        avgCompletionTimeMs: avgTime,
        dropOffByStep,
      };
    });

    // Step funnel
    const stepIds = new Set<string>();
    for (const s of allSessions) {
      for (const sp of s.stepsProgress) stepIds.add(sp.stepId);
    }

    const stepFunnel: StepFunnelStat[] = Array.from(stepIds).map((stepId) => {
      const stepRecords = allSessions.flatMap((s) => s.stepsProgress.filter((sp) => sp.stepId === stepId));
      const started = stepRecords.filter((r) => r.status !== 'not_started').length;
      const completed = stepRecords.filter((r) => r.status === 'completed').length;
      const skipped = stepRecords.filter((r) => r.status === 'skipped').length;
      const dropped = allSessions.filter((s) => s.dropOffEvents.some((e) => e.stepId === stepId)).length;
      const timings = stepRecords.filter((r) => r.timeSpentMs && r.timeSpentMs > 0).map((r) => r.timeSpentMs!);
      const avgTimeSpentMs = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;

      return {
        stepId,
        totalStarted: started,
        totalCompleted: completed,
        totalSkipped: skipped,
        totalDropped: dropped,
        completionRate: started > 0 ? (completed / started) * 100 : 0,
        avgTimeSpentMs,
      };
    });

    // Top drop-off steps
    const dropOffCounts: Record<string, number> = {};
    for (const s of allSessions) {
      for (const event of s.dropOffEvents) {
        dropOffCounts[event.stepId] = (dropOffCounts[event.stepId] ?? 0) + 1;
      }
    }
    const topDropOffSteps = Object.entries(dropOffCounts)
      .map(([stepId, dropCount]) => ({ stepId, dropCount }))
      .sort((a, b) => b.dropCount - a.dropCount)
      .slice(0, 5);

    return {
      totalSessions,
      completedSessions,
      overallCompletionRate: Number(overallCompletionRate.toFixed(2)),
      avgCompletionTimeMs: Math.round(avgCompletionTimeMs),
      byRole,
      byVariant,
      stepFunnel,
      topDropOffSteps,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get a single session by ID.
   */
  static getSession(sessionId: string): OnboardingSession | null {
    return sessions.get(sessionId) ?? null;
  }

  /**
   * List sessions (optionally filtered by role or variant).
   */
  static listSessions(filters?: { role?: UserRole; variant?: OnboardingVariant }): OnboardingSession[] {
    let all = Array.from(sessions.values());
    if (filters?.role) all = all.filter((s) => s.role === filters.role);
    if (filters?.variant) all = all.filter((s) => s.variant === filters.variant);
    return all.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }
}
