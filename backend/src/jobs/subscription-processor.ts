import { SubscriptionService } from './subscription.service';
import { logger } from '../utils/logger';

/**
 * SubscriptionProcessor
 * Runs periodically to identify and execute due payments
 */
export class SubscriptionProcessor {
  constructor(private subService: SubscriptionService) {}

  async processPendingRenewals() {
    logger.info('Starting subscription renewal batch processing...');
    
    try {
      // 1. Fetch active subscriptions due for renewal from DB/Indexer
      // This is more efficient than scanning the whole chain
      const dueSubscriptions = await this.getDueSubscriptions();

      if (dueSubscriptions.length === 0) {
        logger.info('No pending renewals found.');
        return;
      }

      logger.info(`Found ${dueSubscriptions.length} subscriptions due for renewal.`);

      // Process in parallel with controlled failure handling
      const results = await Promise.allSettled(
        dueSubscriptions.map(sub => this.executeWithRetry(sub))
      );

      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(r => r.status === 'rejected').length;

      logger.info(`Batch processing completed. Success: ${fulfilled}, Failed: ${rejected}`);
    } catch (error) {
      logger.error('Critical error during renewal processing:', error);
    }
  }

  private async executeWithRetry(sub: any, attempt = 1): Promise<void> {
    const MAX_RETRIES = 3;
    try {
      logger.info(`Executing payment for customer ${sub.customer} on plan ${sub.planId} (Attempt ${attempt})`);
      // Trigger the smart contract execution via the service
      await this.subService.executePayment(sub.customer, sub.planId);
      await this.subService.triggerLifecycleWebhook('renewed', { customer: sub.customer, planId: sub.planId, subscriptionId: sub.id });
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`Payment failed for ${sub.customer}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.executeWithRetry(sub, attempt + 1);
      } else {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.subService.triggerLifecycleWebhook('failed', { 
          subscriptionId: sub.id, 
          customer: sub.customer,
          error: errorMessage 
        });
        throw error;
      }
    }
  }

  private async getDueSubscriptions() {
    // This would typically query a database (e.g., Prisma/TypeORM) or an indexer 
    // for active subscriptions where nextPayment <= currentTimestamp.
    // Example: return await this.db.subscription.findMany({ where: { active: true, nextPayment: { lte: new Date() } } });
    return [];
  }
}