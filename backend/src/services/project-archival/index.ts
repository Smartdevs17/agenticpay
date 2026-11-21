/**
 * project-archival — automated project archival with data retention.
 *
 * Provides retention-policy configuration, an automated archival sweep
 * (archive → retain → purge), restoration of archived projects, archival
 * analytics, and a notification feed consumed by the scheduler and routes.
 */

import { randomUUID } from 'node:crypto';
import { projectsService, type ProjectRecord, type ProjectStatus } from '../projects.js';

export type PolicyScope = 'global' | 'client' | 'owner';

export type ArchiveReason = 'inactivity' | 'completed' | 'abandoned' | 'manual';

export type RetentionPolicy = {
  id: string;
  name: string;
  scope: PolicyScope;
  /** clientId / ownerId the policy applies to; ignored for the global scope. */
  scopeId: string | null;
  /** Days of inactivity after which an eligible project is archived. */
  archiveAfterDays: number;
  /** Days an archived project is retained before it becomes purge-eligible. */
  purgeAfterDays: number;
  /** Project statuses considered archivable by this policy. */
  eligibleStatuses: ProjectStatus[];
  enabled: boolean;
  notify: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveRecord = {
  id: string;
  projectId: string;
  projectName: string;
  clientId: string;
  ownerId: string;
  policyId: string;
  reason: ArchiveReason;
  previousStatus: ProjectStatus;
  inactiveDays: number;
  milestoneCount: number;
  budget: number;
  currency: string;
  archivedAt: string;
  /** Timestamp after which the archive may be purged. */
  purgeEligibleAt: string;
  restoredAt: string | null;
  restoredBy: string | null;
  purgedAt: string | null;
};

export type ArchivalNotificationType = 'archived' | 'purge_due' | 'purged' | 'restored';

export type ArchivalNotification = {
  id: string;
  type: ArchivalNotificationType;
  projectId: string;
  projectName: string;
  recipients: string[];
  message: string;
  createdAt: string;
};

export type ArchivalRunResult = {
  runAt: string;
  dryRun: boolean;
  scanned: number;
  archived: ArchiveRecord[];
  purged: ArchiveRecord[];
  skipped: number;
  notifications: ArchivalNotification[];
  durationMs: number;
};

export type ArchivalCandidate = {
  projectId: string;
  projectName: string;
  policyId: string;
  reason: ArchiveReason;
  inactiveDays: number;
  status: ProjectStatus;
};

export type ConfigurePolicyInput = {
  id?: string;
  name: string;
  scope?: PolicyScope;
  scopeId?: string | null;
  archiveAfterDays: number;
  purgeAfterDays: number;
  eligibleStatuses?: ProjectStatus[];
  enabled?: boolean;
  notify?: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ELIGIBLE_STATUSES: ProjectStatus[] = ['completed', 'abandoned'];
const NOTIFICATION_LIMIT = 500;

/** Notifications are emitted ahead of a purge once the window is this close. */
const PURGE_WARNING_DAYS = 7;

export class ProjectArchivalService {
  private policies = new Map<string, RetentionPolicy>();
  private records = new Map<string, ArchiveRecord>();
  private notifications: ArchivalNotification[] = [];
  private lastRun: ArchivalRunResult | null = null;

  constructor() {
    this.seedDefaultPolicy();
  }

  private nowIso(now = new Date()): string {
    return now.toISOString();
  }

  private seedDefaultPolicy(): void {
    const now = this.nowIso();
    const policy: RetentionPolicy = {
      id: 'default',
      name: 'Default retention policy',
      scope: 'global',
      scopeId: null,
      archiveAfterDays: Number(process.env.PROJECT_ARCHIVE_AFTER_DAYS ?? 90),
      purgeAfterDays: Number(process.env.PROJECT_PURGE_AFTER_DAYS ?? 365),
      eligibleStatuses: [...DEFAULT_ELIGIBLE_STATUSES],
      enabled: true,
      notify: true,
      createdAt: now,
      updatedAt: now,
    };
    this.policies.set(policy.id, policy);
  }

  // ── Retention policy configuration ────────────────────────────────────────

  configurePolicy(input: ConfigurePolicyInput): RetentionPolicy {
    if (input.archiveAfterDays < 0 || input.purgeAfterDays < 0) {
      throw new Error('Retention windows must be non-negative');
    }
    if (input.purgeAfterDays < input.archiveAfterDays) {
      throw new Error('purgeAfterDays must be greater than or equal to archiveAfterDays');
    }

    const scope = input.scope ?? 'global';
    if (scope !== 'global' && !input.scopeId) {
      throw new Error(`A scopeId is required for the "${scope}" scope`);
    }

    const id = input.id ?? randomUUID();
    const existing = this.policies.get(id);
    const now = this.nowIso();

    const policy: RetentionPolicy = {
      id,
      name: input.name,
      scope,
      scopeId: scope === 'global' ? null : String(input.scopeId),
      archiveAfterDays: input.archiveAfterDays,
      purgeAfterDays: input.purgeAfterDays,
      eligibleStatuses: input.eligibleStatuses?.length
        ? [...input.eligibleStatuses]
        : existing?.eligibleStatuses ?? [...DEFAULT_ELIGIBLE_STATUSES],
      enabled: input.enabled ?? existing?.enabled ?? true,
      notify: input.notify ?? existing?.notify ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.policies.set(policy.id, policy);
    return policy;
  }

  listPolicies(): RetentionPolicy[] {
    return [...this.policies.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getPolicy(policyId: string): RetentionPolicy | undefined {
    return this.policies.get(policyId);
  }

  deletePolicy(policyId: string): boolean {
    if (policyId === 'default') return false;
    return this.policies.delete(policyId);
  }

  /** Most specific enabled policy wins: owner → client → global. */
  resolvePolicy(project: ProjectRecord): RetentionPolicy | undefined {
    const enabled = [...this.policies.values()].filter((policy) => policy.enabled);
    return (
      enabled.find((p) => p.scope === 'owner' && p.scopeId === project.ownerId) ??
      enabled.find((p) => p.scope === 'client' && p.scopeId === project.clientId) ??
      enabled.find((p) => p.scope === 'global')
    );
  }

  // ── Eligibility ───────────────────────────────────────────────────────────

  private inactiveDays(project: ProjectRecord, now: Date): number {
    const last = new Date(project.endDate ?? project.updatedAt).getTime();
    return Math.floor((now.getTime() - last) / DAY_MS);
  }

  private reasonFor(status: ProjectStatus): ArchiveReason {
    if (status === 'completed') return 'completed';
    if (status === 'abandoned') return 'abandoned';
    return 'inactivity';
  }

  /** Projects that the current policy set would archive on the next sweep. */
  previewArchival(now = new Date()): ArchivalCandidate[] {
    const candidates: ArchivalCandidate[] = [];

    for (const project of projectsService.listProjects({ includeArchived: true })) {
      if (project.status === 'archived') continue;

      const policy = this.resolvePolicy(project);
      if (!policy || !policy.eligibleStatuses.includes(project.status)) continue;

      const inactiveDays = this.inactiveDays(project, now);
      if (inactiveDays < policy.archiveAfterDays) continue;

      candidates.push({
        projectId: project.id,
        projectName: project.name,
        policyId: policy.id,
        reason: this.reasonFor(project.status),
        inactiveDays,
        status: project.status,
      });
    }

    return candidates;
  }

  // ── Archival ──────────────────────────────────────────────────────────────

  /**
   * Run the archival sweep: archive eligible projects, warn about upcoming
   * purges, and purge archives whose retention window has elapsed.
   */
  runArchival(options?: { dryRun?: boolean; now?: Date }): ArchivalRunResult {
    const startedAt = Date.now();
    const now = options?.now ?? new Date();
    const dryRun = options?.dryRun ?? false;

    const projects = projectsService.listProjects({ includeArchived: true });
    const candidates = this.previewArchival(now);
    const notifications: ArchivalNotification[] = [];
    const archived: ArchiveRecord[] = [];

    for (const candidate of candidates) {
      const project = projectsService.getProject(candidate.projectId);
      if (!project) continue;

      const policy = this.policies.get(candidate.policyId);
      if (!policy) continue;

      const record = this.buildRecord(project, policy, candidate.reason, candidate.inactiveDays, now);
      archived.push(record);

      if (dryRun) continue;

      this.records.set(record.id, record);
      projectsService.archiveProject(project.id);

      if (policy.notify) {
        notifications.push(
          this.emit('archived', project, [project.ownerId, project.clientId],
            `Project "${project.name}" was archived after ${candidate.inactiveDays} day(s) of inactivity ` +
              `under policy "${policy.name}". It is retained until ${record.purgeEligibleAt}.`),
        );
      }
    }

    const purged = dryRun ? [] : this.enforceRetention(now, notifications);

    const result: ArchivalRunResult = {
      runAt: this.nowIso(now),
      dryRun,
      scanned: projects.length,
      archived,
      purged,
      skipped: projects.length - archived.length,
      notifications,
      durationMs: Date.now() - startedAt,
    };

    if (!dryRun) this.lastRun = result;
    return result;
  }

  private buildRecord(
    project: ProjectRecord,
    policy: RetentionPolicy,
    reason: ArchiveReason,
    inactiveDays: number,
    now: Date,
  ): ArchiveRecord {
    return {
      id: randomUUID(),
      projectId: project.id,
      projectName: project.name,
      clientId: project.clientId,
      ownerId: project.ownerId,
      policyId: policy.id,
      reason,
      previousStatus: project.status,
      inactiveDays,
      milestoneCount: projectsService.listMilestones(project.id).length,
      budget: project.budget,
      currency: project.currency,
      archivedAt: this.nowIso(now),
      purgeEligibleAt: new Date(now.getTime() + policy.purgeAfterDays * DAY_MS).toISOString(),
      restoredAt: null,
      restoredBy: null,
      purgedAt: null,
    };
  }

  /** Archive a single project on demand, bypassing the inactivity window. */
  archiveNow(projectId: string, actor?: string): ArchiveRecord | undefined {
    const project = projectsService.getProject(projectId);
    if (!project || project.status === 'archived') return undefined;

    const policy = this.resolvePolicy(project) ?? this.policies.get('default');
    if (!policy) return undefined;

    const now = new Date();
    const record = this.buildRecord(project, policy, 'manual', this.inactiveDays(project, now), now);
    this.records.set(record.id, record);
    projectsService.archiveProject(project.id);

    if (policy.notify) {
      this.emit('archived', project, [project.ownerId, project.clientId],
        `Project "${project.name}" was archived manually${actor ? ` by ${actor}` : ''}. ` +
          `It is retained until ${record.purgeEligibleAt}.`);
    }

    return record;
  }

  /** Warn about imminent purges and purge archives past their retention window. */
  private enforceRetention(now: Date, notifications: ArchivalNotification[]): ArchiveRecord[] {
    const purged: ArchiveRecord[] = [];

    for (const record of this.records.values()) {
      if (record.purgedAt || record.restoredAt) continue;

      const dueIn = Math.ceil((new Date(record.purgeEligibleAt).getTime() - now.getTime()) / DAY_MS);
      const policy = this.policies.get(record.policyId);

      if (dueIn > 0) {
        if (dueIn <= PURGE_WARNING_DAYS && policy?.notify) {
          notifications.push(
            this.emitRaw('purge_due', record.projectId, record.projectName, [record.ownerId, record.clientId],
              `Archived project "${record.projectName}" will be purged in ${dueIn} day(s). Restore it to retain the data.`),
          );
        }
        continue;
      }

      record.purgedAt = this.nowIso(now);
      projectsService.purgeProject(record.projectId);
      purged.push(record);

      if (policy?.notify) {
        notifications.push(
          this.emitRaw('purged', record.projectId, record.projectName, [record.ownerId, record.clientId],
            `Archived project "${record.projectName}" was purged after its ${policy.purgeAfterDays}-day retention window.`),
        );
      }
    }

    return purged;
  }

  // ── Restoration ───────────────────────────────────────────────────────────

  restoreProject(projectId: string, restoredBy?: string): { record: ArchiveRecord; project: ProjectRecord } | undefined {
    const record = this.latestActiveRecord(projectId);
    if (!record || record.purgedAt) return undefined;

    const project = projectsService.restoreProject(projectId, record.previousStatus);
    if (!project) return undefined;

    record.restoredAt = this.nowIso();
    record.restoredBy = restoredBy ?? null;

    const policy = this.policies.get(record.policyId);
    if (policy?.notify) {
      this.emit('restored', project, [project.ownerId, project.clientId],
        `Project "${project.name}" was restored to "${record.previousStatus}"${restoredBy ? ` by ${restoredBy}` : ''}.`);
    }

    return { record, project };
  }

  private latestActiveRecord(projectId: string): ArchiveRecord | undefined {
    return [...this.records.values()]
      .filter((record) => record.projectId === projectId && !record.restoredAt && !record.purgedAt)
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))[0];
  }

  listArchives(filters?: {
    clientId?: string;
    ownerId?: string;
    policyId?: string;
    includeRestored?: boolean;
    includePurged?: boolean;
  }): ArchiveRecord[] {
    return [...this.records.values()]
      .filter((record) => {
        if (filters?.clientId && record.clientId !== filters.clientId) return false;
        if (filters?.ownerId && record.ownerId !== filters.ownerId) return false;
        if (filters?.policyId && record.policyId !== filters.policyId) return false;
        if (!filters?.includeRestored && record.restoredAt) return false;
        if (!filters?.includePurged && record.purgedAt) return false;
        return true;
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  getArchive(recordId: string): ArchiveRecord | undefined {
    return this.records.get(recordId);
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  getAnalytics(now = new Date()): {
    totals: {
      archived: number;
      retained: number;
      restored: number;
      purged: number;
      pendingCandidates: number;
      archivedBudget: number;
    };
    restorationRate: number;
    averageInactiveDays: number;
    averageRetentionDays: number;
    byReason: Record<string, number>;
    byPolicy: Array<{ policyId: string; policyName: string; archived: number; purged: number }>;
    byMonth: Array<{ month: string; archived: number }>;
    upcomingPurges: Array<{ recordId: string; projectId: string; projectName: string; purgeEligibleAt: string; daysRemaining: number }>;
    lastRunAt: string | null;
  } {
    const all = [...this.records.values()];
    const restored = all.filter((record) => record.restoredAt);
    const purged = all.filter((record) => record.purgedAt);
    const retained = all.filter((record) => !record.restoredAt && !record.purgedAt);

    const byReason: Record<string, number> = {};
    for (const record of all) {
      byReason[record.reason] = (byReason[record.reason] ?? 0) + 1;
    }

    const byMonthMap = new Map<string, number>();
    for (const record of all) {
      const month = record.archivedAt.slice(0, 7);
      byMonthMap.set(month, (byMonthMap.get(month) ?? 0) + 1);
    }

    const byPolicy = this.listPolicies().map((policy) => ({
      policyId: policy.id,
      policyName: policy.name,
      archived: all.filter((record) => record.policyId === policy.id).length,
      purged: purged.filter((record) => record.policyId === policy.id).length,
    }));

    const retentionDays = retained.map((record) =>
      Math.max(0, Math.floor((now.getTime() - new Date(record.archivedAt).getTime()) / DAY_MS)),
    );

    const average = (values: number[]): number =>
      values.length === 0 ? 0 : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));

    const upcomingPurges = retained
      .map((record) => ({
        recordId: record.id,
        projectId: record.projectId,
        projectName: record.projectName,
        purgeEligibleAt: record.purgeEligibleAt,
        daysRemaining: Math.ceil((new Date(record.purgeEligibleAt).getTime() - now.getTime()) / DAY_MS),
      }))
      .sort((a, b) => a.daysRemaining - b.daysRemaining)
      .slice(0, 20);

    return {
      totals: {
        archived: all.length,
        retained: retained.length,
        restored: restored.length,
        purged: purged.length,
        pendingCandidates: this.previewArchival(now).length,
        archivedBudget: Number(retained.reduce((sum, record) => sum + record.budget, 0).toFixed(2)),
      },
      restorationRate: all.length === 0 ? 0 : Number((restored.length / all.length).toFixed(4)),
      averageInactiveDays: average(all.map((record) => record.inactiveDays)),
      averageRetentionDays: average(retentionDays),
      byReason,
      byPolicy,
      byMonth: [...byMonthMap.entries()]
        .map(([month, archived]) => ({ month, archived }))
        .sort((a, b) => a.month.localeCompare(b.month)),
      upcomingPurges,
      lastRunAt: this.lastRun?.runAt ?? null,
    };
  }

  getLastRun(): ArchivalRunResult | null {
    return this.lastRun;
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  private emit(
    type: ArchivalNotificationType,
    project: ProjectRecord,
    recipients: string[],
    message: string,
  ): ArchivalNotification {
    return this.emitRaw(type, project.id, project.name, recipients, message);
  }

  private emitRaw(
    type: ArchivalNotificationType,
    projectId: string,
    projectName: string,
    recipients: string[],
    message: string,
  ): ArchivalNotification {
    const notification: ArchivalNotification = {
      id: randomUUID(),
      type,
      projectId,
      projectName,
      recipients: [...new Set(recipients.filter(Boolean))],
      message,
      createdAt: this.nowIso(),
    };

    this.notifications.unshift(notification);
    if (this.notifications.length > NOTIFICATION_LIMIT) {
      this.notifications.length = NOTIFICATION_LIMIT;
    }

    console.log(`[project-archival] ${type}: ${message}`);
    return notification;
  }

  listNotifications(limit = 50, projectId?: string): ArchivalNotification[] {
    return this.notifications
      .filter((notification) => !projectId || notification.projectId === projectId)
      .slice(0, Math.max(1, limit));
  }

  resetForTests(): void {
    this.policies.clear();
    this.records.clear();
    this.notifications = [];
    this.lastRun = null;
    this.seedDefaultPolicy();
  }
}

export const projectArchivalService = new ProjectArchivalService();

/** Scheduler entrypoint — see backend/src/config/scheduled-tasks.ts. */
export function runProjectArchivalSweep(): ArchivalRunResult {
  const result = projectArchivalService.runArchival();
  console.log(
    `[project-archival] Sweep complete: ${result.archived.length} archived, ` +
      `${result.purged.length} purged, ${result.scanned} scanned in ${result.durationMs}ms`,
  );
  return result;
}
