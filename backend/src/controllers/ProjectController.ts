/**
 * ProjectController.ts — Issue #366
 *
 * HTTP layer for projects - handles request/response only
 */

import { Request, Response, NextFunction } from "express";
import { BaseController } from "./BaseController.js";
import { ProjectService } from "../services/ProjectService.js";
import { buildPaginationMeta } from "../middleware/responseFormatter.js";

export class ProjectController extends BaseController {
  constructor(private projectService: ProjectService) {
    super();
  }

  createProject = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);

      this.validateRequired(req.body, [
        "freelancerId",
        "amount",
        "description",
        "githubRepo",
      ]);

      const project = await this.projectService.createProject({
        ...req.body,
        clientId: user.id,
        tenantId: user.tenantId,
      });

      res.status(201).apiSuccess(project, {
        message: "Project created successfully",
      });
    });
  };

  getProject = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      const project = await this.projectService.getProject(id, user.tenantId);

      res.apiSuccess(project);
    });
  };

  listProjects = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const pagination = this.getPaginationParams(req);

      const result = await this.projectService.listProjects(
        user.tenantId,
        pagination,
      );

      const paginationMeta = buildPaginationMeta(
        result.items,
        pagination.limit,
        result.hasMore,
      );

      res.apiPaginated(result.items, paginationMeta);
    });
  };

  listClientProjects = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { clientId } = req.params;
      const pagination = this.getPaginationParams(req);

      const result = await this.projectService.listClientProjects(
        clientId,
        user.tenantId,
        pagination,
      );

      const paginationMeta = buildPaginationMeta(
        result.items,
        pagination.limit,
        result.hasMore,
      );

      res.apiPaginated(result.items, paginationMeta);
    });
  };

  listFreelancerProjects = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { freelancerId } = req.params;
      const pagination = this.getPaginationParams(req);

      const result = await this.projectService.listFreelancerProjects(
        freelancerId,
        user.tenantId,
        pagination,
      );

      const paginationMeta = buildPaginationMeta(
        result.items,
        pagination.limit,
        result.hasMore,
      );

      res.apiPaginated(result.items, paginationMeta);
    });
  };

  updateProject = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      const project = await this.projectService.updateProject(
        id,
        req.body,
        user.tenantId,
      );

      res.apiSuccess(project, {
        message: "Project updated successfully",
      });
    });
  };

  fundProject = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      this.validateRequired(req.body, ["amount"]);

      const project = await this.projectService.fundProject(
        id,
        {
          amount: req.body.amount,
          clientId: user.id,
        },
        user.tenantId,
      );

      res.apiSuccess(project, {
        message: "Project funded successfully",
      });
    });
  };

  submitWork = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      this.validateRequired(req.body, ["githubRepo"]);

      const project = await this.projectService.submitWork(
        id,
        {
          githubRepo: req.body.githubRepo,
          freelancerId: user.id,
        },
        user.tenantId,
      );

      res.apiSuccess(project, {
        message: "Work submitted successfully",
      });
    });
  };

  approveWork = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      const project = await this.projectService.approveWork(
        id,
        user.id,
        user.tenantId,
      );

      res.apiSuccess(project, {
        message: "Work approved and payment released",
      });
    });
  };

  raiseDispute = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      const project = await this.projectService.raiseDispute(
        id,
        user.id,
        user.tenantId,
      );

      res.apiSuccess(project, {
        message: "Dispute raised successfully",
      });
    });
  };

  deleteProject = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await this.execute(req, res, next, async (req, res) => {
      const user = this.getUser(req);
      const { id } = req.params;

      await this.projectService.deleteProject(id, user.tenantId);

      res.status(204).send();
    });
  };
}
