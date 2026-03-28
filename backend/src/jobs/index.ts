import { JobScheduler } from './scheduler.js';
import { defaultJobs } from './default-jobs.js';

let scheduler: JobScheduler | null = null;

export function startJobs(): JobScheduler {
  if (scheduler) {
    return scheduler;
  }

  scheduler = new JobScheduler();

  for (const job of defaultJobs) {
    scheduler.addJob(job);
  }

  return scheduler;
}

export function getJobScheduler(): JobScheduler | null {
  return scheduler;
}
