/**
 * Centralised scheduled-task registry.
 *
 * All cron jobs are declared here with full metadata so there is one source
 * of truth for schedules, descriptions, and timeouts.  Individual job
 * handlers live in backend/src/jobs/ and are imported below.
 *
 * Environment overrides
 * ---------------------
 * Set SCHEDULE_OVERRIDE_<UPPER_SNAKE_ID>=<cron-expression> to swap the
 * schedule of any job without code changes.  Useful for dev/CI speedups:
 *
 *   SCHEDULE_OVERRIDE_SYSTEM_HEARTBEAT="* * * * *"   # run every minute
 *   SCHEDULE_OVERRIDE_GDPR_DEADLINE_CHECK="0 12 * * *"
 */

import cronParser from 'cron-parser';
import { markOverdueRequests } from '../services/gdpr.js';
import { sandboxCleanupJobs } from '../jobs/sandbox-cleanup.js';
import { SubscriptionService } from '../services/subscription.service.js';
import { SubscriptionProcessor } from '../jobs/subscription-processor.js';
import { getArchivalService } from '../services/archival/index.js';
import { getBridgeMonitorService } from '../services/bridge-monitor/bridge-monitor.js';
import { ethers } from 'ethers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledTaskMeta {
  /** Unique identifier — must be kebab-case, globally unique */
  id: string;
  /** Human-readable name shown in dashboards */
  name: string;
  /** What the job does */
  description: string;
  /** node-cron / BullMQ cron expression */
  schedule: string;
  /** IANA timezone for schedule evaluation */
  timezone?: string;
  /** Abort after this many milliseconds; undefined = no timeout */
  timeoutMs?: number;
  /** Max consecutive failures before the job is paused */
  maxFailures?: number;
  /** Actual work to perform */
  handler: () => Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read an env-level schedule override for a given task id. */
function envScheduleFor(id: string): string | undefined {
  const key = `SCHEDULE_OVERRIDE_${id.toUpperCase().replace(/-/g, '_')}`;
  return process.env[key];
}

/** Validate a cron expression; throw a descriptive error if invalid. */
export function validateCronExpression(expression: string, id: string): void {
  try {
    cronParser.parseExpression(expression);
  } catch {
    throw new Error(
      `[scheduled-tasks] Invalid cron expression "${expression}" for task "${id}". ` +
        'Check SCHEDULE_OVERRIDE_* environment variables or the task definition.',
    );
  }
}

