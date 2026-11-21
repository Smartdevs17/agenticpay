import { AgenticPayClient } from './client.js';
import { InvoiceRequest, VerificationRequest } from './types.js';

export class VerificationApi {
  constructor(private readonly client: AgenticPayClient) {}

  verifyWork(input: VerificationRequest) {
    return this.client.post('/verification/verify', input);
  }

  verifyWorkBatch(items: VerificationRequest[]) {
    return this.client.post('/verification/verify/batch', { items });
  }

  getVerification(id: string) {
    return this.client.get(`/verification/${id}`);
  }

  generateInvoice(input: InvoiceRequest) {
    return this.client.post('/invoice/generate', input);
  }
}
