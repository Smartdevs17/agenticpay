/**
 * ProjectController.test.ts — Tests for Issue #366
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Request, Response, NextFunction } from "express";
import { ProjectController } from "../ProjectController.js";
import { ProjectService } from "../../services/ProjectService.js";
import { ProjectRepository } from "../../repositories/ProjectRepository.js";

describe("ProjectController", () => {
  let controller: ProjectController;
  let service: ProjectService;
  let repository: ProjectRepository;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    repository = new ProjectRepository();
    service = new ProjectService(repository);
    controller = new ProjectController(service);

    req = {
      params: {},
      query: {},
      body: {},
      user: {
        id: "user1",
        tenantId: "tenant1",
        role: "admin",
      },
    } as Partial<Request>;

    res = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
      apiSuccess: vi.fn().mockReturnThis(),
      apiPaginated: vi.fn().mockReturnThis(),
    };

    next = vi.fn();
  });

  describe("createProject", () => {
    it("should create a project successfully", async () => {
      req.body = {
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test project",
        githubRepo: "https://github.com/test/repo",
      };

      await controller.createProject(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.apiSuccess).toHaveBeenCalled();
    });

    it("should validate required fields", async () => {
      req.body = {
        amount: 1000,
      };

      await controller.createProject(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("getProject", () => {
    it("should get a project by ID", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      req.params = { id: project.id };

      await controller.getProject(req as Request, res as Response, next);

      expect(res.apiSuccess).toHaveBeenCalled();
    });

    it("should handle not found", async () => {
      req.params = { id: "nonexistent" };

      await controller.getProject(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("listProjects", () => {
    it("should list projects with pagination", async () => {
      await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test 1",
        githubRepo: "https://github.com/test/repo1",
        tenantId: "tenant1",
      });

      await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer2",
        amount: 2000,
        description: "Test 2",
        githubRepo: "https://github.com/test/repo2",
        tenantId: "tenant1",
      });

      req.query = { limit: "10" };

      await controller.listProjects(req as Request, res as Response, next);

      expect(res.apiPaginated).toHaveBeenCalled();
    });
  });

  describe("updateProject", () => {
    it("should update a project", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      req.params = { id: project.id };
      req.body = { description: "Updated description" };

      await controller.updateProject(req as Request, res as Response, next);

      expect(res.apiSuccess).toHaveBeenCalled();
    });
  });

  describe("fundProject", () => {
    it("should fund a project", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      req.params = { id: project.id };
      req.body = { amount: 1000 };

      await controller.fundProject(req as Request, res as Response, next);

      expect(res.apiSuccess).toHaveBeenCalled();
    });

    it("should validate amount", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      req.params = { id: project.id };
      req.body = {};

      await controller.fundProject(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("submitWork", () => {
    it("should submit work", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      await service.fundProject(
        project.id,
        { amount: 1000, clientId: "user1" },
        "tenant1",
      );

      req.user = {
        id: "freelancer1",
        tenantId: "tenant1",
        role: "operator",
      };
      req.params = { id: project.id };
      req.body = { githubRepo: "https://github.com/test/completed" };

      await controller.submitWork(req as Request, res as Response, next);

      expect(res.apiSuccess).toHaveBeenCalled();
    });
  });

  describe("approveWork", () => {
    it("should approve work and release payment", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      await service.fundProject(
        project.id,
        { amount: 1000, clientId: "user1" },
        "tenant1",
      );

      await service.submitWork(
        project.id,
        {
          githubRepo: "https://github.com/test/completed",
          freelancerId: "freelancer1",
        },
        "tenant1",
      );

      req.params = { id: project.id };

      await controller.approveWork(req as Request, res as Response, next);

      expect(res.apiSuccess).toHaveBeenCalled();
    });
  });

  describe("raiseDispute", () => {
    it("should raise a dispute", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      await service.fundProject(
        project.id,
        { amount: 1000, clientId: "user1" },
        "tenant1",
      );

      req.params = { id: project.id };

      await controller.raiseDispute(req as Request, res as Response, next);

      expect(res.apiSuccess).toHaveBeenCalled();
    });
  });

  describe("deleteProject", () => {
    it("should delete an unfunded project", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      req.params = { id: project.id };

      await controller.deleteProject(req as Request, res as Response, next);

      expect(res.status).toHaveBeenCalledWith(204);
    });

    it("should not delete funded project", async () => {
      const project = await service.createProject({
        clientId: "user1",
        freelancerId: "freelancer1",
        amount: 1000,
        description: "Test",
        githubRepo: "https://github.com/test/repo",
        tenantId: "tenant1",
      });

      await service.fundProject(
        project.id,
        { amount: 1000, clientId: "user1" },
        "tenant1",
      );

      req.params = { id: project.id };

      await controller.deleteProject(req as Request, res as Response, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
