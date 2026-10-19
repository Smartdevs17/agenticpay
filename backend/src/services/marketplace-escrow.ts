/**
 * marketplace-escrow.ts — Issue #915
 *
 * Escrow payment workflows for marketplaces.
 *
 * A marketplace holds the buyer's funds until delivery is confirmed, then
 * settles the order by paying the seller and taking a platform commission.
 * The workflow supports:
 *  - order lifecycle: created → funded → shipped → delivered → released;
 *  - a buyer inspection window after delivery, after which funds
 *    auto-release to the seller;
 *  - optional milestone-based partial releases for large orders;
 *  - buyer-protection disputes resolved to the buyer, the seller, or split;
 *  - refunds and cancellation of unfunded orders;
 *  - payout/settlement reporting per marketplace.
 */

import { randomUUID } from 'node:crypto';
import { BaseService } from './BaseService.js';

export type MarketplaceOrderStatus =
  | 'created'
  | 'funded'
  | 'shipped'
  | 'delivered'
  | 'released'
  | 'partially_released'
  | 'refunded'
  | 'disputed'
  | 'cancelled';

export type MilestoneStatus = 'pending' | 'released';

export interface Milestone {
  id: string;
  name: string;
  amount: number;
  status: MilestoneStatus;
  releasedAt?: string;
}

export interface OrderEvent {
  type: string;
  at: string;
  details?: Record<string, unknown>;
}

export interface EscrowDispute {
  raisedBy: string;
  reason: string;
  raisedAt: string;
  resolution?: 'buyer' | 'seller' | 'split';
  buyerPercent?: number;
  resolvedAt?: string;
}

export interface MarketplaceOrder {
  id: string;
  marketplaceId: string;
  externalOrderId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  platformFeePercent: number;
  platformFee: number;
  sellerPayout: number;
  refundedAmount: number;
  status: MarketplaceOrderStatus;
  milestones?: Milestone[];
  inspectionPeriodMs: number;
  fundingTxHash?: string;
  trackingInfo?: string;
  deliveredAt?: string;
  autoReleaseAt?: string;
  releasedAt?: string;
  refundedAt?: string;
  cancelledAt?: string;
  dispute?: EscrowDispute;
  events: OrderEvent[];
  createdAt: string;
  updatedAt: string;
}

export interface PayoutBreakdown {
  orderId: string;
  amount: number;
  currency: string;
  platformFee: number;
  sellerPayout: number;
  buyerRefund: number;
  releasedMilestoneAmount: number;
  status: MarketplaceOrderStatus;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INSPECTION_PERIOD_MS = 7 * DAY_MS;

export class MarketplaceEscrowService extends BaseService {
  private orders = new Map<string, MarketplaceOrder>();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  // ----------------------------------------------------------- order creation

