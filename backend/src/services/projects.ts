import { randomUUID } from 'node:crypto';

export type ProjectStatus = 'active' | 'completed' | 'archived' | 'disputed' | 'abandoned';
export type MilestoneStatus = 'pending' | 'submitted' | 'approved' | 'released' | 'disputed';

export type MilestoneRecord = {
  id: string;
  title: string;
  deliverable: string;
  amount: number;
  dueDate: string;
  status: MilestoneStatus;
  submittedAt: string | null;
  approvedAt: string | null;
  submissionUrl: string | null;
  submissionNotes: string | null;
  disputeReason: string | null;
  createdAt: string;
  updatedAt: string;
  dependsOn: string[];
};

export type ProjectRecord = {
  id: string;
  name: string;
  clientId: string;
  ownerId: string;
  budget: number;
  spentBudget: number;
  currency: string;
  startDate: string;
  endDate: string | null;
  description?: string;
  status: ProjectStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  scopeChangeCount: number;
};

export type PaymentReleaseRecord = {
  id: string;
  projectId: string;
  milestoneId: string;
  amount: number;
  currency: string;
  releasedAt: string;
  releasedBy: string;
};

export type MilestoneDependency = {
  milestoneId: string;
  dependsOnMilestoneId: string;
  dependencyTitle: string;
  milestoneTitle: string;
};

export interface CriticalPathNode {
  milestoneId: string;
  title: string;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  slack: number;
  isCritical: boolean;
}

export interface CriticalPathResult {
  nodes: CriticalPathNode[];
  criticalPath: string[];
  totalDuration: number;
}

export interface DependencyConflict {
  type: 'circular_dependency';
  cycle: string[];
  description: string;
}

export interface GanttItem {
  milestoneId: string;
  title: string;
  startDate: string;
  endDate: string;
  status: MilestoneStatus;
  dependsOn: string[];
  progress: number;
}

type CreateProjectInput = {
  name: string;
  clientId: string;
  ownerId: string;
  budget: number;
  currency: string;
  startDate: string;
  endDate?: string;
  description?: string;
};

type AddMilestoneInput = {
  title: string;
  deliverable: string;
  amount: number;
  dueDate: string;
  dependsOn?: string[];
};

export class ProjectsService {
  private projects = new Map<string, ProjectRecord>();
  private milestones = new Map<string, MilestoneRecord[]>();
  private releases: PaymentReleaseRecord[] = [];

  private nowIso(): string {
    return new Date().toISOString();
  }

  createProject(input: CreateProjectInput): ProjectRecord {
    const now = this.nowIso();
    const project: ProjectRecord = {
      id: randomUUID(),
      name: input.name,
      clientId: input.clientId,
      ownerId: input.ownerId,
      budget: Number(input.budget.toFixed(2)),
      spentBudget: 0,
      currency: input.currency.toUpperCase(),
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      description: input.description,
      status: 'active',
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      scopeChangeCount: 0,
    };

    this.projects.set(project.id, project);
    this.milestones.set(project.id, []);
    return project;
  }

  listProjects(filters?: { clientId?: string; ownerId?: string; includeArchived?: boolean }): ProjectRecord[] {
    return [...this.projects.values()]
      .filter((project) => {
        if (filters?.clientId && project.clientId !== filters.clientId) return false;
        if (filters?.ownerId && project.ownerId !== filters.ownerId) return false;
        if (!filters?.includeArchived && project.status === 'archived') return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProject(projectId: string): ProjectRecord | undefined {
    return this.projects.get(projectId);
  }

  updateProject(projectId: string, patch: Partial<ProjectRecord>): ProjectRecord | undefined {
    const existing = this.projects.get(projectId);
    if (!existing) return undefined;

    const updated: ProjectRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      clientId: existing.clientId,
      ownerId: existing.ownerId,
      spentBudget: existing.spentBudget,
      updatedAt: this.nowIso(),
    };

    this.projects.set(projectId, updated);
    return updated;
  }

  archiveProject(projectId: string): ProjectRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    project.status = 'archived';
    project.archivedAt = this.nowIso();
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return project;
  }

  markAbandoned(projectId: string): ProjectRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    project.status = 'abandoned';
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return project;
  }

