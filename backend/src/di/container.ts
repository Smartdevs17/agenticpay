/**
 * DI Container — Issue #485
 *
 * Lightweight dependency injection container with:
 * - Lifecycle management: singleton, transient, scoped
 * - Per-domain module registration
 * - Startup validation (detects missing registrations)
 * - Mock injection for tests
 * - <1ms resolution overhead
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
  private registry = new Map<string, Registration>();

  // Private in production; exposed via createFresh() for test isolation
  constructor() {}

  static getInstance(): DIContainer {
    if (!DIContainer.instance) {
      DIContainer.instance = new DIContainer();
    }
    return DIContainer.instance;
  }

  /** Create an isolated container for testing — does NOT share singleton state. */
  static createFresh(): DIContainer {
    return new DIContainer();
  }

  /** Register a factory with a lifecycle. */
  register<T>(
    token: string,
    factory: (c: DIContainer, scope?: Map<string, unknown>) => T,
    lifecycle: Lifecycle = 'singleton'
  ): this {
    this.registry.set(token, { factory, lifecycle });
    return this;
  }

  /** Register a pre-built instance as a singleton. */
  set(token: string, instance: unknown): this {
    this.registry.set(token, {
      factory: () => instance,
      lifecycle: 'singleton',
      singleton: instance,
    });
    return this;
  }

  /** Resolve a token. Optionally pass a scope Map for scoped lifecycles. */
  get<T>(token: string, scope?: Map<string, unknown>): T {
    const reg = this.registry.get(token);
    if (!reg) throw new Error(`[DI] Token not registered: "${token}"`);

    if (reg.lifecycle === 'singleton') {
      if (reg.singleton === undefined) reg.singleton = reg.factory(this, scope);
      return reg.singleton as T;
    }

    if (reg.lifecycle === 'scoped') {
      const s = scope ?? new Map<string, unknown>();
      if (!s.has(token)) s.set(token, reg.factory(this, s));
      return s.get(token) as T;
    }

    // transient — new instance every time
    return reg.factory(this, scope) as T;
  }

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

  /**
   * Validate all registrations at startup.
   * Throws if any token's factory throws on a dry-run resolve.
   * Returns list of registered tokens.
   */
  validate(): string[] {
    const tokens = Array.from(this.registry.keys());
    for (const token of tokens) {
      try {
        this.get(token);
      } catch (err) {
        throw new Error(`[DI] Validation failed for token "${token}": ${(err as Error).message}`);
      }
    }
    return tokens;
  }

  /** Create a child container that inherits registrations but has its own scope. */
  createScope(): Map<string, unknown> {
    return new Map();
  }

  /** Reset singleton cache (useful in tests). */
  reset(): void {
    for (const reg of this.registry.values()) {
      delete reg.singleton;
    }
  }

  /** Clear all registrations (useful in tests). */
  clear(): void {
    this.registry.clear();
  }

  // ── Convenience typed getters (backwards-compatible) ──────────────────────

  getProjectController() {
    return this.get<import('../controllers/ProjectController.js').ProjectController>('ProjectController');
  }

  getProjectService() {
    return this.get<import('../services/ProjectService.js').ProjectService>('ProjectService');
  }

  getProjectRepository() {
    return this.get<import('../repositories/ProjectRepository.js').ProjectRepository>('ProjectRepository');
  }
}

export const container = DIContainer.getInstance();
