/**
 * ProjectController.ts — Issue #366/#374
 *
 * HTTP layer for projects - handles request/response only and maps explicit
 * Result service failures to stable HTTP envelopes.
 */

import { Request, Response, NextFunction } from "express";
import { BaseController } from "./BaseController.js";
import { ProjectService } from "../services/ProjectService.js";
import { buildPaginationMeta } from "../middleware/responseFormatter.js";

export class ProjectController extends BaseController {
  constructor(private projectService: ProjectService) {
    super();
  }

  createProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      this.validateRequired(req.body, ["freelancerId", "amount", "description", "githubRepo"]);

      const result = await this.projectService.createProject({
        ...req.body,
        clientId: user.id,
        tenantId: user.tenantId,
      });

      this.sendResult(res, result, (project) => {
        res.status(201).apiSuccess(project, { message: "Project created successfully" });
      });
    });
  };

  getProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const result = await this.projectService.getProject(req.params.id, user.tenantId);
      this.sendResult(res, result, (project) => res.apiSuccess(project));
    });
  };

  listProjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const pagination = this.getPaginationParams(req);
      const result = await this.projectService.listProjects(user.tenantId, pagination);

      this.sendResult(res, result, (projects) => {
        res.apiPaginated(
          projects.items,
          buildPaginationMeta(projects.items, pagination.limit, projects.hasMore),
        );
      });
    });
  };

  listClientProjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const pagination = this.getPaginationParams(req);
      const result = await this.projectService.listClientProjects(
        req.params.clientId,
        user.tenantId,
        pagination,
      );

      this.sendResult(res, result, (projects) => {
        res.apiPaginated(
          projects.items,
          buildPaginationMeta(projects.items, pagination.limit, projects.hasMore),
        );
      });
    });
  };

  listFreelancerProjects = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const pagination = this.getPaginationParams(req);
      const result = await this.projectService.listFreelancerProjects(
        req.params.freelancerId,
        user.tenantId,
        pagination,
      );

      this.sendResult(res, result, (projects) => {
        res.apiPaginated(
          projects.items,
          buildPaginationMeta(projects.items, pagination.limit, projects.hasMore),
        );
      });
    });
  };

  updateProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const result = await this.projectService.updateProject(req.params.id, req.body, user.tenantId);
      this.sendResult(res, result, (project) => {
        res.apiSuccess(project, { message: "Project updated successfully" });
      });
    });
  };

  fundProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      this.validateRequired(req.body, ["amount"]);

      const result = await this.projectService.fundProject(
        req.params.id,
        { amount: req.body.amount, clientId: user.id },
        user.tenantId,
      );

      this.sendResult(res, result, (project) => {
        res.apiSuccess(project, { message: "Project funded successfully" });
      });
    });
  };

  submitWork = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      this.validateRequired(req.body, ["githubRepo"]);

      const result = await this.projectService.submitWork(
        req.params.id,
        { githubRepo: req.body.githubRepo, freelancerId: user.id },
        user.tenantId,
      );

      this.sendResult(res, result, (project) => {
        res.apiSuccess(project, { message: "Work submitted successfully" });
      });
    });
  };

  approveWork = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const result = await this.projectService.approveWork(req.params.id, user.id, user.tenantId);
      this.sendResult(res, result, (project) => {
        res.apiSuccess(project, { message: "Work approved and payment released" });
      });
    });
  };

  raiseDispute = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const result = await this.projectService.raiseDispute(req.params.id, user.id, user.tenantId);
      this.sendResult(res, result, (project) => {
        res.apiSuccess(project, { message: "Dispute raised successfully" });
      });
    });
  };

  deleteProject = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const result = await this.projectService.deleteProject(req.params.id, user.tenantId);
      this.sendResult(res, result, () => res.status(204).send());
    });
  };
}
