/**
 * ProjectService.ts — Issue #366/#374
 *
 * Business logic layer for projects. Expected business-rule failures are
 * returned as Result errors; exceptions are reserved for unexpected runtime
 * failures from infrastructure dependencies.
 */

import { BaseService } from "./BaseService.js";
import {
  ProjectRepository,
  Project,
} from "../repositories/ProjectRepository.js";
import { PaginationOptions, PaginatedResult } from "../repositories/BaseRepository.js";
import { Result } from "../lib/result.js";

export interface CreateProjectDTO {
  clientId: string;
  freelancerId: string;
  amount: number;
  description: string;
  githubRepo: string;
  deadline?: string;
  tenantId: string;
}

export interface UpdateProjectDTO {
  amount?: number;
  description?: string;
  githubRepo?: string;
  deadline?: string;
  status?: Project["status"];
}

export interface FundProjectDTO {
  amount: number;
  clientId: string;
}

export interface SubmitWorkDTO {
  githubRepo: string;
  freelancerId: string;
}

export class ProjectService extends BaseService {
  constructor(private projectRepository: ProjectRepository) {
    super();
  }

  async createProject(data: CreateProjectDTO): Promise<Result<Project>> {
    if (data.amount <= 0) {
      return this.validationFailure("Project amount must be positive");
    }
    if (data.clientId === data.freelancerId) {
      return this.validationFailure("Client and freelancer must be different");
    }
    if (data.deadline && new Date(data.deadline) <= new Date()) {
      return this.validationFailure("Deadline must be in the future");
    }

    return this.ok(await this.projectRepository.create(data));
  }

  async getProject(id: string, tenantId: string): Promise<Result<Project>> {
    const project = await this.projectRepository.findById(id);

    if (!project) {
      return this.notFoundFailure("Project", id);
    }

    if (project.tenantId !== tenantId) {
      return this.forbiddenFailure("Access denied to this project");
    }

    return this.ok(project);
  }

  async listProjects(
    tenantId: string,
    options: PaginationOptions,
  ): Promise<Result<PaginatedResult<Project>>> {
    return this.ok(await this.projectRepository.findByTenant(tenantId, options));
  }

  async listClientProjects(
    clientId: string,
    _tenantId: string,
    options: PaginationOptions,
  ): Promise<Result<PaginatedResult<Project>>> {
    // Tenant membership validation belongs in the user/tenant repository once wired.
    return this.ok(await this.projectRepository.findByClient(clientId, options));
  }

  async listFreelancerProjects(
    freelancerId: string,
    _tenantId: string,
    options: PaginationOptions,
  ): Promise<Result<PaginatedResult<Project>>> {
    return this.ok(await this.projectRepository.findByFreelancer(freelancerId, options));
  }

  async updateProject(
    id: string,
    data: UpdateProjectDTO,
    tenantId: string,
  ): Promise<Result<Project>> {
    const projectResult = await this.getProject(id, tenantId);
    if (!projectResult.ok) return projectResult;

    if (data.status) {
      const transition = this.validateStatusTransition(projectResult.value.status, data.status);
      if (!transition.ok) return transition;
    }

    if (data.amount !== undefined && data.amount <= 0) {
      return this.validationFailure("Project amount must be positive");
    }

    const updated = await this.projectRepository.update(id, data);
    return updated ? this.ok(updated) : this.notFoundFailure("Project", id);
  }

  async fundProject(
    id: string,
    data: FundProjectDTO,
    tenantId: string,
  ): Promise<Result<Project>> {
    const projectResult = await this.getProject(id, tenantId);
    if (!projectResult.ok) return projectResult;
    const project = projectResult.value;

    if (project.clientId !== data.clientId) {
      return this.validationFailure("Only project client can fund");
    }
    if (project.status !== "created") {
      return this.validationFailure("Project must be in created status");
    }
    if (data.amount <= 0) {
      return this.validationFailure("Funding amount must be positive");
    }

    const newDeposited = project.deposited + data.amount;
    const newStatus = newDeposited >= project.amount ? "funded" : "created";
    const updated = await this.projectRepository.update(id, {
      deposited: newDeposited,
      status: newStatus,
    });

    return updated ? this.ok(updated) : this.notFoundFailure("Project", id);
  }

  async submitWork(
    id: string,
    data: SubmitWorkDTO,
    tenantId: string,
  ): Promise<Result<Project>> {
    const projectResult = await this.getProject(id, tenantId);
    if (!projectResult.ok) return projectResult;
    const project = projectResult.value;

    if (project.freelancerId !== data.freelancerId) {
      return this.validationFailure("Only assigned freelancer can submit work");
    }
    if (project.status !== "funded" && project.status !== "in_progress") {
      return this.validationFailure("Project must be funded or in progress");
    }

    const updated = await this.projectRepository.update(id, {
      githubRepo: data.githubRepo,
      status: "work_submitted",
    });

    return updated ? this.ok(updated) : this.notFoundFailure("Project", id);
  }

  async approveWork(
    id: string,
    clientId: string,
    tenantId: string,
  ): Promise<Result<Project>> {
    const projectResult = await this.getProject(id, tenantId);
    if (!projectResult.ok) return projectResult;
    const project = projectResult.value;

    if (project.clientId !== clientId) {
      return this.validationFailure("Only project client can approve");
    }
    if (project.status !== "work_submitted" && project.status !== "verified") {
      return this.validationFailure("Work must be submitted or verified");
    }

    const updated = await this.projectRepository.update(id, {
      status: "completed",
      deposited: 0,
    });

    return updated ? this.ok(updated) : this.notFoundFailure("Project", id);
  }

  async raiseDispute(
    id: string,
    userId: string,
    tenantId: string,
  ): Promise<Result<Project>> {
    const projectResult = await this.getProject(id, tenantId);
    if (!projectResult.ok) return projectResult;
    const project = projectResult.value;

    if (project.clientId !== userId && project.freelancerId !== userId) {
      return this.validationFailure("Only client or freelancer can raise dispute");
    }

    const updated = await this.projectRepository.update(id, {
      status: "disputed",
    });

    return updated ? this.ok(updated) : this.notFoundFailure("Project", id);
  }

  async deleteProject(id: string, tenantId: string): Promise<Result<void>> {
    const projectResult = await this.getProject(id, tenantId);
    if (!projectResult.ok) return projectResult;
    const project = projectResult.value;

    if (project.status !== "created" || project.deposited !== 0) {
      return this.validationFailure("Can only delete unfunded projects");
    }

    const deleted = await this.projectRepository.delete(id);
    return deleted ? this.ok(undefined) : this.notFoundFailure("Project", id);
  }

  private validateStatusTransition(
    from: Project["status"],
    to: Project["status"],
  ): Result<void> {
    const validTransitions: Record<Project["status"], Project["status"][]> = {
      created: ["funded", "cancelled"],
      funded: ["in_progress", "cancelled"],
      in_progress: ["work_submitted", "disputed", "cancelled"],
      work_submitted: ["verified", "in_progress", "disputed"],
      verified: ["completed", "disputed"],
      completed: [],
      disputed: ["completed", "cancelled"],
      cancelled: [],
    };

    const allowed = validTransitions[from] || [];
    return allowed.includes(to)
      ? this.ok(undefined)
      : this.validationFailure(`Invalid status transition from ${from} to ${to}`);
  }
}
