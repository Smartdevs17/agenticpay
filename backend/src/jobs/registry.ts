import type { JobDefinition, JobStatus } from './types.js';

export class JobRegistry {
  private statuses = new Map<string, JobStatus>();
  private definitions = new Map<string, JobDefinition>();

  register(definition: JobDefinition): void {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Job with id ${definition.id} already exists`);
    }
    this.definitions.set(definition.id, definition);
    this.statuses.set(definition.id, {
      id: definition.id,
      name: definition.name,
      schedule: definition.schedule,
      status: 'idle',
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      failureCount: 0,
      nextRunAt: null,
    });
  }

  getDefinition(jobId: string): JobDefinition | undefined {
    return this.definitions.get(jobId);
  }

  getStatus(jobId: string): JobStatus | undefined {
    return this.statuses.get(jobId);
  }

  updateStatus(jobId: string, updater: (status: JobStatus) => JobStatus): void {
    const current = this.statuses.get(jobId);
    if (!current) {
      return;
    }
    this.statuses.set(jobId, updater(current));
  }

  listStatuses(): JobStatus[] {
    return Array.from(this.statuses.values());
  }
}
