import { AgenticPayClient } from './client.js';
import { SplitConfigInput, SplitExecutionInput } from './types.js';

export class PaymentsApi {
  constructor(private readonly client: AgenticPayClient) {}

  createSplitConfig(input: SplitConfigInput) {
    return this.client.post('/splits', input);
  }

  listMerchantSplits(merchantId: string) {
    return this.client.get(`/splits/merchant/${merchantId}`);
  }

  updateSplitConfig(splitId: string, patch: Partial<Pick<SplitConfigInput, 'recipients' | 'platformFeePercentage'>>) {
    return this.client.patch(`/splits/${splitId}`, patch);
  }

  executeSplit(input: SplitExecutionInput) {
    return this.client.post(`/splits/${input.splitId}/execute`, {
      paymentId: input.paymentId,
      totalAmount: input.totalAmount,
      currency: input.currency,
    });
  }

  getSplitAnalytics(splitId: string) {
    return this.client.get(`/splits/${splitId}/analytics`);
  }
}
