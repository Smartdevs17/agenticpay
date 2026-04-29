import type { JobDefinition } from './types.js';
import { markOverdueRequests } from '../services/gdpr.js';

export const gdprJobs: JobDefinition[] = [
  {
    id: 'gdpr-deadline-check',
    name: 'GDPR 30-day deadline enforcement',
    // Runs daily at midnight
    schedule: { type: 'cron', expression: '0 0 * * *' },
    handler: () => {
      const count = markOverdueRequests();
      if (count > 0) {
        console.warn(`[gdpr-jobs] Marked ${count} GDPR request(s) as overdue`);
      } else {
        console.log('[gdpr-jobs] No overdue GDPR requests found');
      }
    },
  },
];
