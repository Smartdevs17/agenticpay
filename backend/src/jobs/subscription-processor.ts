import { SubscriptionService } from './subscription.service';
import { logger } from '../utils/logger.js';

export interface DueSubscription {
  id: string;
  customer: string;
  planId: number;
  retryCount?: number;
  downgradePlanId?: number;
  paused?: boolean;
}

export interface SubscriptionRepository {
  findDueSubscriptions(now: Date): Promise<DueSubscription[]>;
  markRenewed(subscription: DueSubscription, renewedAt: Date): Promise<void>;
  recordFailure(subscription: DueSubscription, error: string, retryCount: number): Promise<void>;
  downgradeSubscription(subscription: DueSubscription): Promise<void>;
}

export interface SubscriptionProcessorOptions {
  maxRetries?: number;
  retryDelayMs?: (attempt: number) => number;
  now?: () => Date;
}

const defaultRetryDelayMs = (attempt: number) => Math.pow(2, attempt) * 1000;

/**
 * Runs periodically to identify and execute due recurring payments.
 */
export class SubscriptionProcessor {
  private readonly maxRetries: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly now: () => Date;

  constructor(
    private subService: SubscriptionService,
    private repository?: SubscriptionRepository,
    options: SubscriptionProcessorOptions = {}
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.retryDelayMs = options.retryDelayMs ?? defaultRetryDelayMs;
    this.now = options.now ?? (() => new Date());
  }

  async processPendingRenewals() {
    logger.info('Starting subscription renewal batch processing...');

    try {
      const dueSubscriptions = await this.getDueSubscriptions();
      const payableSubscriptions = dueSubscriptions.filter(sub => !sub.paused);

      if (payableSubscriptions.length === 0) {
        logger.info('No pending renewals found.');
        return;
      }

      logger.info(`Found ${payableSubscriptions.length} subscriptions due for renewal.`);

      const results = await Promise.allSettled(
        payableSubscriptions.map(sub => this.executeWithRetry(sub))
      );

      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(r => r.status === 'rejected').length;

      logger.info(`Batch processing completed. Success: ${fulfilled}, Failed: ${rejected}`);
    } catch (error) {
      logger.error('Critical error during renewal processing:', error);
    }
  }

  private async executeWithRetry(sub: DueSubscription, attempt = 1): Promise<void> {
    try {
      logger.info(`Executing payment for customer ${sub.customer} on plan ${sub.planId} (Attempt ${attempt})`);
      await this.subService.executePayment(sub.customer, sub.planId);
      await this.repository?.markRenewed(sub, this.now());
      await this.subService.triggerLifecycleWebhook('renewed', {
        customer: sub.customer,
        planId: sub.planId,
        subscriptionId: sub.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.repository?.recordFailure(sub, errorMessage, attempt);

      if (attempt < this.maxRetries) {
        const delay = this.retryDelayMs(attempt);
        logger.warn(`Payment failed for ${sub.customer}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(sub, attempt + 1);
      }

      await this.handleDunningFailure(sub, errorMessage);
      throw error;
    }
  }

  private async handleDunningFailure(sub: DueSubscription, error: string) {
    await this.repository?.downgradeSubscription(sub);
    await this.subService.triggerLifecycleWebhook('failed', {
      subscriptionId: sub.id,
      customer: sub.customer,
      planId: sub.planId,
      downgradePlanId: sub.downgradePlanId,
      retryCount: this.maxRetries,
      error,
    });
  }

  private async getDueSubscriptions() {
    return this.repository?.findDueSubscriptions(this.now()) ?? [];
  }
}
