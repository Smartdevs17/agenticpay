// Issue #1157: Improve gateway integrations (iteration 5)
// Unified gateway adapter interface with health monitoring and failover

/**
 * Payment gateway types
 */
export type GatewayType = 'stellar' | 'stripe' | 'paypal' | 'coinbase';

/**
 * Payment request
 */
export interface PaymentRequest {
  amount: string;
  currency: string;
  recipient: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
}

/**
 * Payment response
 */
export interface PaymentResponse {
  success: boolean;
  transactionId: string;
  transactionHash?: string;
  status: 'pending' | 'completed' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  gatewayResponse?: unknown;
}

/**
 * Gateway health status
 */
export interface GatewayHealth {
  gatewayType: GatewayType;
  isHealthy: boolean;
  lastCheckAt: string;
  responseTimeMs: number;
  errorRate: number;
  successRate: number;
  consecutiveFailures: number;
}

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  gatewayType: GatewayType;
  enabled: boolean;
  priority: number;
  maxRetries: number;
  timeoutMs: number;
  healthCheckIntervalMs: number;
  circuitBreakerThreshold: number;
  credentials: Record<string, string>;
}

/**
 * Circuit breaker state
 */
enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half_open',
}

/**
 * Base gateway adapter interface
 */
export interface IGatewayAdapter {
  getType(): GatewayType;
  processPayment(request: PaymentRequest): Promise<PaymentResponse>;
  checkHealth(): Promise<boolean>;
  getHealthStatus(): GatewayHealth;
}

/**
 * Abstract base gateway adapter with common functionality
 */
export abstract class BaseGatewayAdapter implements IGatewayAdapter {
  protected config: GatewayConfig;
  protected health: GatewayHealth;
  protected circuitState: CircuitState = CircuitState.Closed;
  protected circuitOpenedAt?: Date;
  protected requestTimes: number[] = [];
  protected requestResults: boolean[] = [];

  constructor(config: GatewayConfig) {
    this.config = config;
    this.health = {
      gatewayType: config.gatewayType,
      isHealthy: true,
      lastCheckAt: new Date().toISOString(),
      responseTimeMs: 0,
      errorRate: 0,
      successRate: 1,
      consecutiveFailures: 0,
    };
  }

  abstract getType(): GatewayType;
  protected abstract executePayment(request: PaymentRequest): Promise<PaymentResponse>;

  /**
   * Process payment with circuit breaker and monitoring
   */
  async processPayment(request: PaymentRequest): Promise<PaymentResponse> {
    // Check circuit breaker
    if (this.circuitState === CircuitState.Open) {
      if (this.shouldAttemptReset()) {
        this.circuitState = CircuitState.HalfOpen;
      } else {
        throw new Error(
          `Gateway ${this.config.gatewayType} circuit is open. Try again later.`,
        );
      }
    }

    const startTime = Date.now();
    
    try {
      const response = await this.executePayment(request);
      const processingTime = Date.now() - startTime;

      this.recordSuccess(processingTime);

      // Close circuit if half-open
      if (this.circuitState === CircuitState.HalfOpen) {
        this.circuitState = CircuitState.Closed;
        this.health.consecutiveFailures = 0;
      }

      return response;
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.recordFailure(processingTime);

      // Check if should open circuit
      if (this.health.consecutiveFailures >= this.config.circuitBreakerThreshold) {
        this.openCircuit();
      }

      throw error;
    }
  }

  /**
   * Check health of the gateway
   */
  async checkHealth(): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      await this.performHealthCheck();
      const responseTime = Date.now() - startTime;
      
      this.health.isHealthy = true;
      this.health.responseTimeMs = responseTime;
      this.health.lastCheckAt = new Date().toISOString();
      
