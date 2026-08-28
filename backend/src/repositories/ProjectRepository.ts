/**
 * ProjectRepository.ts — Issue #366 / #716
 *
 * Data access layer for projects
 */

import {
  PaginationOptions,
  PaginatedResult,
} from "./BaseRepository.js";
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

  protected getSortTimestamp(entity: Project): number {
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

    return this.put(project);
  }

  async update(id: string, data: Partial<Project>): Promise<Project | null> {
    const project = this.store.get(id);
    if (!project) return null;

    return this.put({
      ...project,
      ...data,
      id: project.id, // Prevent ID change
      updatedAt: new Date().toISOString(),
    });
  }

  async findByClient(
    clientId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    return this.paginate(
      this.sortedValues().filter((p) => p.clientId === clientId),
      options,
    );
  }

  async findByFreelancer(
    freelancerId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    return this.paginate(
      this.sortedValues().filter((p) => p.freelancerId === freelancerId),
      options,
    );
  }

  async findByTenant(
    tenantId: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<Project>> {
    return this.paginate(
      this.sortedValues().filter((p) => p.tenantId === tenantId),
      options,
    );
  }
}
