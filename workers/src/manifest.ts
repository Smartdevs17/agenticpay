/**
 * Single source of truth for jobs run by the edge worker's cron trigger.
 * Keeping identifiers here prevents each worker entry point from inventing a
 * separate schedule or silently omitting a warm-up task.
 */

export interface WorkerJobDefinition {
  id: 'backend-warmup' | 'soroban-rpc-warmup';
  cron: '*/5 * * * *';
  enabled: boolean;
}

export const WORKER_JOB_MANIFEST: readonly WorkerJobDefinition[] = [
  { id: 'backend-warmup', cron: '*/5 * * * *', enabled: true },
  { id: 'soroban-rpc-warmup', cron: '*/5 * * * *', enabled: true },
];
