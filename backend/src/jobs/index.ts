import { JobScheduler } from './scheduler.js';
import { buildScheduledTasks } from '../config/scheduled-tasks.js';
import type { JobDefinition } from './types.js';

let scheduler: JobScheduler | null = null;

export function startJobs(): JobScheduler {
  if (scheduler) {
    return scheduler;
  }

  // Validate all cron expressions at startup; throws on invalid config
  const tasks = buildScheduledTasks();

  scheduler = new JobScheduler();

  for (const task of tasks) {
    const job: JobDefinition = {
      id: task.id,
      name: task.name,
      schedule: { type: 'cron', expression: task.schedule, timezone: task.timezone },
      handler: task.handler,
    };
    scheduler.addJob(job);
  }

  return scheduler;
}

export function getJobScheduler(): JobScheduler | null {
  return scheduler;
}
