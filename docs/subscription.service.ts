import { ethers } from 'ethers';
import { logger } from '../../utils/logger'; // Assuming existing logger

export interface PlanRequest {
  amount: string;
  interval: 'daily' | 'weekly' | 'monthly' | 'yearly';
  metadata: string;
}

const INTERVAL_MAP = {
  daily: 86400,
  weekly: 604800,
  monthly: 2592000,
  yearly: 31536000,
};

export class SubscriptionService {
  private contract: ethers.Contract;

  constructor(contractAddress: string, abi: any, provider: ethers.Provider) {
    this.contract = new ethers.Contract(contractAddress, abi, provider);
  }

  async createPlan(merchantSigner: ethers.Signer, data: PlanRequest) {
    const intervalSeconds = INTERVAL_MAP[data.interval];
    const tx = await this.contract.connect(merchantSigner).createPlan(
      ethers.parseEther(data.amount),
      intervalSeconds,
      data.metadata
    );
    return await tx.wait();
  }

  /**
   * Handles proration logic when switching plans
   * Logic: Calculate remaining value of current period and credit it to new plan
   */
  async calculateProration(customer: string, currentPlanId: number, newPlanId: number) {
    const sub = await this.contract.subscriptions(customer, currentPlanId);
    const plan = await this.contract.plans(currentPlanId);
    
    if (!sub.active) return 0;

    const now = Math.floor(Date.now() / 1000);
    const timeRemaining = sub.nextPayment - now;
    const totalInterval = plan.interval;
    
    if (timeRemaining <= 0) return 0;

    const credit = (BigInt(plan.amount) * BigInt(timeRemaining)) / BigInt(totalInterval);
    return credit;
  }

  async triggerLifecycleWebhook(event: string, data: any) {
    logger.info(`Subscription Webhook [${event}]:`, data);
    // Implementation would POST to configured merchant URLs
    // Events: created, renewed, failed, cancelled
  }
}