import { Queue, Worker, Job } from 'bullmq';
import { checkBalances } from '../services/reconciliation/balance-checker';
import { resolveDiscrepancies } from '../services/reconciliation/discrepancy-resolver';

// Assuming Redis connection details are available in environment
const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6379'),
};

const RECONCILIATION_QUEUE = 'reconciliation-queue';

export const reconciliationQueue = new Queue(RECONCILIATION_QUEUE, { connection });

// Set up repeating job every 5 minutes
reconciliationQueue.add(
  'run-reconciliation',
  {},
  {
    repeat: {
      pattern: '*/5 * * * *', // Cron expression for every 5 minutes
    },
  }
);

export const reconciliationWorker = new Worker(
  RECONCILIATION_QUEUE,
  async (job: Job) => {
    console.log(`Starting reconciliation job ${job.id}`);
    
    try {
      const report = await checkBalances();
      console.log(`Reconciliation check completed. Report ID: ${report.id}`);
      
      if (report.discrepancyCount > 0) {
        console.log(`Found ${report.discrepancyCount} discrepancies. Running resolver...`);
        await resolveDiscrepancies(report.id);
      }
    } catch (error) {
      console.error('Failed to run reconciliation job:', error);
      throw error;
    }
  },
  { connection }
);
