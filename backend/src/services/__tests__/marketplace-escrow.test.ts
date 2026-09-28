import { beforeEach, describe, expect, it } from 'vitest';
import { MarketplaceEscrowService } from '../marketplace-escrow.js';

describe('MarketplaceEscrowService — marketplace escrow workflows (#915)', () => {
  let service: MarketplaceEscrowService;
  let now: number;

  const baseOrder = {
    marketplaceId: 'mp_1',
    externalOrderId: 'order-1001',
    buyerId: 'buyer_1',
    sellerId: 'seller_1',
    amount: 200,
    platformFeePercent: 10,
  };

  beforeEach(() => {
    now = new Date('2026-03-01T00:00:00.000Z').getTime();
    service = new MarketplaceEscrowService(() => now);
  });

  const expectError = (fn: () => unknown, statusCode: number, message?: RegExp) => {
    try {
      fn();
      throw new Error('Expected function to throw');
    } catch (err) {
      const error = err as Error & { statusCode?: number };
      expect(error.statusCode).toBe(statusCode);
      if (message) expect(error.message).toMatch(message);
    }
  };

  const fundedOrder = (overrides: Record<string, unknown> = {}) => {
    const order = service.createOrder({ ...baseOrder, ...overrides });
    service.fundOrder(order.id, 'tx_abc');
    return order;
  };

  describe('order creation', () => {
    it('creates an order with platform fee and escrow status', () => {
      const order = service.createOrder(baseOrder);
      expect(order.status).toBe('created');
      expect(order.platformFee).toBe(20);
      expect(order.sellerPayout).toBe(0);
      expect(order.currency).toBe('USD');
      expect(order.events[0].type).toBe('order.created');
    });

    it('rejects an order where buyer equals seller', () => {
      expectError(
        () => service.createOrder({ ...baseOrder, sellerId: 'buyer_1' }),
        400,
        /must be different/,
      );
    });

    it('rejects a non-positive amount', () => {
      expectError(() => service.createOrder({ ...baseOrder, amount: 0 }), 400, /greater than 0/);
    });

    it('rejects an out-of-range platform fee', () => {
      expectError(
        () => service.createOrder({ ...baseOrder, platformFeePercent: 150 }),
        400,
        /between 0 and 100/,
      );
    });

    it('validates that milestones sum to the order amount', () => {
      expectError(
        () =>
          service.createOrder({
            ...baseOrder,
            milestones: [
              { name: 'Design', amount: 50 },
              { name: 'Build', amount: 100 },
            ],
          }),
        400,
        /must sum to the order amount/,
      );
    });
  });

  describe('happy path lifecycle', () => {
    it('runs created → funded → shipped → delivered → released', () => {
      const order = fundedOrder();
      expect(service.getOrder(order.id)!.status).toBe('funded');

      expect(service.markShipped(order.id, 'TRACK123').status).toBe('shipped');
      const delivered = service.markDelivered(order.id);
      expect(delivered.status).toBe('delivered');
      expect(delivered.trackingInfo).toBe('TRACK123');
      expect(delivered.autoReleaseAt).toBeTruthy();

      const released = service.release(order.id, 'buyer_1');
      expect(released.status).toBe('released');
      expect(released.sellerPayout).toBe(180);
    });

    it('records an audit trail of lifecycle events', () => {
      const order = fundedOrder();
      service.markShipped(order.id);
      service.markDelivered(order.id);
      service.release(order.id);

      const types = service.getOrder(order.id)!.events.map((e) => e.type);
      expect(types).toEqual([
        'order.created',
        'order.funded',
        'order.shipped',
        'order.delivered',
        'order.released',
      ]);
    });
  });

  describe('state machine guards', () => {
    it('cannot fund twice', () => {
      const order = fundedOrder();
      expectError(() => service.fundOrder(order.id, 'tx_2'), 409, /Cannot fund/);
    });

    it('cannot ship before funding', () => {
      const order = service.createOrder(baseOrder);
      expectError(() => service.markShipped(order.id), 409, /Cannot ship/);
    });

    it('cannot deliver before shipping', () => {
      const order = fundedOrder();
      expectError(() => service.markDelivered(order.id), 409, /Cannot deliver/);
    });

    it('cannot release a disputed order', () => {
      const order = fundedOrder();
      service.raiseDispute(order.id, { raisedBy: 'buyer_1', reason: 'damaged' });
      expectError(() => service.release(order.id), 409, /Cannot release/);
    });

    it('reports an unknown order', () => {
      expectError(() => service.release('ghost'), 404, /Marketplace order not found/);
    });
  });

  describe('auto-release', () => {
    it('releases once the inspection window elapses', () => {
      const order = fundedOrder({ inspectionPeriodMs: 1000 });
      service.markShipped(order.id);
      service.markDelivered(order.id);

      expectError(() => service.autoRelease(order.id), 400, /has not elapsed/);

      now += 1000;
      const released = service.autoRelease(order.id);
      expect(released.status).toBe('released');
      expect(released.sellerPayout).toBe(180);
    });
  });

  describe('milestones', () => {
    const milestoneOrder = () =>
      fundedOrder({
        milestones: [
          { id: 'ms_1', name: 'Design', amount: 80 },
          { id: 'ms_2', name: 'Build', amount: 120 },
        ],
      });

    it('releases individual milestones and settles when all are out', () => {
      const order = milestoneOrder();

      const partial = service.releaseMilestone(order.id, 'ms_1');
      expect(partial.status).toBe('partially_released');
      expect(service.getPayoutBreakdown(order.id).releasedMilestoneAmount).toBe(80);

      const complete = service.releaseMilestone(order.id, 'ms_2');
      expect(complete.status).toBe('released');
      expect(complete.sellerPayout).toBe(180);
    });

    it('rejects an unknown milestone', () => {
      const order = milestoneOrder();
      expectError(() => service.releaseMilestone(order.id, 'ms_missing'), 404, /Milestone not found/);
    });

    it('rejects releasing the same milestone twice', () => {
      const order = milestoneOrder();
      service.releaseMilestone(order.id, 'ms_1');
      expectError(() => service.releaseMilestone(order.id, 'ms_1'), 409, /already been released/);
    });

    it('rejects milestones on an order without them', () => {
      const order = fundedOrder();
      expectError(() => service.releaseMilestone(order.id, 'ms_1'), 400, /no milestones/);
    });
  });

  describe('disputes and buyer protection', () => {
    it('refunds the buyer when resolved in their favour', () => {
      const order = fundedOrder();
      service.raiseDispute(order.id, { raisedBy: 'buyer_1', reason: 'never arrived' });

      const resolved = service.resolveDispute(order.id, { resolution: 'buyer', approvedBy: 'arbiter' });
      expect(resolved.status).toBe('refunded');
      expect(resolved.refundedAmount).toBe(200);
      expect(resolved.sellerPayout).toBe(0);
      expect(resolved.platformFee).toBe(0);
    });

    it('pays the seller when resolved in their favour', () => {
      const order = fundedOrder();
      service.raiseDispute(order.id, { raisedBy: 'seller_1', reason: 'delivered as agreed' });

      const resolved = service.resolveDispute(order.id, { resolution: 'seller', approvedBy: 'arbiter' });
      expect(resolved.status).toBe('released');
      expect(resolved.sellerPayout).toBe(180);
      expect(resolved.platformFee).toBe(20);
    });

    it('splits funds between buyer and seller', () => {
      const order = fundedOrder();
      service.raiseDispute(order.id, { raisedBy: 'buyer_1', reason: 'partial damage' });

      const resolved = service.resolveDispute(order.id, {
        resolution: 'split',
        buyerPercent: 25,
        approvedBy: 'arbiter',
      });

      // distributable = 180, buyer 25% = 45, seller = 135
      expect(resolved.status).toBe('partially_released');
      expect(resolved.refundedAmount).toBe(45);
      expect(resolved.sellerPayout).toBe(135);
    });

    it('rejects a swap-resolve of an order without a dispute', () => {
      const order = fundedOrder();
      expectError(
        () => service.resolveDispute(order.id, { resolution: 'buyer', approvedBy: 'arbiter' }),
        409,
        /Cannot resolve/,
      );
    });

    it('blocks third parties from raising a dispute', () => {
      const order = fundedOrder();
      expectError(
        () => service.raiseDispute(order.id, { raisedBy: 'random_user', reason: 'nope' }),
        403,
        /Only the buyer or seller/,
      );
    });

    it('validates the split percentage', () => {
      const order = fundedOrder();
      service.raiseDispute(order.id, { raisedBy: 'buyer_1', reason: 'x' });
      expectError(
        () => service.resolveDispute(order.id, { resolution: 'split', buyerPercent: 120, approvedBy: 'a' }),
        400,
        /between 0 and 100/,
      );
    });
  });

  describe('refunds and cancellation', () => {
    it('refunds a funded order', () => {
      const order = fundedOrder();
      const refunded = service.refund(order.id, 'out of stock');
      expect(refunded.status).toBe('refunded');
      expect(refunded.refundedAmount).toBe(200);
      expect(refunded.platformFee).toBe(0);
    });

    it('requires a refund reason', () => {
      const order = fundedOrder();
      expectError(() => service.refund(order.id, ''), 400, /reason is required/);
    });

    it('cancels an unfunded order only', () => {
      const order = service.createOrder(baseOrder);
      expect(service.cancelOrder(order.id).status).toBe('cancelled');

      const funded = fundedOrder();
      expectError(() => service.cancelOrder(funded.id), 409, /Cannot cancel/);
    });
  });

  describe('reporting', () => {
    it('lists orders with filters and pagination', () => {
      const first = fundedOrder();
      fundedOrder({ externalOrderId: 'order-1002', buyerId: 'buyer_2' });
      service.release(first.id);

      expect(service.listOrders({ marketplaceId: 'mp_1' }).total).toBe(2);
      expect(service.listOrders({ status: 'released' }).total).toBe(1);
      expect(service.listOrders({ buyerId: 'buyer_2' }).total).toBe(1);
      expect(service.listOrders({ limit: 1 }).orders).toHaveLength(1);
    });

    it('summarizes marketplace settlements', () => {
      const released = fundedOrder();
      service.release(released.id);

      const refunded = fundedOrder({ externalOrderId: 'order-1003' });
      service.refund(refunded.id, 'damaged');

      const summary = service.getSettlementSummary('mp_1');
      expect(summary.orderCount).toBe(2);
      expect(summary.escrowedVolume).toBe(200);
      expect(summary.platformFeesCollected).toBe(20);
      expect(summary.sellerPayouts).toBe(180);
      expect(summary.buyerRefunds).toBe(200);
    });

    it('reports the payout breakdown', () => {
      const order = fundedOrder();
      service.release(order.id);
      expect(service.getPayoutBreakdown(order.id)).toMatchObject({
        amount: 200,
        platformFee: 20,
        sellerPayout: 180,
        status: 'released',
      });
    });

    it('clears state between tests', () => {
      fundedOrder();
      service.resetForTests();
      expect(service.listOrders().total).toBe(0);
    });
  });
});
