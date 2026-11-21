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

export const SANDBOX_MOCK_PAYMENTS: SandboxPaymentResult[] = [
  {
    transactionHash: 'mock_tx_0001',
    status: 'success',
    ledger: 1_000_001,
    timestamp: '2026-01-01T00:00:00.000Z',
  },
  {
    transactionHash: 'mock_tx_0002',
    status: 'success',
    ledger: 1_000_002,
    timestamp: '2026-01-02T00:00:00.000Z',
  },
];

/** Build a deterministic mock payment result for offline sandbox tests. */
export function createMockPaymentResult(input: SandboxPaymentInput, ledger = 1_000_000): SandboxPaymentResult {
  return {
    transactionHash: `mock_${input.from}_${input.to}_${input.amount}_${input.currency}`,
    status: 'success',
    ledger,
    timestamp: new Date(0).toISOString(),
  };
}

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
