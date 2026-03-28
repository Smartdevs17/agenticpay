import type { JobDefinition } from './types.js';

export const defaultJobs: JobDefinition[] = [
  {
    id: 'system-heartbeat',
    name: 'System heartbeat log',
    schedule: { type: 'cron', expression: '*/5 * * * *' },
    handler: () => {
      console.log('[jobs] heartbeat', new Date().toISOString());
    },
  },
];
