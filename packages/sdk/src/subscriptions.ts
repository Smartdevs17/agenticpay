import { AgenticPayClient } from './client.js';

export type SubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'past_due' | 'trialing';

export type SubscriptionInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type SubscriptionPlan = {
  id: string;
  merchantId: string;
  name: string;
  description?: string;
  interval: SubscriptionInterval;
  amount: number;
  currency: string;
  trialDays?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Subscription = {
  id: string;
  customerId: string;
  planId: string;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialStart?: string;
  trialEnd?: string;
  cancelledAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePlanInput = {
  merchantId: string;
  name: string;
  description?: string;
  interval: SubscriptionInterval;
  amount: number;
  currency: string;
  trialDays?: number;
};

export type CreateSubscriptionInput = {
  customerId: string;
  planId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
};

export type CancelSubscriptionInput = {
  immediately?: boolean;
  reason?: string;
};

export type PauseSubscriptionInput = {
  resumeAt?: string;
};

export class SubscriptionsApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** Create a subscription plan. */
  createPlan(input: CreatePlanInput) {
    return this.client.post<SubscriptionPlan>('/plans', input);
  }

  /** List plans for a merchant. */
  listMerchantPlans(merchantId: string) {
    return this.client.get<SubscriptionPlan[]>(`/plans/${merchantId}`);
  }

  /** Get a single plan by ID. */
  getPlan(planId: string) {
    return this.client.get<SubscriptionPlan>(`/plans/detail/${planId}`);
  }

  /** Enroll a customer in a plan. */
  enroll(input: CreateSubscriptionInput) {
    return this.client.post<Subscription>('/subscriptions/enroll', input);
  }

  /** Get a subscription by ID. */
  getSubscription(id: string) {
    return this.client.get<Subscription>(`/subscriptions/${id}`);
  }

  /** Cancel a subscription. */
  cancel(id: string, input?: CancelSubscriptionInput) {
    return this.client.delete<Subscription>(`/subscriptions/${id}`, input);
  }

  /** Pause a subscription. */
  pause(id: string, input?: PauseSubscriptionInput) {
    return this.client.post<Subscription>(`/subscriptions/${id}/pause`, input);
  }

  /** Reactivate a paused subscription. */
  reactivate(id: string) {
    return this.client.post<Subscription>(`/subscriptions/${id}/reactivate`);
  }
}
