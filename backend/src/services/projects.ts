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
        if (filters?.clientId && project.clientId !== filters.clientId) {
          return false;
        }
        if (filters?.ownerId && project.ownerId !== filters.ownerId) {
          return false;
        }
        if (!filters?.includeArchived && project.status === 'archived') {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getProject(projectId: string): ProjectRecord | undefined {
    return this.projects.get(projectId);
  }

  updateProject(projectId: string, patch: Partial<ProjectRecord>): ProjectRecord | undefined {
    const existing = this.projects.get(projectId);
    if (!existing) {
      return undefined;
    }

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
    if (!project) {
      return undefined;
    }

    project.status = 'archived';
    project.archivedAt = this.nowIso();
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return project;
  }

  markAbandoned(projectId: string): ProjectRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) {
      return undefined;
    }

    project.status = 'abandoned';
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return project;
  }

  applyScopeChange(projectId: string, additionalBudget: number): ProjectRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) {
      return undefined;
    }

    project.budget = Number((project.budget + additionalBudget).toFixed(2));
    project.scopeChangeCount += 1;
    project.updatedAt = this.nowIso();
    this.projects.set(projectId, project);
    return project;
  }

  addMilestone(projectId: string, input: AddMilestoneInput): MilestoneRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) {
      return undefined;
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
    };

    const existing = this.milestones.get(projectId) || [];
    this.milestones.set(projectId, [...existing, milestone]);
    return milestone;
  }

  listMilestones(projectId: string): MilestoneRecord[] {
    return this.milestones.get(projectId) || [];
  }

  private findMilestone(projectId: string, milestoneId: string): MilestoneRecord | undefined {
    const milestones = this.milestones.get(projectId);
    if (!milestones) {
      return undefined;
    }
    return milestones.find((milestone) => milestone.id === milestoneId);
  }

  submitDeliverable(projectId: string, milestoneId: string, submissionUrl: string, notes?: string): MilestoneRecord | undefined {
    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) {
      return undefined;
    }

    milestone.status = 'submitted';
    milestone.submittedAt = this.nowIso();
    milestone.submissionUrl = submissionUrl;
    milestone.submissionNotes = notes ?? null;
    milestone.updatedAt = this.nowIso();
    return milestone;
  }

  approveDeliverable(projectId: string, milestoneId: string, approvedBy: string): { milestone: MilestoneRecord; release: PaymentReleaseRecord } | undefined {
    const project = this.projects.get(projectId);
    if (!project) {
      return undefined;
    }

    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) {
      return undefined;
    }

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

    const allMilestones = this.listMilestones(projectId);
    if (allMilestones.length > 0 && allMilestones.every((entry) => entry.status === 'released')) {
      project.status = 'completed';
    }

    this.projects.set(projectId, project);
    return { milestone, release };
  }

  disputeMilestone(projectId: string, milestoneId: string, reason: string): MilestoneRecord | undefined {
    const project = this.projects.get(projectId);
    if (!project) {
      return undefined;
    }

    const milestone = this.findMilestone(projectId, milestoneId);
    if (!milestone) {
      return undefined;
    }

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
    if (!project) {
      return undefined;
    }

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

  resetForTests(): void {
    this.projects.clear();
    this.milestones.clear();
    this.releases = [];
  }
}

export const projectsService = new ProjectsService();