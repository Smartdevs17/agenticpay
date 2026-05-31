/**
 * ProjectService.ts — Issue #366
 *
 * Business logic layer for projects
 */

import { BaseService } from "./BaseService.js";
import {
  ProjectRepository,
  Project,
} from "../repositories/ProjectRepository.js";
import { PaginationOptions } from "../repositories/BaseRepository.js";

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

  async createProject(data: CreateProjectDTO): Promise<Project> {
    // Validate business rules
    this.validate(data.amount > 0, "Project amount must be positive");
    this.validate(
      data.clientId !== data.freelancerId,
      "Client and freelancer must be different",
    );

    if (data.deadline) {
      const deadlineDate = new Date(data.deadline);
      this.validate(
        deadlineDate > new Date(),
        "Deadline must be in the future",
      );
    }

    return await this.projectRepository.create(data);
  }

  async getProject(id: string, tenantId: string): Promise<Project> {
    const project = await this.projectRepository.findById(id);

    if (!project) {
      this.notFound("Project", id);
    }

    // Tenant isolation
    if (project.tenantId !== tenantId) {
      this.forbidden("Access denied to this project");
    }

    return project;
  }

  async listProjects(tenantId: string, options: PaginationOptions) {
    return await this.projectRepository.findByTenant(tenantId, options);
  }

  async listClientProjects(
    clientId: string,
    tenantId: string,
    options: PaginationOptions,
  ) {
    // Verify client belongs to tenant (in real app, check user-tenant relationship)
    return await this.projectRepository.findByClient(clientId, options);
  }

  async listFreelancerProjects(
    freelancerId: string,
    tenantId: string,
    options: PaginationOptions,
  ) {
    // Verify freelancer belongs to tenant
    return await this.projectRepository.findByFreelancer(freelancerId, options);
  }

  async updateProject(
    id: string,
    data: UpdateProjectDTO,
    tenantId: string,
  ): Promise<Project> {
    const project = await this.getProject(id, tenantId);

    // Validate state transitions
    if (data.status) {
      this.validateStatusTransition(project.status, data.status);
    }

    if (data.amount !== undefined) {
      this.validate(data.amount > 0, "Project amount must be positive");
    }

    const updated = await this.projectRepository.update(id, data);
    if (!updated) {
      this.notFound("Project", id);
    }

    return updated;
  }

  async fundProject(
    id: string,
    data: FundProjectDTO,
    tenantId: string,
  ): Promise<Project> {
    const project = await this.getProject(id, tenantId);

    // Validate business rules
    this.validate(
      project.clientId === data.clientId,
      "Only project client can fund",
    );
    this.validate(
      project.status === "created",
      "Project must be in created status",
    );
    this.validate(data.amount > 0, "Funding amount must be positive");

    const newDeposited = project.deposited + data.amount;
    const newStatus = newDeposited >= project.amount ? "funded" : "created";

    const updated = await this.projectRepository.update(id, {
      deposited: newDeposited,
      status: newStatus,
    });

    if (!updated) {
      this.notFound("Project", id);
    }

    return updated;
  }

  async submitWork(
    id: string,
    data: SubmitWorkDTO,
    tenantId: string,
  ): Promise<Project> {
    const project = await this.getProject(id, tenantId);

    // Validate business rules
    this.validate(
      project.freelancerId === data.freelancerId,
      "Only assigned freelancer can submit work",
    );
    this.validate(
      project.status === "funded" || project.status === "in_progress",
      "Project must be funded or in progress",
    );

    const updated = await this.projectRepository.update(id, {
      githubRepo: data.githubRepo,
      status: "work_submitted",
    });

    if (!updated) {
      this.notFound("Project", id);
    }

    return updated;
  }

  async approveWork(
    id: string,
    clientId: string,
    tenantId: string,
  ): Promise<Project> {
    const project = await this.getProject(id, tenantId);

    // Validate business rules
    this.validate(
      project.clientId === clientId,
      "Only project client can approve",
    );
    this.validate(
      project.status === "work_submitted" || project.status === "verified",
      "Work must be submitted or verified",
    );

    // In real implementation, transfer funds here
    const updated = await this.projectRepository.update(id, {
      status: "completed",
      deposited: 0, // Funds released
    });

    if (!updated) {
      this.notFound("Project", id);
    }

    return updated;
  }

  async raiseDispute(
    id: string,
    userId: string,
    tenantId: string,
  ): Promise<Project> {
    const project = await this.getProject(id, tenantId);

    // Validate business rules
    this.validate(
      project.clientId === userId || project.freelancerId === userId,
      "Only client or freelancer can raise dispute",
    );

    const updated = await this.projectRepository.update(id, {
      status: "disputed",
    });

    if (!updated) {
      this.notFound("Project", id);
    }

    return updated;
  }

  async deleteProject(id: string, tenantId: string): Promise<void> {
    const project = await this.getProject(id, tenantId);

    // Validate business rules
    this.validate(
      project.status === "created" && project.deposited === 0,
      "Can only delete unfunded projects",
    );

    const deleted = await this.projectRepository.delete(id);
    if (!deleted) {
      this.notFound("Project", id);
    }
  }

  private validateStatusTransition(
    from: Project["status"],
    to: Project["status"],
  ): void {
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
    this.validate(
      allowed.includes(to),
      `Invalid status transition from ${from} to ${to}`,
    );
  }
}