/** Return the next N scheduled run times for a cron expression. */
export function getNextRunTimes(expression: string, count = 5, timezone?: string): Date[] {
  try {
    const interval = cronParser.parseExpression(expression, { tz: timezone });
    return Array.from({ length: count }, () => interval.next().toDate());
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Raw task definitions
// ---------------------------------------------------------------------------

const RAW_TASKS: Omit<ScheduledTaskMeta, 'schedule'> & { defaultSchedule: string }[] = [
  {
    id: 'system-heartbeat',
    name: 'System heartbeat log',
    description: 'Emits a periodic heartbeat log entry for uptime monitoring.',
    defaultSchedule: '*/5 * * * *',
    handler: () => {
      console.log('[jobs] heartbeat', new Date().toISOString());
    },
  },
  {
    id: 'subscription-renewal-processor',
    name: 'Process Recurring Payments',
    description: 'Finds subscriptions due for renewal and executes on-chain payments via the EVM subscription contract.',
    defaultSchedule: '0 * * * *',
    timeoutMs: 5 * 60 * 1000,
    handler: async () => {
      const contractAddress = process.env.SUBSCRIPTION_CONTRACT_ADDRESS;
      const rpcUrl = process.env.EVM_RPC_URL;
      const privateKey = process.env.STELLAR_SECRET_KEY;

      if (!contractAddress || !rpcUrl || !privateKey) {
        console.error('[jobs] Subscription processor missing environment variables');
        return;
      }

      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const signer = new ethers.Wallet(privateKey, provider);

      const abi = [
        'function executePayment(address customer, uint256 planId) external',
        'function recordDunningFailure(address customer, uint256 planId) external',
        'function pauseSubscription(uint256 planId) external',
        'function resumeSubscription(uint256 planId) external',
        'function subscriptions(address customer, uint256 planId) view returns (uint256 planId, uint256 lastPayment, uint256 nextPayment, uint8 retryCount, uint8 status)',
        'function plans(uint256 planId) view returns (address merchant, uint256 amount, uint256 interval, bool active, uint256 downgradePlanId, string metadata)',
      ];

      const service = new SubscriptionService(contractAddress, abi, signer);
      const processor = new SubscriptionProcessor(service);
      await processor.processPendingRenewals();
    },
  },
  {
    id: 'gdpr-deadline-check',
    name: 'GDPR 30-day deadline enforcement',
    description: 'Marks GDPR data-access requests that have exceeded the 30-day legal response window.',
    defaultSchedule: '0 0 * * *',
    handler: () => {
      const count = markOverdueRequests();
      if (count > 0) {
        console.warn(`[gdpr-jobs] Marked ${count} GDPR request(s) as overdue`);
      } else {
        console.log('[gdpr-jobs] No overdue GDPR requests found');
      }
    },
  },
  {
    id: 'sandbox-cleanup-expired-accounts',
    name: 'Cleanup Expired Sandbox Accounts',
    description: 'Deactivates sandbox accounts whose trial period has elapsed.',
    defaultSchedule: '0 */6 * * *',
    handler: sandboxCleanupJobs.find((j) => j.id === 'sandbox-cleanup-expired-accounts')!.handler,
  },
  {
    id: 'sandbox-cleanup-old-data',
    name: 'Cleanup Old Sandbox Data',
    description: 'Purges sandbox transactions and account rows older than 30 days.',
    defaultSchedule: '0 2 * * *',
    handler: sandboxCleanupJobs.find((j) => j.id === 'sandbox-cleanup-old-data')!.handler,
  },
  {
    id: 'sandbox-maintenance-stats',
    name: 'Sandbox Maintenance Statistics',
    description: 'Aggregates sandbox usage statistics for monitoring dashboards.',
    defaultSchedule: '0 0 * * *',
    handler: sandboxCleanupJobs.find((j) => j.id === 'sandbox-maintenance-stats')!.handler,
  },
  {
    id: 'daily-onchain-archival',
    name: 'Daily On-Chain Data Archival',
    description: 'Backs up transaction data, event logs, and contract state to IPFS with integrity verification.',
    defaultSchedule: '0 3 * * *',
    timezone: 'UTC',
    timeoutMs: 60 * 60 * 1000,
    handler: async () => {
      const result = await getArchivalService().runDailyArchival();
      if (result.ok) {
        console.log(`[archival] Daily batch complete: ${result.value.batchesProcessed} chain(s) archived`);
      } else {
        console.error('[archival] Daily batch failed:', result.error.message);
      }
    },
  },
  {
    id: 'bridge-monitor-reconcile',
    name: 'Bridge Message Reconciliation',
    description: 'Polls bridge providers, detects stuck/delayed messages, and emits alerts.',
    defaultSchedule: '*/5 * * * *',
    timeoutMs: 5 * 60 * 1000,
    handler: async () => {
      await getBridgeMonitorService().pollAndReconcile();
    },
  },
  {
    id: 'archival-retention-cleanup',
    name: 'Archival retention enforcement',
    description: 'Removes archival batches past the 7-year retention window.',
    defaultSchedule: '0 4 * * 0',
    timezone: 'UTC',
    handler: async () => {
      if (!process.env.DATABASE_URL) return;
      const { prisma } = await import('../lib/prisma.js');
      const cutoff = new Date();
      const deleted = await prisma.archivalBatch.deleteMany({
        where: { retentionUntil: { lt: cutoff } },
      });
      if (deleted.count > 0) {
        console.log(`[archival] Purged ${deleted.count} expired batch(es)`);
      }
    },
  },
];

// ---------------------------------------------------------------------------
// Public registry
// ---------------------------------------------------------------------------

let _registry: ScheduledTaskMeta[] | null = null;

/**
 * Build and validate all scheduled tasks.  Called once at startup.
 * Throws if any cron expression is invalid.
 */
export function buildScheduledTasks(): ScheduledTaskMeta[] {
  if (_registry) return _registry;

  _registry = RAW_TASKS.map(({ defaultSchedule, ...rest }) => {
    const schedule = envScheduleFor(rest.id) ?? defaultSchedule;
    validateCronExpression(schedule, rest.id);
    return { ...rest, schedule };
  });

  console.log(`[scheduled-tasks] Validated ${_registry.length} task definitions`);
  return _registry;
}

/**
 * Return all scheduled tasks (cached after first call).
 */
export function getScheduledTasks(): ScheduledTaskMeta[] {
  return _registry ?? buildScheduledTasks();
}

/**
 * Dashboard summary: each task with its next upcoming run times.
 */
export function getScheduledTaskDashboard() {
  return getScheduledTasks().map((task) => ({
    id: task.id,
    name: task.name,
    description: task.description,
    schedule: task.schedule,
    timezone: task.timezone ?? 'UTC',
    timeoutMs: task.timeoutMs ?? null,
    nextRuns: getNextRunTimes(task.schedule, 3, task.timezone),
  }));
}
