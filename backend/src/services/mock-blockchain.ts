// Mock Blockchain Service for Sandbox
// Simulates Stellar blockchain operations without real on-chain costs

import { randomUUID } from 'node:crypto';

export interface MockTransactionRequest {
  fromAddress: string;
  toAddress: string;
  amount: number;
  currency?: string;
  memo?: string;
}

export interface MockTransactionResult {
  txHash: string;
  status: 'success' | 'pending' | 'failed';
  fromAddress: string;
  toAddress: string;
  amount: number;
  currency: string;
  ledger: number;
  fee: number;
  createdAt: number;
  confirmedAt?: number;
  mockData: boolean;
}

export interface MockAccountInfo {
  address: string;
  balance: number;
  sequence: number;
  numSubentries: number;
  inflationDest?: string;
  flags: {
    authRequired: boolean;
    authRevocable: boolean;
    authImmutable: boolean;
  };
}

export class MockBlockchainService {
  private accounts: Map<string, MockAccountInfo> = new Map();
  private transactions: Map<string, MockTransactionResult> = new Map();
  private ledgerSequence: number = 1;
  private failureRate: number = 0.02; // 2% failure rate for testing
  private confirmationDelayMs: number = 2000; // 2 second confirmation time

  constructor(failureRate: number = 0.02) {
    this.failureRate = Math.max(0, Math.min(1, failureRate));
  }

  /**
   * Create a mock account with initial balance
   */
  createAccount(address: string, initialBalance: number = 10000): MockAccountInfo {
    const account: MockAccountInfo = {
      address,
      balance: initialBalance,
      sequence: 0,
      numSubentries: 0,
      flags: {
        authRequired: false,
        authRevocable: false,
        authImmutable: false,
      },
    };

    this.accounts.set(address, account);
    return account;
  }

  /**
   * Get account information
   */
  getAccount(address: string): MockAccountInfo | null {
    return this.accounts.get(address) || null;
  }

  /**
   * Get account balance
   */
  getBalance(address: string): number {
    const account = this.accounts.get(address);
    return account ? account.balance : 0;
  }

  /**
   * Set account balance (for testing)
   */
  setBalance(address: string, balance: number): void {
    const account = this.accounts.get(address);
    if (account) {
      account.balance = balance;
    }
  }

  /**
   * Submit a mock transaction
   */
  async submitTransaction(request: MockTransactionRequest): Promise<MockTransactionResult> {
    const { fromAddress, toAddress, amount, currency = 'XLM', memo } = request;

    // Validate sender has sufficient balance
    const sender = this.accounts.get(fromAddress);
    if (!sender) {
      throw new Error(`Account ${fromAddress} not found`);
    }

    const fee = 0.00001; // Standard Stellar fee
    const totalAmount = amount + fee;

    if (sender.balance < totalAmount) {
      throw new Error(`Insufficient balance. Required: ${totalAmount}, Available: ${sender.balance}`);
    }

    // Randomly determine if transaction fails (for testing failure scenarios)
    const shouldFail = Math.random() < this.failureRate;
    const status: 'success' | 'pending' | 'failed' = shouldFail ? 'failed' : 'pending';

    const txHash = this.generateTxHash();
    const result: MockTransactionResult = {
      txHash,
      status,
      fromAddress,
      toAddress,
      amount,
      currency,
      ledger: this.ledgerSequence,
      fee,
      createdAt: Date.now(),
      mockData: true,
    };

    // Deduct from sender balance
    if (!shouldFail) {
      sender.balance -= totalAmount;
      sender.sequence += 1;

      // Add to recipient
      const recipient = this.accounts.get(toAddress);
      if (recipient) {
        recipient.balance += amount;
      }
    }

    this.transactions.set(txHash, result);

    // Simulate async confirmation
    if (!shouldFail) {
      this.simulateConfirmation(txHash);
    }

    return result;
  }

  /**
   * Get transaction status
   */
  getTransaction(txHash: string): MockTransactionResult | null {
    return this.transactions.get(txHash) || null;
  }

  /**
   * Simulate transaction confirmation
   */
  private async simulateConfirmation(txHash: string): Promise<void> {
    setTimeout(() => {
      const tx = this.transactions.get(txHash);
      if (tx && tx.status === 'pending') {
        tx.status = 'success';
        tx.confirmedAt = Date.now();
        this.ledgerSequence += 1;
      }
    }, this.confirmationDelayMs);
  }

  /**
   * Get ledger info
   */
  getLedgerInfo(): {
    sequence: number;
    timestamp: number;
    baseFee: number;
    baseReserve: number;
  } {
    return {
      sequence: this.ledgerSequence,
      timestamp: Date.now(),
      baseFee: 100, // 100 stroops
      baseReserve: 0.5, // 0.5 XLM
    };
  }

  /**
   * Simulate funding an account (like friendbot)
   */
  fundAccount(address: string, amount: number = 10000): MockAccountInfo {
    let account = this.accounts.get(address);
    
    if (!account) {
      account = this.createAccount(address, 0);
    }

    account.balance += amount;
    return account;
  }

  /**
   * Get network statistics
   */
  getNetworkStats(): {
    totalAccounts: number;
    totalTransactions: number;
    currentLedger: number;
    failureRate: number;
  } {
    return {
      totalAccounts: this.accounts.size,
      totalTransactions: this.transactions.size,
      currentLedger: this.ledgerSequence,
      failureRate: this.failureRate,
    };
  }

  /**
   * Set failure rate for testing
   */
  setFailureRate(rate: number): void {
    this.failureRate = Math.max(0, Math.min(1, rate));
  }

  /**
   * Set confirmation delay for testing
   */
  setConfirmationDelay(delayMs: number): void {
    this.confirmationDelayMs = delayMs;
  }

  /**
   * Clear all mock data
   */
  clear(): void {
    this.accounts.clear();
    this.transactions.clear();
    this.ledgerSequence = 1;
  }

  /**
   * Generate a mock transaction hash
   */
  private generateTxHash(): string {
    const chars = '0123456789abcdef';
    let hash = '';
    for (let i = 0; i < 64; i++) {
      hash += chars[Math.floor(Math.random() * chars.length)];
    }
    return hash;
  }

  /**
   * Simulate account merge operation
   */
  async mergeAccount(sourceAddress: string, destinationAddress: string): Promise<MockTransactionResult> {
    const source = this.accounts.get(sourceAddress);
    const dest = this.accounts.get(destinationAddress);

    if (!source) {
      throw new Error(`Source account ${sourceAddress} not found`);
    }
    if (!dest) {
      throw new Error(`Destination account ${destinationAddress} not found`);
    }

    const amount = source.balance;
    const txHash = this.generateTxHash();

    const result: MockTransactionResult = {
      txHash,
      status: 'success',
      fromAddress: sourceAddress,
      toAddress: destinationAddress,
      amount,
      currency: 'XLM',
      ledger: this.ledgerSequence,
      fee: 0.00001,
      createdAt: Date.now(),
      confirmedAt: Date.now(),
      mockData: true,
    };

    // Transfer balance
    dest.balance += amount;
    this.accounts.delete(sourceAddress);

    this.transactions.set(txHash, result);
    this.ledgerSequence += 1;

    return result;
  }
}

export default MockBlockchainService;
