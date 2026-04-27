import { AgenticPayClient } from './client.js';
import { RefundEvaluationInput, RefundPolicyInput } from './types.js';

export class RefundsApi {
  constructor(private readonly client: AgenticPayClient) {}

  setPolicy(input: RefundPolicyInput) {
    return this.client.post('/refunds/policies', input);
  }

  getPolicy(merchantId: string) {
    return this.client.get(`/refunds/policies/${merchantId}`);
  }

  evaluate(input: RefundEvaluationInput) {
    return this.client.post('/refunds/evaluate', {
      hasChargeback: false,
      hasDispute: false,
      ...input,
    });
  }

  listManualReview(merchantId?: string) {
    const suffix = merchantId ? `?merchantId=${encodeURIComponent(merchantId)}` : '';
    return this.client.get(`/refunds/manual-review${suffix}`);
  }

  resolveManualReview(reviewId: string, status: 'approved' | 'rejected') {
    return this.client.patch(`/refunds/manual-review/${reviewId}`, { status });
  }
}