      return true;
    } catch {
      this.health.isHealthy = false;
      this.health.lastCheckAt = new Date().toISOString();
      
      return false;
    }
  }

  /**
   * Perform gateway-specific health check
   */
  protected abstract performHealthCheck(): Promise<void>;

  /**
   * Get current health status
   */
  getHealthStatus(): GatewayHealth {
    return { ...this.health };
  }

  /**
   * Record successful request
   */
  private recordSuccess(processingTimeMs: number): void {
    this.requestTimes.push(processingTimeMs);
    this.requestResults.push(true);
    this.trimMetrics();
    this.updateMetrics();
    this.health.consecutiveFailures = 0;
  }

  /**
   * Record failed request
   */
  private recordFailure(processingTimeMs: number): void {
    this.requestTimes.push(processingTimeMs);
    this.requestResults.push(false);
    this.trimMetrics();
    this.updateMetrics();
    this.health.consecutiveFailures++;
  }

  /**
   * Trim metrics to last 100 requests
   */
  private trimMetrics(): void {
    if (this.requestTimes.length > 100) {
      this.requestTimes.shift();
      this.requestResults.shift();
    }
  }

  /**
   * Update health metrics
   */
  private updateMetrics(): void {
    // Average response time
    if (this.requestTimes.length > 0) {
      this.health.responseTimeMs =
        this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length;
    }

    // Success and error rates
    if (this.requestResults.length > 0) {
      const successCount = this.requestResults.filter((r) => r).length;
      this.health.successRate = successCount / this.requestResults.length;
      this.health.errorRate = 1 - this.health.successRate;
    }
  }

  /**
   * Open circuit breaker
   */
  private openCircuit(): void {
    this.circuitState = CircuitState.Open;
    this.circuitOpenedAt = new Date();
    this.health.isHealthy = false;
  }

  /**
   * Check if should attempt circuit reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.circuitOpenedAt) return false;
    
    const elapsed = Date.now() - this.circuitOpenedAt.getTime();
    return elapsed > 60000; // 1 minute cooldown
  }
}

/**
 * Gateway manager with failover support
 */
export class GatewayManager {
  private adapters: Map<GatewayType, IGatewayAdapter> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;

  /**
   * Register a gateway adapter
   */
  registerAdapter(adapter: IGatewayAdapter): void {
    this.adapters.set(adapter.getType(), adapter);
  }

  /**
   * Unregister a gateway adapter
   */
  unregisterAdapter(gatewayType: GatewayType): void {
    this.adapters.delete(gatewayType);
  }

  /**
   * Process payment with automatic failover
   */
  async processPayment(
    request: PaymentRequest,
    preferredGateway?: GatewayType,
  ): Promise<PaymentResponse & { gatewayUsed: GatewayType }> {
    // Get available gateways sorted by priority and health
    const gateways = this.getAvailableGateways(preferredGateway);

    if (gateways.length === 0) {
      throw new Error('No available payment gateways');
    }

    let lastError: Error | null = null;

    // Try each gateway in order
    for (const adapter of gateways) {
      try {
        const response = await adapter.processPayment(request);
        return {
          ...response,
          gatewayUsed: adapter.getType(),
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        // Continue to next gateway
      }
    }

    // All gateways failed
    throw new Error(
      `Payment failed on all available gateways. Last error: ${lastError?.message}`,
    );
  }

  /**
   * Get available gateways sorted by priority and health
   */
  private getAvailableGateways(preferredGateway?: GatewayType): IGatewayAdapter[] {
    const adapters = Array.from(this.adapters.values());

    // Filter to healthy gateways
    const healthyAdapters = adapters.filter((adapter) => {
      const health = adapter.getHealthStatus();
      return health.isHealthy;
    });

    // If preferred gateway is healthy, put it first
    if (preferredGateway) {
      const preferred = healthyAdapters.find((a) => a.getType() === preferredGateway);
      if (preferred) {
        return [
          preferred,
          ...healthyAdapters.filter((a) => a.getType() !== preferredGateway),
        ];
      }
    }

    // Sort by success rate
    return healthyAdapters.sort((a, b) => {
      const healthA = a.getHealthStatus();
      const healthB = b.getHealthStatus();
      return healthB.successRate - healthA.successRate;
    });
  }

  /**
   * Get health status of all gateways
   */
  getAllHealthStatus(): GatewayHealth[] {
    return Array.from(this.adapters.values()).map((adapter) =>
      adapter.getHealthStatus(),
    );
  }

  /**
   * Get health status of specific gateway
   */
  getHealthStatus(gatewayType: GatewayType): GatewayHealth | null {
    const adapter = this.adapters.get(gatewayType);
    return adapter ? adapter.getHealthStatus() : null;
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = 60000): void {
    this.stopHealthChecks();

    this.healthCheckInterval = setInterval(async () => {
      for (const adapter of this.adapters.values()) {
        await adapter.checkHealth();
      }
    }, intervalMs);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }
  }

  /**
   * Get aggregate metrics
   */
  getAggregateMetrics(): {
    totalGateways: number;
    healthyGateways: number;
    averageSuccessRate: number;
    averageResponseTime: number;
  } {
    const allHealth = this.getAllHealthStatus();
    const healthyCount = allHealth.filter((h) => h.isHealthy).length;
    
    const avgSuccessRate =
      allHealth.reduce((sum, h) => sum + h.successRate, 0) / allHealth.length || 0;
    
    const avgResponseTime =
      allHealth.reduce((sum, h) => sum + h.responseTimeMs, 0) / allHealth.length || 0;

    return {
      totalGateways: allHealth.length,
      healthyGateways: healthyCount,
      averageSuccessRate: avgSuccessRate,
      averageResponseTime: avgResponseTime,
    };
  }
}
