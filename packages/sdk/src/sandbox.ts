import { AgenticPayClient } from './client.js';

export type SandboxStatus = {
  healthy: boolean;
  stellarTestnet: boolean;
  mockPayments: boolean;
  faucetBalance: number;
};

export type SandboxPaymentInput = {
  from: string;
  to: string;
  amount: number;
  currency: string;
  memo?: string;
};

export type SandboxPaymentResult = {
  transactionHash: string;
  status: 'success';
  ledger: number;
  timestamp: string;
};

export class SandboxApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** Get sandbox environment status. */
  getStatus() {
    return this.client.get<SandboxStatus>('/sandbox/status');
  }

  /** Process a mock payment (sandbox only). */
  processPayment(input: SandboxPaymentInput) {
    return this.client.post<SandboxPaymentResult>('/sandbox/payments/process', input);
  }

  /** Request test tokens from the faucet. */
  requestFaucet(accountId: string) {
    return this.client.post<{ transactionHash: string; amount: number }>(
      '/sandbox/faucet',
      { accountId },
    );
  }

  /** Reset sandbox state. */
  reset() {
    return this.client.post<{ success: boolean }>('/sandbox/reset');
  }
}
