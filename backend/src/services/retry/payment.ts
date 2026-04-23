import { retryService, RetryResult, RetryConfig, createRetryConfig, RetryMetrics } from './index.js';

export interface PaymentRetryConfig extends RetryConfig {
  paymentType: string;
  enableCircuitBreaker: boolean;
  notifyOnFailure: boolean;
}

export interface PaymentAttempt {
  paymentId: string;
  attemptNumber: number;
  timestamp: Date;
  status: 'pending' | 'success' | 'failed';
  error?: string;
  txHash?: string;
  gasUsed?: string;
}

export interface PaymentRetryState {
  paymentId: string;
  status: 'pending' | 'processing' | 'success' | 'failed' | 'exhausted';
  attempts: PaymentAttempt[];
  lastAttemptTime?: Date;
  nextRetryTime?: Date;
  error?: string;
}

export interface PaymentRetryEvent {
  type: 'retry_started' | 'retry_attempt' | 'retry_success' | 'retry_failed' | 'retry_exhausted';
  paymentId: string;
  timestamp: Date;
  data: {
    attemptNumber?: number;
    error?: string;
    txHash?: string;
    nextRetryTime?: Date;
  };
}

type EventHandler = (event: PaymentRetryEvent) => void;

const DEFAULT_PAYMENT_CONFIGS: Record<string, Partial<PaymentRetryConfig>> = {
  default: {
    maxRetries: 3,
    initialDelayMs: 5000,
    maxDelayMs: 120000,
    backoffMultiplier: 2,
    enableCircuitBreaker: true,
    notifyOnFailure: true,
  },
  usdc: {
    maxRetries: 3,
    initialDelayMs: 10000,
    maxDelayMs: 180000,
    backoffMultiplier: 2,
    enableCircuitBreaker: true,
    notifyOnFailure: true,
  },
  xlm: {
    maxRetries: 2,
    initialDelayMs: 5000,
    maxDelayMs: 60000,
    backoffMultiplier: 1.5,
    enableCircuitBreaker: true,
    notifyOnFailure: true,
  },
  stripe: {
    maxRetries: 3,
    initialDelayMs: 2000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    enableCircuitBreaker: false,
    notifyOnFailure: true,
  },
};

class PaymentRetryService {
  private paymentStates: Map<string, PaymentRetryState> = new Map();
  private eventHandlers: Set<EventHandler> = new Set();
  private paymentConfigs: Map<string, PaymentRetryConfig> = new Map();
  private manualRetryQueue: Set<string> = new Set();

  constructor() {
    this.initializePaymentConfigs();
  }

  private initializePaymentConfigs(): void {
    for (const [type, config] of Object.entries(DEFAULT_PAYMENT_CONFIGS)) {
      this.paymentConfigs.set(type, {
        ...createRetryConfig(config),
        paymentType: type,
        enableCircuitBreaker: config.enableCircuitBreaker ?? true,
        notifyOnFailure: config.notifyOnFailure ?? true,
      } as PaymentRetryConfig);
    }
  }

  getConfig(paymentType: string): PaymentRetryConfig {
    return this.paymentConfigs.get(paymentType) || this.paymentConfigs.get('default')!;
  }

  setConfig(paymentType: string, config: Partial<PaymentRetryConfig>): void {
    const existing = this.getConfig(paymentType);
    this.paymentConfigs.set(paymentType, { ...existing, ...config, paymentType } as PaymentRetryConfig);
  }

