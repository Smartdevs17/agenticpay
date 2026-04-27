export type JobSchedule =
  | { type: 'cron'; expression: string; timezone?: string }
  | { type: 'once'; runAt: Date };

export type JobHandler = () => Promise<void> | void;

export type JobStatus = {
  id: string;
  name: string;
  schedule: JobSchedule;
  status: 'idle' | 'running' | 'failed' | 'paused';
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  failureCount: number;
  nextRunAt: Date | null;
};

export type JobDefinition = {
  id: string;
  name: string;
  schedule: JobSchedule;
  handler: JobHandler;
};
