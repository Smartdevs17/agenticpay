import { randomUUID } from 'node:crypto';

export type MilestoneDependencyStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'overdue';

export interface MilestoneDependency {
  id: string;
  projectId: string;
  milestoneId: string;
  dependsOnMilestoneId: string;
  status: MilestoneDependencyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MilestoneDependencyGraph {
  projectId: string;
  nodes: Array<{
    id: string;
    title: string;
    status: string;
    dueDate: string;
    blockedBy: string[];
  }>;
  edges: Array<{
    from: string;
    to: string;
  }>;
  criticalPath: string[];
}

type CreateDependencyInput = {
  milestoneId: string;
  dependsOnMilestoneId: string;
};

const dependencies = new Map<string, MilestoneDependency>();

export class MilestoneDependencyService {
  private nowIso(): string {
    return new Date().toISOString();
  }

  addDependency(projectId: string, input: CreateDependencyInput): MilestoneDependency | { error: string } {
    if (input.milestoneId === input.dependsOnMilestoneId) {
      return { error: 'A milestone cannot depend on itself' };
    }

    const existing = this.getDependenciesForMilestone(projectId, input.milestoneId);
    if (existing.some((d) => d.dependsOnMilestoneId === input.dependsOnMilestoneId)) {
      return { error: 'This dependency already exists' };
    }

    if (this.wouldCreateCycle(projectId, input.milestoneId, input.dependsOnMilestoneId)) {
      return { error: 'Adding this dependency would create a circular dependency' };
    }

    const now = this.nowIso();
    const dependency: MilestoneDependency = {
      id: randomUUID(),
      projectId,
      milestoneId: input.milestoneId,
      dependsOnMilestoneId: input.dependsOnMilestoneId,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    dependencies.set(dependency.id, dependency);
    return dependency;
  }

  removeDependency(dependencyId: string): boolean {
    return dependencies.delete(dependencyId);
  }

  getDependenciesForMilestone(projectId: string, milestoneId: string): MilestoneDependency[] {
    return [...dependencies.values()].filter(
      (d) => d.projectId === projectId && d.milestoneId === milestoneId
    );
  }

  getDependents(projectId: string, milestoneId: string): MilestoneDependency[] {
    return [...dependencies.values()].filter(
      (d) => d.projectId === projectId && d.dependsOnMilestoneId === milestoneId
    );
  }

  getBlockedMilestones(projectId: string): string[] {
    const allDeps = [...dependencies.values()].filter((d) => d.projectId === projectId);
    const completedMilestones = new Set(
      allDeps.filter((d) => d.status === 'completed').map((d) => d.dependsOnMilestoneId)
    );

    return allDeps
      .filter((d) => !completedMilestones.has(d.dependsOnMilestoneId) && d.status !== 'completed')
      .map((d) => d.milestoneId);
  }

  markDependencyComplete(projectId: string, milestoneId: string): MilestoneDependency[] {
    const updated: MilestoneDependency[] = [];
    for (const dep of dependencies.values()) {
      if (dep.projectId === projectId && dep.dependsOnMilestoneId === milestoneId && dep.status !== 'completed') {
        dep.status = 'completed';
        dep.updatedAt = this.nowIso();
        updated.push(dep);
      }
    }
    return updated;
  }

  buildDependencyGraph(projectId: string, milestones: Array<{ id: string; title: string; status: string; dueDate: string }>): MilestoneDependencyGraph {
    const projectDeps = [...dependencies.values()].filter((d) => d.projectId === projectId);

    const blockedByMap = new Map<string, string[]>();
    for (const dep of projectDeps) {
      const list = blockedByMap.get(dep.milestoneId) || [];
      list.push(dep.dependsOnMilestoneId);
      blockedByMap.set(dep.milestoneId, list);
    }

    const nodes = milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      dueDate: m.dueDate,
      blockedBy: blockedByMap.get(m.id) || [],
    }));

    const edges = projectDeps.map((d) => ({
      from: d.dependsOnMilestoneId,
      to: d.milestoneId,
    }));

    const criticalPath = this.calculateCriticalPath(milestones, projectDeps);

    return { projectId, nodes, edges, criticalPath };
  }

  wouldCreateCycle(projectId: string, milestoneId: string, newDependencyId: string): boolean {
    const visited = new Set<string>();
    const stack = [newDependencyId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === milestoneId) return true;
      if (visited.has(current)) continue;
      visited.add(current);

      const deps = this.getDependents(projectId, current);
      for (const dep of deps) {
        stack.push(dep.milestoneId);
      }
    }

    return false;
  }

  private calculateCriticalPath(
    milestones: Array<{ id: string; dueDate: string }>,
    deps: MilestoneDependency[]
  ): string[] {
    if (milestones.length === 0) return [];

    const sortedByDate = [...milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return sortedByDate.map((m) => m.id);
  }

  deleteDependency(dependencyId: string): boolean {
    return dependencies.delete(dependencyId);
  }

  getAllDependencies(projectId: string): MilestoneDependency[] {
    return [...dependencies.values()].filter((d) => d.projectId === projectId);
  }
}

export const milestoneDependencyService = new MilestoneDependencyService();
