/**
 * Issue #1016: Add SAR/bank-transfer settlement rail
 * 
 * SAR (Saudi Riyal) bank transfer settlement rail implementation
 * Conforms to the PayoutExecutor interface for seamless integration
 */

import type { PayoutExecutionRequest, PayoutExecutionResult } from '../payouts/payout-engine.js';
import { randomUUID } from 'node:crypto';

export interface SARBankAccount {
  accountNumber: string;
  iban: string;
  bankCode: string;
  bankName: string;
  accountHolderName: string;
  swiftCode?: string;
}

export interface SARTransferConfig {
  /** API endpoint for the SAR banking provider */
  apiEndpoint: string;
  /** API key for authentication */
  apiKey: string;
  /** Timeout for transfer requests in milliseconds */
  timeoutMs?: number;
  /** Enable sandbox mode for testing */
  sandboxMode?: boolean;
}

export interface SARTransferRequest {
  idempotencyKey: string;
  amount: number;
  currency: 'SAR';
  recipient: SARBankAccount;
  reference: string;
  merchantId: string;
}

export interface SARTransferResponse {
  transactionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  completedAt?: Date;
  errorCode?: string;
  errorMessage?: string;
}

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * SAR Bank Transfer Settlement Rail
 * Implements PayoutExecutor interface for bank transfers in Saudi Riyals
 */
export class SARBankTransferRail {
  private config: Required<SARTransferConfig>;
  private pendingTransfers: Map<string, SARTransferResponse>;

  constructor(config: SARTransferConfig) {
    this.config = {
      ...config,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      sandboxMode: config.sandboxMode ?? false,
    };
    this.pendingTransfers = new Map();
  }

  /**
   * Execute a payout via SAR bank transfer
   * Conforms to PayoutExecutor interface
   */
  async execute(request: PayoutExecutionRequest): Promise<PayoutExecutionResult> {
    // Validate currency (SAR only for this rail)
    if (request.asset !== 'SAR') {
      throw new Error(`SAR bank transfer rail only supports SAR currency, got ${request.asset}`);
    }

    // Check for existing transfer with same idempotency key (deduplication)
    const existing = this.pendingTransfers.get(request.idempotencyKey);
    if (existing && existing.status === 'completed') {
      return {
        transactionHash: existing.transactionId,
        settledAt: existing.completedAt,
      };
    }

    // Prepare transfer request
    const transferRequest: SARTransferRequest = {
      idempotencyKey: request.idempotencyKey,
      amount: request.amount,
      currency: 'SAR',
      recipient: await this.resolveBankAccount(request.merchantId),
      reference: `Payout-${request.batchId}`,
      merchantId: request.merchantId,
    };

    // Execute transfer
    const response = await this.executeTransfer(transferRequest);

    // Store in pending transfers
    this.pendingTransfers.set(request.idempotencyKey, response);

    // Return result
    return {
      transactionHash: response.transactionId,
      settledAt: response.completedAt,
    };
  }

  /**
   * Execute the actual bank transfer via provider API
   */
  private async executeTransfer(request: SARTransferRequest): Promise<SARTransferResponse> {
    if (this.config.sandboxMode) {
      // Sandbox mode: simulate successful transfer
      return this.simulateSandboxTransfer(request);
    }

    // Production mode: call actual banking API
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.apiEndpoint}/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Idempotency-Key': request.idempotencyKey,
        },
        body: JSON.stringify({
          amount: request.amount,
          currency: request.currency,
          recipient: request.recipient,
          reference: request.reference,
          merchantId: request.merchantId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Transfer failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      return {
        transactionId: data.transactionId,
        status: data.status,
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
        errorCode: data.errorCode,
        errorMessage: data.errorMessage,
      };
    } catch (error) {
      clearTimeout(timeout);
      
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Transfer request timed out after ${this.config.timeoutMs}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Simulate a sandbox transfer for testing
   */
  private simulateSandboxTransfer(request: SARTransferRequest): SARTransferResponse {
    const transactionId = `sandbox_sar_${randomUUID()}`;
    
    return {
      transactionId,
      status: 'completed',
      completedAt: new Date(),
    };
  }

  /**
   * Resolve merchant's bank account details
   * In production, this would query from database
   */
  private async resolveBankAccount(merchantId: string): Promise<SARBankAccount> {
    // TODO: Query actual bank account from merchant settings
    // For now, return a placeholder
    return {
      accountNumber: '1234567890',
      iban: `SA${merchantId.slice(0, 22).padEnd(22, '0')}`,
      bankCode: '80',
      bankName: 'Saudi National Bank',
      accountHolderName: 'Merchant Account',
      swiftCode: 'NCBKSAJE',
    };
  }

  /**
   * Check status of a transfer
   */
  async getTransferStatus(idempotencyKey: string): Promise<SARTransferResponse | null> {
    return this.pendingTransfers.get(idempotencyKey) ?? null;
  }

  /**
   * List all pending transfers
   */
  getPendingTransfers(): SARTransferResponse[] {
    return Array.from(this.pendingTransfers.values()).filter(
      (transfer) => transfer.status === 'pending' || transfer.status === 'processing'
    );
  }
}

/**
 * Factory function to create a SAR bank transfer executor
 */
export function createSARBankTransferExecutor(config: SARTransferConfig) {
  const rail = new SARBankTransferRail(config);
  
  return async (request: PayoutExecutionRequest): Promise<PayoutExecutionResult> => {
    return rail.execute(request);
  };
}