  createOrder(input: {
    marketplaceId: string;
    externalOrderId: string;
    buyerId: string;
    sellerId: string;
    amount: number;
    currency?: string;
    platformFeePercent?: number;
    inspectionPeriodMs?: number;
    milestones?: { id?: string; name: string; amount: number }[];
  }): MarketplaceOrder {
    this.validate(!!input.marketplaceId, 'marketplaceId is required');
    this.validate(!!input.externalOrderId, 'externalOrderId is required');
    this.validate(!!input.buyerId && !!input.sellerId, 'buyerId and sellerId are required');
    this.validate(input.buyerId !== input.sellerId, 'Buyer and seller must be different');
    this.validate(input.amount > 0, 'Amount must be greater than 0');

    const platformFeePercent = input.platformFeePercent ?? 10;
    this.validate(
      platformFeePercent >= 0 && platformFeePercent <= 100,
      'platformFeePercent must be between 0 and 100',
    );

    const amount = this.round(input.amount);
    const milestones = input.milestones?.map((m) => {
      this.validate(m.amount > 0, 'Milestone amount must be greater than 0');
      return {
        id: m.id ?? `ms_${randomUUID()}`,
        name: m.name,
        amount: this.round(m.amount),
        status: 'pending' as MilestoneStatus,
      };
    });

    if (milestones) {
      this.validate(milestones.length > 0, 'milestones cannot be empty');
      const total = this.round(milestones.reduce((sum, m) => sum + m.amount, 0));
      this.validate(total === amount, 'Milestone amounts must sum to the order amount');
    }

    const now = this.now();
    const order: MarketplaceOrder = {
      id: `mko_${randomUUID()}`,
      marketplaceId: input.marketplaceId,
      externalOrderId: input.externalOrderId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
      amount,
      currency: (input.currency ?? 'USD').toUpperCase(),
      platformFeePercent,
      platformFee: this.round((amount * platformFeePercent) / 100),
      sellerPayout: 0,
      refundedAmount: 0,
      status: 'created',
      milestones,
      inspectionPeriodMs: input.inspectionPeriodMs ?? DEFAULT_INSPECTION_PERIOD_MS,
      events: [{ type: 'order.created', at: new Date(now).toISOString() }],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };

    this.orders.set(order.id, order);
    return order;
  }

  getOrder(id: string): MarketplaceOrder | undefined {
    return this.orders.get(id);
  }

  listOrders(filter: {
    marketplaceId?: string;
    buyerId?: string;
    sellerId?: string;
    status?: MarketplaceOrderStatus;
    limit?: number;
    offset?: number;
  } = {}): { orders: MarketplaceOrder[]; total: number } {
    const all = Array.from(this.orders.values())
      .filter((o) => (!filter.marketplaceId || o.marketplaceId === filter.marketplaceId))
      .filter((o) => (!filter.buyerId || o.buyerId === filter.buyerId))
      .filter((o) => (!filter.sellerId || o.sellerId === filter.sellerId))
      .filter((o) => (!filter.status || o.status === filter.status))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const offset = filter.offset ?? 0;
    const limit = Math.min(filter.limit ?? 50, 100);
    return { orders: all.slice(offset, offset + limit), total: all.length };
  }

  // ---------------------------------------------------------------- lifecycle

  fundOrder(id: string, txHash: string): MarketplaceOrder {
    this.validate(!!txHash, 'txHash is required');
    const order = this.requireOrder(id);
    this.assertStatus(order, ['created'], 'fund');

    order.status = 'funded';
    order.fundingTxHash = txHash;
    this.touch(order, 'order.funded', { txHash });
    return order;
  }

  markShipped(id: string, trackingInfo?: string): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(order, ['funded'], 'ship');

    order.status = 'shipped';
    order.trackingInfo = trackingInfo;
    this.touch(order, 'order.shipped', trackingInfo ? { trackingInfo } : undefined);
    return order;
  }

  markDelivered(id: string): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(order, ['shipped'], 'deliver');