  subscribe(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: PaymentRetryEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Error in retry event handler:', error);
      }
    }
  }

  async retryPayment<T>(
    paymentId: string,
    paymentType: string,
    operation: () => Promise<T>,
    manualOverride: boolean = false
  ): Promise<RetryResult<T>> {
    const config = this.getConfig(paymentType);
    let state = this.paymentStates.get(paymentId);

    if (!state) {
      state = {
        paymentId,
        status: 'pending',
        attempts: [],
      };
      this.paymentStates.set(paymentId, state);
    }

    if (!manualOverride && state.status === 'success') {
      return { success: true, attempts: 0, totalTimeMs: 0 };
    }

    if (!manualOverride && this.manualRetryQueue.has(paymentId)) {
      this.manualRetryQueue.delete(paymentId);
    }

    state.status = 'processing';
    this.emit({
      type: 'retry_started',
      paymentId,
      timestamp: new Date(),
      data: { attemptNumber: state.attempts.length + 1 },
    });

    const result = await retryService.retry(operation, { type: paymentType, id: paymentId }, {
      maxRetries: config.maxRetries,
      initialDelayMs: config.initialDelayMs,
      maxDelayMs: config.maxDelayMs,
      backoffMultiplier: config.backoffMultiplier,
    });

    const attempt: PaymentAttempt = {
      paymentId,
      attemptNumber: result.attempts,
      timestamp: new Date(),
      status: result.success ? 'success' : 'failed',
      error: result.error?.message,
    };

    state.attempts.push(attempt);
    state.lastAttemptTime = new Date();

    if (result.success) {
      state.status = 'success';
      this.emit({
        type: 'retry_success',
        paymentId,
        timestamp: new Date(),
        data: { attemptNumber: result.attempts },
      });
    } else {
      const maxAttempts = config.maxRetries + 1;
      if (result.attempts >= maxAttempts) {
        state.status = 'exhausted';
        state.error = result.error?.message;
        
        if (config.notifyOnFailure) {
          this.sendFailureNotification(paymentId, state);
        }
        
        this.emit({
          type: 'retry_exhausted',
          paymentId,
          timestamp: new Date(),
          data: { error: result.error?.message },
        });
      } else {
        state.status = 'pending';
        const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, result.attempts - 1);
        state.nextRetryTime = new Date(Date.now() + delay);
        
        this.emit({
          type: 'retry_attempt',
          paymentId,
          timestamp: new Date(),
          data: {
            attemptNumber: result.attempts,
            error: result.error?.message,
            nextRetryTime: state.nextRetryTime,
          },
        });
      }
    }

    return result;
  }

  private async sendFailureNotification(paymentId: string, state: PaymentRetryState): Promise<void> {
    console.log(`[PaymentRetry] Sending failure notification for payment ${paymentId}`);
  }

  getPaymentState(paymentId: string): PaymentRetryState | undefined {
    return this.paymentStates.get(paymentId);
  }

  getAllPaymentStates(): PaymentRetryState[] {
    return Array.from(this.paymentStates.values());
  }

  getPaymentAttempts(paymentId: string): PaymentAttempt[] {
    return this.paymentStates.get(paymentId)?.attempts || [];
  }

  queueManualRetry(paymentId: string): void {
    const state = this.paymentStates.get(paymentId);
    if (state && (state.status === 'failed' || state.status === 'exhausted')) {
      this.manualRetryQueue.add(paymentId);
      state.status = 'pending';
      state.error = undefined;
    }
  }

  cancelPayment(paymentId: string): void {
    const state = this.paymentStates.get(paymentId);
    if (state) {
      state.status = 'failed';
      state.error = 'Cancelled by user';
      this.manualRetryQueue.delete(paymentId);
    }
  }

  getRetryAnalytics(): {
    totalPayments: number;
    successfulPayments: number;
    failedPayments: number;
    exhaustedPayments: number;
    successRate: number;
    averageAttempts: number;
    byType: Record<string, { total: number; success: number; failed: number; rate: number }>;
  } {
    const states = Array.from(this.paymentStates.values());
    const successful = states.filter(s => s.status === 'success').length;
    const failed = states.filter(s => s.status === 'failed').length;
    const exhausted = states.filter(s => s.status === 'exhausted').length;
    
    const totalAttempts = states.reduce((sum, s) => sum + s.attempts.length, 0);

    const byType: Record<string, { total: number; success: number; failed: number; rate: number }> = {};
    for (const state of states) {
      const type = state.paymentId.split('-')[0] || 'default';
      if (!byType[type]) {
        byType[type] = { total: 0, success: 0, failed: 0, rate: 0 };
      }
      byType[type].total++;
      if (state.status === 'success') byType[type].success++;
      if (state.status === 'failed' || state.status === 'exhausted') byType[type].failed++;
      byType[type].rate = byType[type].total > 0 ? (byType[type].success / byType[type].total) * 100 : 0;
    }

    return {
      totalPayments: states.length,
      successfulPayments: successful,
      failedPayments: failed,
      exhaustedPayments: exhausted,
      successRate: states.length > 0 ? (successful / states.length) * 100 : 0,
      averageAttempts: states.length > 0 ? totalAttempts / states.length : 0,
      byType,
    };
  }

  getRetryMetrics(paymentType: string): RetryMetrics | undefined {
    return retryService.getMetrics(paymentType);
  }

  getAllRetryMetrics(): Map<string, RetryMetrics> {
    return retryService.getAllMetrics();
  }

  getCircuitBreakerStates() {
    return retryService.getCircuitBreakerStates();
  }

  resetPayment(paymentId: string): void {
    this.paymentStates.delete(paymentId);
    this.manualRetryQueue.delete(paymentId);
  }

  resetAll(): void {
    this.paymentStates.clear();
    this.manualRetryQueue.clear();
    retryService.resetAll();
  }
}

export const paymentRetryService = new PaymentRetryService();