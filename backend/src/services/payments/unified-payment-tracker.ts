import { prisma } from '../../lib/prisma.js';
import { BaseService } from '../BaseService.js';
import type { Result } from '../../lib/result.js';
import { providerPaymentRouter } from './payment-router.js';
import type { PaymentInput, PaymentOutput } from './providers/types.js';

/**
 * Persists a strategy-agnostic record of every payment in the `payments`
 * table (`providerId` + `txHash` columns), regardless of which
 * PaymentProvider strategy actually executed it. This is the single place
 * to query "all payments" across Stellar, EVM, fiat, and credit strategies.
 */
export class UnifiedPaymentTracker extends BaseService {
  async routeAndTrack(input: PaymentInput, preferredProviderId?: string): Promise<Result<PaymentOutput>> {
    const result = await providerPaymentRouter.route(input, preferredProviderId);

    if (result.ok) {
      await prisma.payment.create({
        data: {
          tenantId: input.tenantId,
          txHash: result.value.txHash,
          amount: input.amount,
          currency: input.currency,
          network: result.value.network,
          providerId: result.value.providerId,
          fromAddress: input.fromAddress,
          toAddress: input.toAddress,
          status: result.value.status === 'confirmed' ? 'completed' : 'pending',
          metadata: input.metadata as any,
        },
      });
    }

    return result;
  }

  /** Refresh a tracked payment's status by asking its owning strategy. */
  async syncStatus(paymentId: string): Promise<Result<{ status: string }>> {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.providerId || !payment.txHash) {
      return this.fail('Payment has no provider/tx to sync', 400, 'PAYMENT_NOT_TRACKED');
    }

    const { providerRegistry } = await import('./provider-registry.js');
    const provider = providerRegistry.get(payment.providerId);
    if (!provider) {
      return this.fail(`Unknown provider: ${payment.providerId}`, 404, 'PROVIDER_NOT_FOUND');
    }

    const statusResult = await provider.getStatus(payment.txHash);
    if (!statusResult.ok) return statusResult;

    const status = statusResult.value.status === 'confirmed' ? 'completed' : statusResult.value.status;
    await prisma.payment.update({ where: { id: paymentId }, data: { status: status as any } });
    return this.ok({ status });
  }

  /** Unified view across all strategies for a tenant. */
  async listByTenant(tenantId: string, limit = 50) {
    return prisma.payment.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

export const unifiedPaymentTracker = new UnifiedPaymentTracker();
