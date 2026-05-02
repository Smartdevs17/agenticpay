import { ethers } from 'ethers';
import { logger } from '../../utils/logger';

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

  constructor(contractAddress: string, abi: any, provider: ethers.Provider | ethers.Signer) {
    this.contract = new ethers.Contract(contractAddress, abi, provider);
  }

  async createPlan(merchantSigner: ethers.Signer, data: PlanRequest) {
    const intervalSeconds = INTERVAL_MAP[data.interval];
    const tx = await this.contract.connect(merchantSigner).createPlan(
      ethers.parseUnits(data.amount, 18),
      intervalSeconds,
      data.metadata
    );
    return await tx.wait();
  }

  async updatePlan(merchantSigner: ethers.Signer, planId: number, active: boolean) {
    const tx = await this.contract.connect(merchantSigner).updatePlan(planId, active);
    return await tx.wait();
  }

  async executePayment(customer: string, planId: number) {
    const tx = await this.contract.executePayment(customer, planId);
    return await tx.wait();
  }

  async calculateProration(customer: string, currentPlanId: number, newPlanId: number) {
    const sub = await this.contract.subscriptions(customer, currentPlanId);
    const plan = await this.contract.plans(currentPlanId);
    
    if (!sub.active) return 0n;

    const now = BigInt(Math.floor(Date.now() / 1000));
    const timeRemaining = BigInt(sub.nextPayment) - now;
    
    if (timeRemaining <= 0n) return 0n;

    const credit = (BigInt(plan.amount) * timeRemaining) / BigInt(plan.interval);
    return credit;
  }

  async subscribe(customerSigner: ethers.Signer, planId: number) {
    const tx = await this.contract.connect(customerSigner).subscribe(planId);
    const receipt = await tx.wait();
    await this.triggerLifecycleWebhook('created', { customer: await customerSigner.getAddress(), planId });
    return receipt;
  }

  async cancelSubscription(customerSigner: ethers.Signer, planId: number) {
    const tx = await this.contract.connect(customerSigner).cancelSubscription(planId);
    const receipt = await tx.wait();
    await this.triggerLifecycleWebhook('cancelled', { customer: await customerSigner.getAddress(), planId });
    return receipt;
  }

  async getSubscription(customer: string, planId: number) {
    return await this.contract.subscriptions(customer, planId);
  }

  async getPlan(planId: number) {
    return await this.contract.plans(planId);
  }

  async triggerLifecycleWebhook(event: string, data: any) {
    logger.info(`Subscription Webhook [${event}]:`, data);
    // Implementation would POST to configured merchant URLs
  }
}