  applyScopeChange(projectId: string, additionalBudget: number): ProjectRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    project.budget = Number((project.budget + additionalBudget).toFixed(2));
    project.scopeChangeCount += 1;
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return project;
  }

  addMilestone(projectId: string, input: AddMilestoneInput): MilestoneRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const dependsOn = input.dependsOn ?? [];

    if (dependsOn.length > 0) {
      const existing = this.milestones.get(projectId) || [];
      const depsValid = dependsOn.every((depId) => existing.some((m) => m.id === depId));
      if (!depsValid) return undefined;

      const conflict = this.detectCircularDependency(projectId, dependsOn);
      if (conflict) return undefined;
    }

    const milestone: MilestoneRecord = {
      id: randomUUID(),
      title: input.title,
      deliverable: input.deliverable,
      amount: Number(input.amount.toFixed(2)),
      dueDate: input.dueDate,
      status: 'pending',
      submittedAt: null,
      approvedAt: null,
      submissionUrl: null,
      submissionNotes: null,
      disputeReason: null,
      createdAt: this.nowIso(),
      updatedAt: this.nowIso(),
      dependsOn,
    };

    const existing = this.milestones.get(projectId) || [];
    this.milestones.set(projectId, [...existing, milestone]);
    return milestone;
  }

  updateMilestoneDependencies(
    projectId: string,
    milestoneId: string,
    dependsOn: string[]
  ): MilestoneRecord | undefined {
    const existing = this.milestones.get(projectId);
    if (!existing) return undefined;

    const depsValid = dependsOn.length === 0 || dependsOn.every((depId) =>
      depId === milestoneId ? false : existing.some((m) => m.id === depId)
    );
    if (!depsValid) return undefined;

    const idx = existing.findIndex((m) => m.id === milestoneId);
    if (idx === -1) return undefined;

    const updated = { ...existing[idx], dependsOn, updatedAt: this.nowIso() };
    existing[idx] = updated;
    this.milestones.set(projectId, existing);
    return updated;
  }

  listMilestones(projectId: string): MilestoneRecord[] {
    return this.milestones.get(projectId) || [];
  }

  private findMilestone(projectId: string, milestoneId: string): MilestoneRecord | undefined {
    const milestones = this.milestones.get(projectId);
    if (!milestones) return undefined;
    return milestones.find((milestone) => milestone.id === milestoneId);
  }

  private getMilestoneDuration(milestone: MilestoneRecord): number {
    const created = new Date(milestone.createdAt).getTime();
    const due = new Date(milestone.dueDate).getTime();
    return Math.max(1, Math.ceil((due - created) / (1000 * 60 * 60 * 24)));
  }

  // ── Dependency Detection ──────────────────────────────────────────────────

  getDependencies(projectId: string): MilestoneDependency[] {
    const milestones = this.milestones.get(projectId) || [];
    const deps: MilestoneDependency[] = [];
    for (const m of milestones) {
      for (const depId of m.dependsOn) {
        const dep = milestones.find((d) => d.id === depId);
        if (dep) {
          deps.push({
            milestoneId: m.id,
            dependsOnMilestoneId: depId,
            dependencyTitle: dep.title,
            milestoneTitle: m.title,
          });
        }
      }
    }
    return deps;
  }

  detectCircularDependency(projectId: string, newDependsOn: string[]): DependencyConflict | null {
    const milestones = this.milestones.get(projectId) || [];
    const adj = new Map<string, string[]>();

    for (const m of milestones) {
      adj.set(m.id, [...m.dependsOn]);
    }

    for (const depId of newDependsOn) {
      adj.set('__new', [...(adj.get('__new') || []), depId]);
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    function dfs(node: string): string[] | null {
      visited.add(node);
      recStack.add(node);
      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          const result = dfs(neighbor);
          if (result) return result;
        } else if (recStack.has(neighbor)) {
          return [neighbor, node];
        }
      }
      recStack.delete(node);
      return null;
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        const result = dfs(node);
        if (result) return { type: 'circular_dependency', cycle: result, description: `Circular dependency detected: ${result.join(' -> ')}` };
      }
    }
    return null;
  }

  checkDependencyConflicts(projectId: string): DependencyConflict[] {
    const conflicts: DependencyConflict[] = [];
    const cyclic = this.detectAllCycles(projectId);
    conflicts.push(...cyclic);
    return conflicts;
  }

  private detectAllCycles(projectId: string): DependencyConflict[] {
    const milestones = this.milestones.get(projectId) || [];
    const adj = new Map<string, string[]>();
    for (const m of milestones) {
      adj.set(m.id, [...m.dependsOn]);
    }

    const conflicts: DependencyConflict[] = [];
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): void {
      visited.add(node);
      recStack.add(node);
      path.push(node);
      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (recStack.has(neighbor)) {
          const cycleStart = path.indexOf(neighbor);
          const cycle = path.slice(cycleStart);
          cycle.push(neighbor);
          const titleStr = cycle.map((id) => {
            const m = milestones.find((ms) => ms.id === id);
            return m ? m.title : id;
          }).join(' -> ');
          conflicts.push({
            type: 'circular_dependency',
            cycle: [...cycle],
            description: `Circular dependency: ${titleStr}`,
          });
        }
      }
      recStack.delete(node);
      path.pop();
    }

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
    return conflicts;
  }

  // ── Critical Path Analysis ────────────────────────────────────────────────

  computeCriticalPath(projectId: string): CriticalPathResult | null {
    const milestones = this.milestones.get(projectId);
    if (!milestones || milestones.length === 0) return null;

    const adj = new Map<string, string[]>();
    const revAdj = new Map<string, string[]>();
    const milestoneMap = new Map<string, MilestoneRecord>();

    for (const m of milestones) {
      milestoneMap.set(m.id, m);
      adj.set(m.id, []);
      revAdj.set(m.id, []);
    }

    for (const m of milestones) {
      for (const depId of m.dependsOn) {
        if (milestoneMap.has(depId)) {
          adj.get(depId)!.push(m.id);
          revAdj.get(m.id)!.push(depId);
        }
      }
    }

    const duration = new Map<string, number>();
    for (const m of milestones) {
      duration.set(m.id, this.getMilestoneDuration(m));
    }

    const earliestStart = new Map<string, number>();
    const earliestFinish = new Map<string, number>();

    const topoOrder: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    function topologicalSort(node: string, ms: Map<string, MilestoneRecord>): boolean {
      if (visiting.has(node)) return false;
      if (visited.has(node)) return true;
      visiting.add(node);
      const neighbors = adj.get(node) || [];
      for (const neighbor of neighbors) {
        if (!topologicalSort(neighbor, ms)) return false;
      }
      visiting.delete(node);
      visited.add(node);
      topoOrder.push(node);
      return true;
    }

    for (const m of milestones) {
      if (!visited.has(m.id)) {
        if (!topologicalSort(m.id, milestoneMap)) return null;
      }
    }
    topoOrder.reverse();

    for (const nodeId of topoOrder) {
      const predecessors = revAdj.get(nodeId) || [];
      let maxES = 0;
      for (const predId of predecessors) {
        const ef = earliestFinish.get(predId) || 0;
        if (ef > maxES) maxES = ef;
      }
      earliestStart.set(nodeId, maxES);
      earliestFinish.set(nodeId, maxES + (duration.get(nodeId) || 0));
    }

    const latestStart = new Map<string, number>();
    const latestFinish = new Map<string, number>();
    const projectEnd = Math.max(...Array.from(earliestFinish.values()));

    for (const nodeId of topoOrder.reverse()) {
      const successors = adj.get(nodeId) || [];
      if (successors.length === 0) {
        latestFinish.set(nodeId, projectEnd);
      } else {
        let minLS = Infinity;
        for (const succId of successors) {
          const ls = latestStart.get(succId) || 0;
          if (ls < minLS) minLS = ls;
        }
        latestFinish.set(nodeId, minLS);
      }
      const dur = duration.get(nodeId) || 0;
      latestStart.set(nodeId, (latestFinish.get(nodeId) || 0) - dur);
    }

    const nodes: CriticalPathNode[] = milestones.map((m) => {
      const es = earliestStart.get(m.id) || 0;
      const ef = earliestFinish.get(m.id) || 0;
      const ls = latestStart.get(m.id) || 0;
      const lf = latestFinish.get(m.id) || 0;
      const slack = ls - es;
      return {
        milestoneId: m.id,
        title: m.title,
        earliestStart: es,
        earliestFinish: ef,
        latestStart: ls,
        latestFinish: lf,
        slack,
        isCritical: slack <= 0,
      };
    });

    const criticalPath = nodes
      .filter((n) => n.isCritical)
      .sort((a, b) => a.earliestStart - b.earliestStart)
      .map((n) => n.milestoneId);

    return {
      nodes,
      criticalPath,
      totalDuration: projectEnd,
    };
  }

  // ── Gantt Data ────────────────────────────────────────────────────────────

  getGanttData(projectId: string): GanttItem[] {
    const milestones = this.milestones.get(projectId);
    if (!milestones) return [];

    const project = this.projects.get(projectId);
    const projectStart = project ? new Date(project.startDate).getTime() : Date.now();

    return milestones.map((m) => {
      const due = new Date(m.dueDate).getTime();
      const created = new Date(m.createdAt).getTime();
      const startDate = created < projectStart ? projectStart : created;
      const statusWeights: Record<MilestoneStatus, number> = {
        pending: 0,
        submitted: 50,
        approved: 75,
        released: 100,
        disputed: 25,
      };

      return {
        milestoneId: m.id,
        title: m.title,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(due).toISOString(),
        status: m.status,
        dependsOn: m.dependsOn,
        progress: statusWeights[m.status] ?? 0,
      };
    });
  }

  // ── Cascading Completion ──────────────────────────────────────────────────

  cascadeMilestoneCompletion(projectId: string, completedMilestoneId: string): MilestoneRecord[] {
    const milestones = this.milestones.get(projectId);
    if (!milestones) return [];

    const updated: MilestoneRecord[] = [];
    const completed = milestones.find((m) => m.id === completedMilestoneId);
    if (!completed) return [];

    for (const milestone of milestones) {
      if (milestone.dependsOn.includes(completedMilestoneId) && milestone.status === 'pending') {
        milestone.status = 'submitted';
        milestone.updatedAt = this.nowIso();
        updated.push(milestone);
      }
    }

    this.milestones.set(projectId, milestones);
    return updated;
  }

  // ── Deadline Alerts ───────────────────────────────────────────────────────

  getDeadlineAlerts(projectId?: string, ownerId?: string, thresholdDays: number = 7): Array<{
    milestone: MilestoneRecord;
    project: ProjectRecord;
    daysRemaining: number;
    alertType: 'approaching' | 'critical' | 'overdue';
  }> {
    const now = Date.now();
    const allIds = projectId ? [projectId] : [...this.projects.keys()];
    const projectIds = ownerId
      ? allIds.filter((pid) => {
          const p = this.projects.get(pid);
          return p && (p.ownerId === ownerId || p.clientId === ownerId);
        })
      : allIds;

    const alerts: Array<{
      milestone: MilestoneRecord;
      project: ProjectRecord;
      daysRemaining: number;
      alertType: 'approaching' | 'critical' | 'overdue';
    }> = [];

    for (const pid of projectIds) {
      const project = this.projects.get(pid);
      if (!project) continue;
      const milestones = this.milestones.get(pid) ?? [];
      for (const milestone of milestones) {
        if (milestone.status === 'released') continue;
        const due = new Date(milestone.dueDate).getTime();
        const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

        if (diffDays < 0) {
          alerts.push({ milestone, project, daysRemaining: diffDays, alertType: 'overdue' });
        } else if (diffDays <= 3) {
          alerts.push({ milestone, project, daysRemaining: diffDays, alertType: 'critical' });
        } else if (diffDays <= thresholdDays) {
          alerts.push({ milestone, project, daysRemaining: diffDays, alertType: 'approaching' });
        }
      }
    }

    return alerts.sort((a, b) => a.daysRemaining - b.daysRemaining);
  }

  // ── Existing Methods ──────────────────────────────────────────────────────

  submitDeliverable(projectId: string, milestoneId: string, submissionUrl: string, notes?: string): MilestoneRecord | undefined {
    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) return undefined;

    milestone.status = 'submitted';
    milestone.submittedAt = this.nowIso();
    milestone.submissionUrl = submissionUrl;
    milestone.submissionNotes = notes ?? null;
    milestone.updatedAt = this.nowIso();

    this.cascadeMilestoneCompletion(projectId, milestoneId);
    return milestone;
  }

  approveDeliverable(projectId: string, milestoneId: string, approvedBy: string): { milestone: MilestoneRecord; release: PaymentReleaseRecord } | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) return undefined;

    milestone.status = 'released';
    milestone.approvedAt = this.nowIso();
    milestone.updatedAt = this.nowIso();

    const release: PaymentReleaseRecord = {
      id: randomUUID(),
      projectId,
      milestoneId,
      amount: milestone.amount,
      currency: project.currency,
      releasedAt: this.nowIso(),
      releasedBy: approvedBy,
    };

    this.releases.push(release);
    project.spentBudget = Number((project.spentBudget + milestone.amount).toFixed(2));
    project.updatedAt = this.nowIso();

    this.cascadeMilestoneCompletion(projectId, milestoneId);

    const allMilestones = this.listMilestones(projectId);
    if (allMilestones.length > 0 && allMilestones.every((entry) => entry.status === 'released')) {
      project.status = 'completed';
    }

    this.projects.set(projectId, project);
    return { milestone, release };
  }

  disputeMilestone(projectId: string, milestoneId: string, reason: string): MilestoneRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) return undefined;

    milestone.status = 'disputed';
    milestone.disputeReason = reason;
    milestone.updatedAt = this.nowIso();

    project.status = 'disputed';
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return milestone;
  }

  getDashboard(projectId: string):
    | {
        project: ProjectRecord;
        milestones: MilestoneRecord[];
        releases: PaymentReleaseRecord[];
        progressPercent: number;
        timeline: Array<{ milestoneId: string; dueDate: string; status: MilestoneStatus }>;
        budgetUtilizationPercent: number;
      }
    | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    const milestones = this.listMilestones(projectId);
    const completedCount = milestones.filter((milestone) => milestone.status === 'released').length;
    const progressPercent = milestones.length === 0 ? 0 : Math.round((completedCount / milestones.length) * 100);
    const budgetUtilizationPercent = project.budget === 0 ? 0 : Number(((project.spentBudget / project.budget) * 100).toFixed(2));

    return {
      project,
      milestones,
      releases: this.releases.filter((release) => release.projectId === projectId),
      progressPercent,
      timeline: milestones.map((milestone) => ({
        milestoneId: milestone.id,
        dueDate: milestone.dueDate,
        status: milestone.status,
      })),
      budgetUtilizationPercent,
    };
  }

  getClientReviewPortal(clientId: string): Array<{ project: ProjectRecord; milestonesPendingReview: MilestoneRecord[] }> {
    const projects = this.listProjects({ clientId, includeArchived: true });
    return projects
      .map((project) => ({
        project,
        milestonesPendingReview: this.listMilestones(project.id).filter((milestone) => milestone.status === 'submitted'),
      }))
      .filter((entry) => entry.milestonesPendingReview.length > 0);
  }

  getReleases(projectId?: string): PaymentReleaseRecord[] {
    return projectId ? this.releases.filter((release) => release.projectId === projectId) : [...this.releases];
  }

  getOverdueMilestones(projectId?: string, ownerId?: string): Array<{
    milestone: MilestoneRecord;
    project: ProjectRecord;
    overdueDays: number;
  }> {
    const now = new Date();
    const allIds = projectId ? [projectId] : [...this.projects.keys()];
    const projectIds = ownerId
      ? allIds.filter((pid) => {
          const p = this.projects.get(pid);
          return p && (p.ownerId === ownerId || p.clientId === ownerId);
        })
      : allIds;

    const overdue: Array<{ milestone: MilestoneRecord; project: ProjectRecord; overdueDays: number }> = [];

    for (const pid of projectIds) {
      const project = this.projects.get(pid);
      if (!project) continue;
      const milestones = this.milestones.get(pid) ?? [];
      for (const milestone of milestones) {
        if (milestone.status === 'released') continue;
        const due = new Date(milestone.dueDate);
        if (due < now) {
          const overdueDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
          overdue.push({ milestone, project, overdueDays });
        }
      }
    }

    return overdue.sort((a, b) => b.overdueDays - a.overdueDays);
  }

  resetForTests(): void {
    this.projects.clear();
    this.milestones.clear();
    this.releases = [];
  }
}

export const projectsService = new ProjectsService();
