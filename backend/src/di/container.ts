/**
 * container.ts — Issue #366
 *
 * Dependency injection container for managing service instances
 * Prevents circular dependencies and enables testability
 */

import { ProjectRepository } from "../repositories/ProjectRepository.js";
import { ProjectService } from "../services/ProjectService.js";
import { ProjectController } from "../controllers/ProjectController.js";
import { providerRegistry } from "../services/payments/provider-registry.js";
import { SorobanPaymentProvider } from "../services/payments/providers/soroban.js";
import { EvmPaymentProvider } from "../services/payments/providers/evm.js";
import { FiatPaymentProvider } from "../services/payments/providers/fiat.js";
import { CreditPaymentProvider } from "../services/payments/providers/credit.js";

export class DIContainer {
  private static instance: DIContainer;
  private services: Map<string, unknown> = new Map();

  private constructor() {
    this.registerServices();
  }

  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  private registerServices(): void {
    // Repositories
    const projectRepository = new ProjectRepository();
    this.services.set("ProjectRepository", projectRepository);

    // Services
    const projectService = new ProjectService(projectRepository);
    this.services.set("ProjectService", projectService);

    // Controllers
    const projectController = new ProjectController(projectService);
    this.services.set("ProjectController", projectController);

    // Payment providers (#480)
    providerRegistry.register(new SorobanPaymentProvider());
    providerRegistry.register(new EvmPaymentProvider());
    providerRegistry.register(new FiatPaymentProvider());
    providerRegistry.register(new CreditPaymentProvider());
    this.services.set("PaymentProviderRegistry", providerRegistry);
  }

  get<T>(serviceName: string): T {
    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service not found: ${serviceName}`);
    }
    return service as T;
  }

  set(serviceName: string, service: unknown): void {
    this.services.set(serviceName, service);
  }

  has(serviceName: string): boolean {
    return this.services.has(serviceName);
  }

  // Convenience getters
  getProjectController(): ProjectController {
    return this.get<ProjectController>("ProjectController");
  }

  getProjectService(): ProjectService {
    return this.get<ProjectService>("ProjectService");
  }

  getProjectRepository(): ProjectRepository {
    return this.get<ProjectRepository>("ProjectRepository");
  }
}

export const container = DIContainer.getInstance();