    const deliveredAt = this.now();
    order.status = 'delivered';
    order.deliveredAt = new Date(deliveredAt).toISOString();
    order.autoReleaseAt = new Date(deliveredAt + order.inspectionPeriodMs).toISOString();
    this.touch(order, 'order.delivered', { autoReleaseAt: order.autoReleaseAt });
    return order;
  }

  /** Release escrowed funds to the seller (minus the platform commission). */
  release(id: string, approvedBy = 'buyer'): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(order, ['funded', 'shipped', 'delivered'], 'release');

    order.status = 'released';
    order.sellerPayout = this.round(order.amount - order.platformFee);
    order.releasedAt = new Date(this.now()).toISOString();
    this.touch(order, 'order.released', { approvedBy, sellerPayout: order.sellerPayout });
    return order;
  }

  /** Release a single milestone, settling the order once every milestone is out. */
  releaseMilestone(id: string, milestoneId: string, approvedBy = 'buyer'): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(
      order,
      ['funded', 'shipped', 'delivered', 'partially_released'],
      'release milestones for',
    );
    this.validate(!!order.milestones?.length, 'Order has no milestones');
    this.validate(order.dispute === undefined, 'Cannot release milestones while a dispute is open');

    const milestone = order.milestones!.find((m) => m.id === milestoneId);
    if (!milestone) this.notFound('Milestone', milestoneId);
    if (milestone.status === 'released') this.conflict('Milestone has already been released');

    milestone.status = 'released';
    milestone.releasedAt = new Date(this.now()).toISOString();
    this.touch(order, 'order.milestone_released', { milestoneId, amount: milestone.amount, approvedBy });

    const allReleased = order.milestones!.every((m) => m.status === 'released');
    if (allReleased) {
      order.status = 'released';
      order.sellerPayout = this.round(order.amount - order.platformFee);
      order.releasedAt = new Date(this.now()).toISOString();
      this.touch(order, 'order.released', { sellerPayout: order.sellerPayout });
    } else {
      order.status = 'partially_released';
    }

    return order;
  }

  /** Auto-release once the buyer inspection window has elapsed. */
  autoRelease(id: string): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(order, ['delivered'], 'auto-release');
    const autoReleaseAt = order.autoReleaseAt;
    if (!autoReleaseAt) this.conflict('Order has no auto-release schedule');
    this.validate(
      this.now() >= new Date(autoReleaseAt).getTime(),
      'Inspection window has not elapsed yet',
    );

    order.status = 'released';
    order.sellerPayout = this.round(order.amount - order.platformFee);
    order.releasedAt = new Date(this.now()).toISOString();
    this.touch(order, 'order.auto_released', { sellerPayout: order.sellerPayout });
    return order;
  }

  // ---------------------------------------------------------------- protection

  raiseDispute(id: string, input: { raisedBy: string; reason: string }): MarketplaceOrder {
    this.validate(!!input.raisedBy, 'raisedBy is required');
    this.validate(!!input.reason, 'reason is required');

    const order = this.requireOrder(id);
    this.assertStatus(order, ['funded', 'shipped', 'delivered', 'partially_released'], 'dispute');
    if (![order.buyerId, order.sellerId].includes(input.raisedBy)) {
      this.forbidden('Only the buyer or seller can raise a dispute');
    }

    order.status = 'disputed';
    order.dispute = {
      raisedBy: input.raisedBy,
      reason: input.reason,
      raisedAt: new Date(this.now()).toISOString(),
    };
    this.touch(order, 'order.disputed', { raisedBy: input.raisedBy, reason: input.reason });
    return order;
  }

  resolveDispute(
    id: string,
    input: { resolution: 'buyer' | 'seller' | 'split'; buyerPercent?: number; approvedBy: string },
  ): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(order, ['disputed'], 'resolve');
    this.validate(!!input.approvedBy, 'approvedBy is required');

    const resolution = input.resolution;
    let platformFee = order.platformFee;
    let buyerRefund = 0;
    let sellerPayout = 0;

    if (resolution === 'buyer') {
      platformFee = 0;
      buyerRefund = order.amount;
    } else if (resolution === 'seller') {
      sellerPayout = this.round(order.amount - order.platformFee);
    } else {
      const buyerPercent = input.buyerPercent ?? 50;
      this.validate(
        buyerPercent >= 0 && buyerPercent <= 100,
        'buyerPercent must be between 0 and 100',
      );
      // Commission applies only to the portion that reaches the seller.
      const distributable = this.round(order.amount - order.platformFee);
      buyerRefund = this.round((distributable * buyerPercent) / 100);
      sellerPayout = this.round(distributable - buyerRefund);
    }

    order.platformFee = platformFee;
    order.refundedAmount = buyerRefund;
    order.sellerPayout = sellerPayout;
    order.dispute = {
      ...order.dispute!,
      resolution,
      buyerPercent: resolution === 'split' ? input.buyerPercent ?? 50 : undefined,
      resolvedAt: new Date(this.now()).toISOString(),
    };

    if (resolution === 'buyer') {
      order.status = 'refunded';
      order.refundedAt = new Date(this.now()).toISOString();
    } else if (resolution === 'split') {
      order.status = 'partially_released';
    } else {
      order.status = 'released';
    }
    order.releasedAt = new Date(this.now()).toISOString();

    this.touch(order, 'order.dispute_resolved', { resolution, buyerRefund, sellerPayout });
    return order;
  }

  refund(id: string, reason: string): MarketplaceOrder {
    this.validate(!!reason, 'Refund reason is required');
    const order = this.requireOrder(id);
    this.assertStatus(order, ['funded', 'shipped', 'delivered'], 'refund');

    order.status = 'refunded';
    order.platformFee = 0;
    order.sellerPayout = 0;
    order.refundedAmount = order.amount;
    order.refundedAt = new Date(this.now()).toISOString();
    this.touch(order, 'order.refunded', { reason });
    return order;
  }

  cancelOrder(id: string): MarketplaceOrder {
    const order = this.requireOrder(id);
    this.assertStatus(order, ['created'], 'cancel');

    order.status = 'cancelled';
    order.cancelledAt = new Date(this.now()).toISOString();
    this.touch(order, 'order.cancelled');
    return order;
  }

  // ---------------------------------------------------------------- reporting

  getPayoutBreakdown(id: string): PayoutBreakdown {
    const order = this.requireOrder(id);
    const releasedMilestoneAmount = this.round(
      (order.milestones ?? [])
        .filter((m) => m.status === 'released')
        .reduce((sum, m) => sum + m.amount, 0),
    );

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      platformFee: order.platformFee,
      sellerPayout: order.sellerPayout,
      buyerRefund: order.refundedAmount,
      releasedMilestoneAmount,
      status: order.status,
    };
  }

  getSettlementSummary(marketplaceId: string): {
    marketplaceId: string;
    orderCount: number;
    escrowedVolume: number;
    platformFeesCollected: number;
    sellerPayouts: number;
    buyerRefunds: number;
    currency: string;
  } {
    const orders = this.listOrders({ marketplaceId, limit: 100 }).orders;
    const settled = orders.filter((o) => ['released', 'partially_released'].includes(o.status));
    const refunded = orders.filter((o) => o.status === 'refunded');

    return {
      marketplaceId,
      orderCount: orders.length,
      escrowedVolume: this.round(settled.reduce((sum, o) => sum + o.amount, 0)),
      platformFeesCollected: this.round(settled.reduce((sum, o) => sum + o.platformFee, 0)),
      sellerPayouts: this.round(settled.reduce((sum, o) => sum + o.sellerPayout, 0)),
      buyerRefunds: this.round(
        refunded.reduce((sum, o) => sum + o.refundedAmount, 0) +
          settled.reduce((sum, o) => sum + o.refundedAmount, 0),
      ),
      currency: orders[0]?.currency ?? 'USD',
    };
  }

  resetForTests(): void {
    this.orders.clear();
  }

  // --------------------------------------------------------------- internals

  private requireOrder(id: string): MarketplaceOrder {
    const order = this.orders.get(id);
    if (!order) this.notFound('Marketplace order', id);
    return order;
  }

  private assertStatus(order: MarketplaceOrder, allowed: MarketplaceOrderStatus[], action: string): void {
    if (!allowed.includes(order.status)) {
      this.conflict(`Cannot ${action} an order in status ${order.status}`);
    }
  }

  private touch(order: MarketplaceOrder, type: string, details?: Record<string, unknown>): void {
    const at = new Date(this.now()).toISOString();
    order.events.push({ type, at, details });
    order.updatedAt = at;
    this.orders.set(order.id, order);
  }

  private round(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}

export const marketplaceEscrowService = new MarketplaceEscrowService();
