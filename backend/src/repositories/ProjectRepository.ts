/**
 * ProjectRepository.ts — Issue #366
 *
 * Data access layer for projects
 */

import {
  BaseRepository,
  PaginationOptions,
  PaginatedResult,
} from "./BaseRepository.js";

export interface Project {
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

export class ProjectRepository extends BaseRepository<Project> {
  private projects: Map<string, Project> = new Map();

  async findById(id: string): Promise<Project | null> {
    return this.projects.get(id) || null;
  }

  async findAll(options: PaginationOptions): Promise<PaginatedResult<Project>> {
    const allProjects = Array.from(this.projects.values()).sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = allProjects.findIndex((p) => p.id === options.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const items = allProjects.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < allProjects.length;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

    return { items, hasMore, nextCursor };
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

    this.projects.set(project.id, project);
    return project;
  }

  async update(id: string, data: Partial<Project>): Promise<Project | null> {
    const project = this.projects.get(id);
    if (!project) return null;

    const updated: Project = {
      ...project,
      ...data,
      id: project.id, // Prevent ID change
      updatedAt: new Date().toISOString(),
    };

    this.projects.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    return this.projects.delete(id);
  }

  async count(filters?: Record<string, unknown>): Promise<number> {
    if (!filters) {
      return this.projects.size;
    }

    let filtered = Array.from(this.projects.values());

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
    const clientProjects = Array.from(this.projects.values())
      .filter((p) => p.clientId === clientId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = clientProjects.findIndex(
        (p) => p.id === options.cursor,
      );
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const items = clientProjects.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < clientProjects.length;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

    return { items, hasMore, nextCursor };
  }

  async findByFreelancer(
    freelancerId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    const freelancerProjects = Array.from(this.projects.values())
      .filter((p) => p.freelancerId === freelancerId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = freelancerProjects.findIndex(
        (p) => p.id === options.cursor,
      );
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const items = freelancerProjects.slice(
      startIndex,
      startIndex + options.limit,
    );
    const hasMore = startIndex + options.limit < freelancerProjects.length;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

    return { items, hasMore, nextCursor };
  }

  async findByTenant(
    tenantId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    const tenantProjects = Array.from(this.projects.values())
      .filter((p) => p.tenantId === tenantId)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

    let startIndex = 0;
    if (options.cursor) {
      const cursorIndex = tenantProjects.findIndex(
        (p) => p.id === options.cursor,
      );
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const items = tenantProjects.slice(startIndex, startIndex + options.limit);
    const hasMore = startIndex + options.limit < tenantProjects.length;
    const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

    return { items, hasMore, nextCursor };
  }
}
