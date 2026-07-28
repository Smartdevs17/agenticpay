/**
 * Issue #488 — BullMQ registry bootstrap & singleton
 */

import { BullMQJobRegistry } from './job-registry.js';
import { domainJobs } from './job-definitions.js';

let registry: BullMQJobRegistry | null = null;

export function startBullMQRegistry(redisConnection: { host: string; port: number }): BullMQJobRegistry {
  if (registry) return registry;

  registry = new BullMQJobRegistry(redisConnection);
  for (const job of domainJobs) {
    registry.register(job);
  }
  registry.start();
  return registry;
}

export function getBullMQRegistry(): BullMQJobRegistry | null {
  return registry;
}
