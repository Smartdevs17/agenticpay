import { ethers } from 'ethers';
import { logger } from '../utils/logger.js';

export type BillingInterval = 'daily' | 'weekly' | 'monthly' | 'annual' | 'yearly' | 'custom';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'past_due' | 'downgraded';

export interface PlanRequest {
  amount: string;
  interval: BillingInterval;
  metadata: string;
  currency?: string;
  customIntervalSeconds?: number;
  downgradePlanId?: number;
}

export interface SubscriptionPlan {
  id: number;
  amount: bigint;
  intervalSeconds: bigint;
  interval: BillingInterval;
  currency: string;
  active: boolean;
  metadata?: string;
}

export interface ManagedSubscription {
  id: string;
  customer: string;
  planId: number;
  status: SubscriptionStatus;
  active: boolean;
  startedAt: Date;
  currentPeriodStart: Date;
  nextPayment: Date;
  cancelAtPeriodEnd?: boolean;
  retryCount: number;
  currency: string;
  amount: bigint;
}

export interface SubscriptionAnalytics {
  activeSubscriptions: number;
  cancelledSubscriptions: number;
  monthlyRecurringRevenue: bigint;
  churnRate: number;
  lifetimeValue: bigint;
}

const SECONDS_PER_DAY = 86_400;

export const INTERVAL_SECONDS: Record<Exclude<BillingInterval, 'custom'>, number> = {
  daily: SECONDS_PER_DAY,
  weekly: 7 * SECONDS_PER_DAY,
  monthly: 30 * SECONDS_PER_DAY,
  annual: 365 * SECONDS_PER_DAY,
  yearly: 365 * SECONDS_PER_DAY,
};

const MONTHLY_MULTIPLIER: Record<BillingInterval, number> = {
  daily: 30,
  weekly: 52 / 12,
  monthly: 1,
  annual: 1 / 12,
  yearly: 1 / 12,
  custom: 1,
};

export class SubscriptionService {
  private contract: any;

  constructor(contractAddress: string, abi: any, provider: ethers.Provider | ethers.Signer) {
    this.contract = new ethers.Contract(contractAddress, abi, provider);
  }

  resolveIntervalSeconds(data: Pick<PlanRequest, 'interval' | 'customIntervalSeconds'>): number {
    if (data.interval === 'custom') {
      if (!data.customIntervalSeconds || data.customIntervalSeconds < SECONDS_PER_DAY) {
        throw new Error('Custom billing interval must be at least one day');
      }
      return data.customIntervalSeconds;
    }

    return INTERVAL_SECONDS[data.interval];
  }

  addBillingInterval(from: Date, interval: BillingInterval, customIntervalSeconds?: number): Date {
    const next = new Date(from);

    if (interval === 'monthly') {
      const day = next.getUTCDate();
      next.setUTCMonth(next.getUTCMonth() + 1, 1);
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(day, lastDay));
      return next;
    }

    if (interval === 'annual' || interval === 'yearly') {
      const month = next.getUTCMonth();
      const day = next.getUTCDate();
      next.setUTCFullYear(next.getUTCFullYear() + 1, month, 1);
      const lastDay = new Date(Date.UTC(next.getUTCFullYear(), month + 1, 0)).getUTCDate();
      next.setUTCDate(Math.min(day, lastDay));
      return next;
    }

    const seconds = interval === 'custom'
      ? this.resolveIntervalSeconds({ interval, customIntervalSeconds })
      : INTERVAL_SECONDS[interval];
    return new Date(from.getTime() + seconds * 1000);
  }

  async createPlan(merchantSigner: ethers.Signer, data: PlanRequest) {
    const intervalSeconds = this.resolveIntervalSeconds(data);
    const tx = await this.contract.connect(merchantSigner).createPlan(
      ethers.parseUnits(data.amount, 18),
      intervalSeconds,
      JSON.stringify({
        metadata: data.metadata,
        currency: data.currency ?? 'USD',
        downgradePlanId: data.downgradePlanId ?? null,
      })
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
    const currentPlan = await this.contract.plans(currentPlanId);
    const newPlan = await this.contract.plans(newPlanId);

    if (!sub.active) return { credit: 0n, immediateCharge: 0n };

    const now = BigInt(Math.floor(Date.now() / 1000));
    const timeRemaining = BigInt(sub.nextPayment) - now;

    if (timeRemaining <= 0n) return { credit: 0n, immediateCharge: 0n };

    const credit = (BigInt(currentPlan.amount) * timeRemaining) / BigInt(currentPlan.interval);
    const newPlanProratedCost = (BigInt(newPlan.amount) * timeRemaining) / BigInt(newPlan.interval);
    return {
      credit,
      immediateCharge: newPlanProratedCost > credit ? newPlanProratedCost - credit : 0n,
    };
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

  async pauseSubscription(customerSigner: ethers.Signer, planId: number) {
    const tx = await this.contract.connect(customerSigner).pauseSubscription(planId);
    const receipt = await tx.wait();
    await this.triggerLifecycleWebhook('paused', { customer: await customerSigner.getAddress(), planId });
    return receipt;
  }

  async resumeSubscription(customerSigner: ethers.Signer, planId: number) {
    const tx = await this.contract.connect(customerSigner).resumeSubscription(planId);
    const receipt = await tx.wait();
    await this.triggerLifecycleWebhook('resumed', { customer: await customerSigner.getAddress(), planId });
    return receipt;
  }

  calculateAnalytics(subscriptions: ManagedSubscription[], plans: SubscriptionPlan[]): SubscriptionAnalytics {
    const planById = new Map(plans.map(plan => [plan.id, plan]));
    const active = subscriptions.filter(sub => sub.status === 'active');
    const cancelled = subscriptions.filter(sub => sub.status === 'cancelled');

    const monthlyRecurringRevenue = active.reduce((total, sub) => {
      const plan = planById.get(sub.planId);
      const amount = plan?.amount ?? sub.amount;
      const interval = plan?.interval ?? 'monthly';
      return total + BigInt(Math.round(Number(amount) * MONTHLY_MULTIPLIER[interval]));
    }, 0n);

    const totalClosed = active.length + cancelled.length;
    const churnRate = totalClosed === 0 ? 0 : cancelled.length / totalClosed;
    const lifetimeValue = churnRate === 0
      ? monthlyRecurringRevenue
      : BigInt(Math.round(Number(monthlyRecurringRevenue) / churnRate));

    return {
      activeSubscriptions: active.length,
      cancelledSubscriptions: cancelled.length,
      monthlyRecurringRevenue,
      churnRate,
      lifetimeValue,
    };
  }

  async getSubscription(customer: string, planId: number) {
    return await this.contract.subscriptions(customer, planId);
  }

  async getPlan(planId: number) {
    return await this.contract.plans(planId);
  }

  async triggerLifecycleWebhook(event: string, data: any) {
    logger.info(`Subscription Webhook [${event}]:`, data);
  }
}
