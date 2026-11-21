import { AgenticPayClient } from './client.js';

export type StellarNetwork = 'testnet' | 'public';

export type StellarTransaction = {
  hash: string;
  status: 'pending' | 'success' | 'failed';
  ledger: number;
  createdAt: string;
  sourceAccount: string;
  fee: number;
  operationCount: number;
  memo?: string;
};

export type StellarPayment = {
  id: string;
  transactionHash: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
  createdAt: string;
  status: 'pending' | 'success' | 'failed';
};

export class StellarApi {
  constructor(private readonly client: AgenticPayClient) {}

  /** Get payment status by transaction hash. */
  getPayment(transactionHash: string) {
    return this.client.get<StellarPayment>(`/stellar/payment/${transactionHash}`);
  }

  /** Get transaction details by hash. */
  getTransaction(transactionHash: string) {
    return this.client.get<StellarTransaction>(`/stellar/transaction/${transactionHash}`);
  }

  /** List transactions for an account. */
  listTransactions(account: string, params?: { limit?: number; order?: 'asc' | 'desc' }) {
    const query = new URLSearchParams({ account });
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.order) query.set('order', params.order);
    return this.client.get<StellarTransaction[]>(`/stellar/transactions?${query.toString()}`);
  }

  /** Get network status. */
  getNetworkStatus(network?: StellarNetwork) {
    const suffix = network ? `?network=${network}` : '';
    return this.client.get<{ network: StellarNetwork; healthy: boolean; ledger: number }>(
      `/stellar/status${suffix}`,
    );
  }
}
