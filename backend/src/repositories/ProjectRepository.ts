/**
 * ProjectRepository.ts — Issue #366
 *
 * Data access layer for projects
 */

import { PaginationOptions, PaginatedResult } from "./BaseRepository.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import type { Project as SharedProject } from "@agenticpay/types";

export interface Project extends Pick<SharedProject, "id" | "description" | "createdAt" | "updatedAt"> {
  id: string;
  clientId: string;
  freelancerId: string;
  amount: number;
  deposited: number;
  status:
    | "created"
    | "funded"
    | "in_progress"
    | "work_submitted"
    | "verified"
    | "completed"
    | "disputed"
    | "cancelled";
  githubRepo: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  deadline?: string;
  tenantId: string;
}

export class ProjectRepository extends InMemoryRepository<Project> {
  protected getId(entity: Project): string {
    return entity.id;
  }

  protected getSortValue(entity: Project): number {
    return new Date(entity.createdAt).getTime();
  }

  async create(data: Partial<Project>): Promise<Project> {
    const project: Project = {
      id:
        data.id ||
        `proj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      clientId: data.clientId!,
      freelancerId: data.freelancerId!,
      amount: data.amount || 0,
      deposited: 0,
      status: "created",
      githubRepo: data.githubRepo || "",
      description: data.description || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deadline: data.deadline,
      tenantId: data.tenantId!,
    };

    this.store.set(project.id, project);
    return project;
  }

  async update(id: string, data: Partial<Project>): Promise<Project | null> {
    const project = this.store.get(id);
    if (!project) return null;

    const updated: Project = {
      ...project,
      ...data,
      id: project.id, // Prevent ID change
      updatedAt: new Date().toISOString(),
    };

    this.store.set(id, updated);
    return updated;
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    if (!filters) {
      return this.store.size;
    }

    let filtered = Array.from(this.store.values());

    if (filters.tenantId) {
      filtered = filtered.filter((p) => p.tenantId === filters.tenantId);
    }
    if (filters.status) {
      filtered = filtered.filter((p) => p.status === filters.status);
    }
    if (filters.clientId) {
      filtered = filtered.filter((p) => p.clientId === filters.clientId);
    }

    return filtered.length;
  }

  async findByClient(
    clientId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    const clientProjects = Array.from(this.store.values())
      .filter((p) => p.clientId === clientId)
      .sort((a, b) => this.getSortValue(b) - this.getSortValue(a));

    return this.paginate(clientProjects, options);
  }

  async findByFreelancer(
    freelancerId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    const freelancerProjects = Array.from(this.store.values())
      .filter((p) => p.freelancerId === freelancerId)
      .sort((a, b) => this.getSortValue(b) - this.getSortValue(a));

    return this.paginate(freelancerProjects, options);
  }

  async findByTenant(
    tenantId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    const tenantProjects = Array.from(this.store.values())
      .filter((p) => p.tenantId === tenantId)
      .sort((a, b) => this.getSortValue(b) - this.getSortValue(a));

    return this.paginate(tenantProjects, options);
  }
}
