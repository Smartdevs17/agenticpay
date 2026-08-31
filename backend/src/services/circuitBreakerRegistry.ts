/**
 * A small registry that owns named `CircuitBreaker` instances.
 *
 * The registry is a convenience for the middleware/route layer so services can
 * be addressed by a stable name (e.g. `stripe-api`, `stellar-horizon`) without
 * passing instances around. Every breaker is an isolated instance; the registry
 * does not share any state between named entries.
 */

import { CircuitBreaker, type CircuitBreakerConfig } from './circuitBreaker.js';

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Get an existing breaker or create it with the given config. */
  get(name: string, config: Partial<CircuitBreakerConfig> = {}): CircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = this.create(name, config);
    }
    return breaker;
  }

  /** Get an existing breaker or `undefined` (does not create). */
  getIfPresent(name: string): CircuitBreaker | undefined {
    return this.breakers.get(name);
  }

  /** Create (or replace) a breaker under `name`. */
  create(name: string, config: Partial<CircuitBreakerConfig> = {}): CircuitBreaker {
    const breaker = new CircuitBreaker(name, config, this.now);
    this.breakers.set(name, breaker);
    return breaker;
  }

  has(name: string): boolean {
    return this.breakers.has(name);
  }

  reset(name: string): boolean {
    const breaker = this.breakers.get(name);
    if (!breaker) return false;
    breaker.reset();
    return true;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  delete(name: string): boolean {
    return this.breakers.delete(name);
  }

  clear(): void {
    this.breakers.clear();
  }

  names(): string[] {
    return Array.from(this.breakers.keys());
  }

  snapshots(): Array<ReturnType<CircuitBreaker['snapshot']>> {
    return Array.from(this.breakers.values()).map((b) => b.snapshot());
  }
}
