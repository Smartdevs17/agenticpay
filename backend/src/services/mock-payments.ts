// Mock Payment Processing Service for Sandbox
// Simulates payment processing without real blockchain interactions

import { EventEmitter } from 'events';

export interface MockPaymentRequest {
  projectId: string;
  clientAddress: string;
  freelancerAddress: string;
  amount: number;
  currency: string;
  delay?: number;
}

export interface MockPaymentResult {
  transactionId: string;
  status: 'success' | 'pending' | 'failed';
  timestamp: number;
  confirmationTime?: number;
}

export class MockPaymentProcessor extends EventEmitter {
  private payments: Map<string, MockPaymentResult> = new Map();
  private paymentHistory: MockPaymentResult[] = [];
  private failureRate: number = 0; // 0-1

  constructor(failureRate: number = 0.05) {
    super();
    this.failureRate = Math.max(0, Math.min(1, failureRate));
  }

  /**
   * Process a mock payment
   */
  async processPayment(request: MockPaymentRequest): Promise<MockPaymentResult> {
    // Simulate processing delay
    if (request.delay) {
      await new Promise((resolve) => setTimeout(resolve, request.delay));
    }

    // Randomly decide success/failure
    const shouldFail = Math.random() < this.failureRate;
    const status = shouldFail ? 'failed' : 'success';

    const transactionId = this.generateTransactionId();
    const result: MockPaymentResult = {
      transactionId,
      status,
      timestamp: Date.now(),
      confirmationTime: Date.now() + (request.delay || 0),
    };

    this.payments.set(transactionId, result);
    this.paymentHistory.push(result);

    // Emit event for subscribers
    this.emit('payment_processed', {
      ...request,
      ...result,
    });

    return result;
  }

  /**
   * Get payment status
   */
  getPaymentStatus(transactionId: string): MockPaymentResult | null {
    return this.payments.get(transactionId) || null;
  }

  /**
   * Simulate payment reversal
   */
  async reversePayment(transactionId: string): Promise<{
    reversed: boolean;
    refundId: string;
  }> {
    const payment = this.payments.get(transactionId);
    if (!payment) {
      throw new Error(`Payment ${transactionId} not found`);
    }

    const refundId = `refund_${Date.now()}`;
    payment.status = 'failed';

    this.emit('payment_reversed', {
      originalTransactionId: transactionId,
      refundId,
      timestamp: Date.now(),
    });

    return {
      reversed: true,
      refundId,
    };
  }

  /**
   * Get payment statistics
   */
  getStatistics(): {
    totalPayments: number;
    successCount: number;
    failureCount: number;
    successRate: number;
  } {
    const successCount = this.paymentHistory.filter((p) => p.status === 'success').length;
    const failureCount = this.paymentHistory.filter((p) => p.status === 'failed').length;

    return {
      totalPayments: this.paymentHistory.length,
      successCount,
      failureCount,
      successRate: this.paymentHistory.length > 0 ? successCount / this.paymentHistory.length : 0,
    };
  }

  /**
   * Clear all mock data
   */
  clear(): void {
    this.payments.clear();
    this.paymentHistory = [];
  }

  private generateTransactionId(): string {
    return `mock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default MockPaymentProcessor;
