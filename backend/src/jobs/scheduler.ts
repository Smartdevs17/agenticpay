import cron from 'node-cron';
import cronParser from 'cron-parser';
import type { JobDefinition, JobSchedule } from './types.js';
import { JobRegistry } from './registry.js';

type ScheduledJob = {
  type: 'cron' | 'once';
  task?: cron.ScheduledTask;
  timeout?: NodeJS.Timeout;
  paused: boolean;
};

export class JobScheduler {
  private registry = new JobRegistry();
  private tasks = new Map<string, ScheduledJob>();

  addJob(definition: JobDefinition): void {
    this.registry.register(definition);
    if (definition.schedule.type === 'cron') {
      this.scheduleCronJob(definition);
    } else {
      this.scheduleOneTimeJob(definition);
    }
  }

  runJobNow(jobId: string): Promise<void> {
    return this.executeJob(jobId);
  }

  pauseJob(jobId: string): void {
    const job = this.tasks.get(jobId);
    if (!job || job.paused) {
      return;
    }
    job.paused = true;
    if (job.type === 'cron' && job.task) {
      job.task.stop();
    }
    if (job.type === 'once' && job.timeout) {
      clearTimeout(job.timeout);
      job.timeout = undefined;
    }
    this.registry.updateStatus(jobId, (status) => ({ ...status, status: 'paused' }));
  }

  resumeJob(jobId: string): void {
    const job = this.tasks.get(jobId);
    const def = this.registry.getDefinition(jobId);
    if (!job || !def || !job.paused) {
      return;
    }
    job.paused = false;
    if (def.schedule.type === 'cron') {
      this.scheduleCronJob(def, true);
    } else {
      this.scheduleOneTimeJob(def, true);
    }
    this.registry.updateStatus(jobId, (status) => ({ ...status, status: 'idle' }));
  }

  getStatuses() {
    return this.registry.listStatuses();
  }

  private scheduleCronJob(definition: JobDefinition, resuming = false): void {
    const schedule = definition.schedule;
    if (schedule.type !== 'cron') {
      return;
    }
    const task = cron.schedule(
      schedule.expression,
      () => {
        void this.executeJob(definition.id);
      },
      { timezone: schedule.timezone, scheduled: true },
    );

    if (!resuming) {
      this.tasks.set(definition.id, { type: 'cron', task, paused: false });
    } else {
      const existing = this.tasks.get(definition.id);
      if (existing) {
        existing.task = task;
        existing.paused = false;
      } else {
        this.tasks.set(definition.id, { type: 'cron', task, paused: false });
      }
    }

    this.registry.updateStatus(definition.id, (status) => ({
      ...status,
      nextRunAt: getNextRunAt(schedule),
      status: 'idle',
    }));
  }

  private scheduleOneTimeJob(definition: JobDefinition, resuming = false): void {
    const schedule = definition.schedule;
    if (schedule.type !== 'once') {
      return;
    }

    const delay = Math.max(schedule.runAt.getTime() - Date.now(), 0);
    const timeout = setTimeout(() => {
      void this.executeJob(definition.id);
    }, delay);

    if (!resuming) {
      this.tasks.set(definition.id, { type: 'once', timeout, paused: false });
    } else {
      const existing = this.tasks.get(definition.id);
      if (existing) {
        existing.timeout = timeout;
        existing.paused = false;
      } else {
        this.tasks.set(definition.id, { type: 'once', timeout, paused: false });
      }
    }

    this.registry.updateStatus(definition.id, (status) => ({
      ...status,
      nextRunAt: schedule.runAt,
      status: 'idle',
    }));
  }

  private async executeJob(jobId: string): Promise<void> {
    const def = this.registry.getDefinition(jobId);
    if (!def) {
      return;
    }

    const jobEntry = this.tasks.get(jobId);
    if (jobEntry?.paused) {
      return;
    }

    this.registry.updateStatus(jobId, (status) => ({
      ...status,
      status: 'running',
      lastRunAt: new Date(),
    }));

    try {
      await def.handler();
      this.registry.updateStatus(jobId, (status) => ({
        ...status,
        status: 'idle',
        lastSuccessAt: new Date(),
        lastError: null,
        nextRunAt: getNextRunAt(def.schedule),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.registry.updateStatus(jobId, (status) => ({
        ...status,
        status: 'failed',
        lastError: message,
        failureCount: status.failureCount + 1,
        nextRunAt: getNextRunAt(def.schedule),
      }));
    } finally {
      if (def.schedule.type === 'once') {
        const job = this.tasks.get(jobId);
        if (job?.timeout) {
          clearTimeout(job.timeout);
        }
        this.tasks.delete(jobId);
        this.registry.updateStatus(jobId, (status) => ({
          ...status,
          nextRunAt: null,
          status: status.status === 'failed' ? 'failed' : 'idle',
        }));
      }
    }
  }
}

function getNextRunAt(schedule: JobSchedule): Date | null {
  if (schedule.type === 'once') {
    return schedule.runAt;
  }

  try {
    const interval = cronParser.parseExpression(schedule.expression, {
      tz: schedule.timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}
