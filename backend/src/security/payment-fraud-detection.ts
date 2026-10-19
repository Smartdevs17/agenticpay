// Issue #1156: Strengthen payment security (iteration 5)
// Implements fraud detection and risk scoring for payments

import { createHash } from 'crypto';

/**
 * Payment transaction for fraud analysis
 */
export interface PaymentTransaction {
  id: string;
  amount: string;
  currency: string;
  merchantId: string;
  customerId?: string;
  customerEmail?: string;
  customerIp?: string;
  deviceFingerprint?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
  paymentMethod: PaymentMethod;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/**
 * Address structure
 */
export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country: string;
}

/**
 * Payment method details
 */
export interface PaymentMethod {
  type: 'card' | 'bank_transfer' | 'crypto' | 'wallet';
  last4?: string;
  brand?: string;
  walletAddress?: string;
}

/**
 * Risk assessment result
 */
export interface RiskAssessment {
  transactionId: string;
  riskScore: number; // 0-100, higher = more risky
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  decision: 'approve' | 'review' | 'decline';
  factors: RiskFactor[];
  recommendation: string;
  assessedAt: string;
}

/**
 * Risk factor
 */
export interface RiskFactor {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  score: number;
}

/**
 * Fraud detection configuration
 */
export interface FraudDetectionConfig {
  /** Enable fraud detection */
  enabled: boolean;
  /** Automatic decline threshold (risk score) */
  autoDeclineThreshold: number;
  /** Manual review threshold (risk score) */
  manualReviewThreshold: number;
  /** Enable velocity checks */
  enableVelocityChecks: boolean;
  /** Enable geolocation checks */
  enableGeolocationChecks: boolean;
  /** Enable device fingerprinting */
  enableDeviceFingerprinting: boolean;
  /** Enable behavioral analysis */
  enableBehavioralAnalysis: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_FRAUD_CONFIG: FraudDetectionConfig = {
  enabled: true,
  autoDeclineThreshold: 80,
  manualReviewThreshold: 60,
  enableVelocityChecks: true,
  enableGeolocationChecks: true,
  enableDeviceFingerprinting: true,
  enableBehavioralAnalysis: true,
};

/**
 * Transaction velocity tracker
 */
interface VelocityRecord {
  count: number;
  totalAmount: number;
  timestamps: string[];
}

/**
 * Fraud detection service
 */
export class PaymentFraudDetectionService {
  private config: FraudDetectionConfig;
  private velocityTracker: Map<string, VelocityRecord> = new Map();
  private blocklist: Set<string> = new Set();
  private trustedCustomers: Set<string> = new Set();

  constructor(config: Partial<FraudDetectionConfig> = {}) {
    this.config = { ...DEFAULT_FRAUD_CONFIG, ...config };
  }

  /**
   * Assess risk for a payment transaction
   */
  async assessRisk(transaction: PaymentTransaction): Promise<RiskAssessment> {
    if (!this.config.enabled) {
      return this.createLowRiskAssessment(transaction);
    }

    const factors: RiskFactor[] = [];

    // Check blocklist
    const blocklistFactor = this.checkBlocklist(transaction);
    if (blocklistFactor) {
      factors.push(blocklistFactor);
    }

    // Check trusted customers
    if (this.isTrustedCustomer(transaction)) {
      return this.createTrustedCustomerAssessment(transaction);
    }

    // Amount anomaly check
    const amountFactor = this.checkAmountAnomaly(transaction);
    if (amountFactor) {
      factors.push(amountFactor);
    }

    // Velocity checks
    if (this.config.enableVelocityChecks) {
      const velocityFactor = this.checkVelocity(transaction);
      if (velocityFactor) {
        factors.push(velocityFactor);
      }
    }

    // Geolocation checks
    if (this.config.enableGeolocationChecks && transaction.customerIp) {
      const geoFactor = this.checkGeolocation(transaction);
      if (geoFactor) {
        factors.push(geoFactor);
      }
    }

    // Device fingerprint checks
    if (this.config.enableDeviceFingerprinting && transaction.deviceFingerprint) {
      const deviceFactor = this.checkDeviceFingerprint(transaction);
      if (deviceFactor) {
        factors.push(deviceFactor);
      }
    }

    // Address verification
    const addressFactor = this.checkAddressMismatch(transaction);
    if (addressFactor) {
      factors.push(addressFactor);
    }

    // Payment method risk
    const paymentMethodFactor = this.checkPaymentMethod(transaction);
    if (paymentMethodFactor) {
      factors.push(paymentMethodFactor);
    }

    // Calculate overall risk score
    const riskScore = this.calculateRiskScore(factors);
    const riskLevel = this.determineRiskLevel(riskScore);
    const decision = this.makeDecision(riskScore);

    return {
      transactionId: transaction.id,
      riskScore,
      riskLevel,
      decision,
      factors,
      recommendation: this.generateRecommendation(riskScore, factors),
      assessedAt: new Date().toISOString(),
    };
  }

  /**
   * Check if entity is on blocklist
   */
  private checkBlocklist(transaction: PaymentTransaction): RiskFactor | null {
    const identifiers = [
      transaction.customerEmail,
      transaction.customerIp,
      transaction.deviceFingerprint,
      transaction.paymentMethod.walletAddress,
    ].filter(Boolean) as string[];

    for (const identifier of identifiers) {
      if (this.blocklist.has(identifier)) {
        return {
          type: 'blocklist',
          severity: 'high',
          description: 'Customer or payment method is on blocklist',
          score: 90,
        };
      }
    }

    return null;
  }

  /**
   * Check if customer is trusted
   */
  private isTrustedCustomer(transaction: PaymentTransaction): boolean {
    if (!transaction.customerId) return false;
    return this.trustedCustomers.has(transaction.customerId);
  }

  /**
   * Check for amount anomalies
   */
  private checkAmountAnomaly(transaction: PaymentTransaction): RiskFactor | null {
    const amount = parseFloat(transaction.amount);

    // Check for suspiciously large amounts
    if (amount > 10000) {
      return {
        type: 'high_amount',
        severity: 'high',
        description: `Transaction amount $${amount} is unusually high`,
        score: 40,
      };
    }

    // Check for suspiciously round amounts (potential test transactions)
    if (amount % 100 === 0 && amount >= 1000) {
      return {
        type: 'round_amount',
        severity: 'low',
        description: 'Transaction amount is suspiciously round',
        score: 10,
      };
    }

    return null;
  }

  /**
   * Check transaction velocity
   */
  private checkVelocity(transaction: PaymentTransaction): RiskFactor | null {
    const key = this.getVelocityKey(transaction);
    const record = this.velocityTracker.get(key) || {
      count: 0,
      totalAmount: 0,
      timestamps: [],
    };

    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Filter to last hour
    record.timestamps = record.timestamps.filter(
      (ts) => new Date(ts) > oneHourAgo,
    );

    record.count = record.timestamps.length + 1;
    record.totalAmount += parseFloat(transaction.amount);
    record.timestamps.push(transaction.timestamp);

    this.velocityTracker.set(key, record);

    // Check for velocity violations
    if (record.count > 10) {
      return {
        type: 'high_velocity',
        severity: 'high',
        description: `${record.count} transactions in the last hour`,
        score: 60,
      };
    }

    if (record.totalAmount > 50000) {
      return {
        type: 'high_volume',
        severity: 'medium',
        description: `$${record.totalAmount} in transaction volume in the last hour`,
        score: 40,
      };
    }

    return null;
  }

  /**
   * Check geolocation for anomalies
   */
  private checkGeolocation(transaction: PaymentTransaction): RiskFactor | null {
    // Simplified geolocation check
    // In production, use actual IP geolocation service

    if (!transaction.customerIp) return null;

    // Check for known risky countries (simplified)
    const riskyPatterns = ['tor-exit', 'proxy', 'vpn'];
    
    if (riskyPatterns.some((pattern) => transaction.customerIp!.includes(pattern))) {
      return {
        type: 'suspicious_ip',
        severity: 'medium',
        description: 'Transaction from suspicious IP address',
        score: 30,
      };
    }

    return null;
  }

  /**
   * Check device fingerprint
   */
  private checkDeviceFingerprint(
    transaction: PaymentTransaction,
  ): RiskFactor | null {
    if (!transaction.deviceFingerprint) return null;

    // Check if device has been used for multiple failed transactions
    // This would require historical data in production
    
    return null;
  }

  /**
   * Check for address mismatches
   */
  private checkAddressMismatch(transaction: PaymentTransaction): RiskFactor | null {
    if (!transaction.billingAddress || !transaction.shippingAddress) {
      return null;
    }

    const billing = transaction.billingAddress;
    const shipping = transaction.shippingAddress;

    // Check country mismatch
    if (billing.country !== shipping.country) {
      return {
        type: 'address_mismatch',
        severity: 'medium',
        description: 'Billing and shipping addresses in different countries',
        score: 25,
      };
    }

    // Check significant distance (simplified)
    if (billing.city !== shipping.city && billing.state !== shipping.state) {
      return {
        type: 'address_distance',
        severity: 'low',
        description: 'Billing and shipping addresses are far apart',
        score: 15,
      };
    }

    return null;
  }

  /**
   * Check payment method risk
   */
  private checkPaymentMethod(transaction: PaymentTransaction): RiskFactor | null {
    const method = transaction.paymentMethod;

    // Crypto payments have higher baseline risk
    if (method.type === 'crypto') {
      return {
        type: 'crypto_payment',
        severity: 'low',
        description: 'Cryptocurrency payments have elevated risk',
        score: 10,
      };
    }

    return null;
  }

  /**
   * Calculate overall risk score from factors
   */
  private calculateRiskScore(factors: RiskFactor[]): number {
    if (factors.length === 0) return 0;

    // Sum individual scores with severity weighting
    const weightedSum = factors.reduce((sum, factor) => {
      const weight =
        factor.severity === 'high' ? 1.5 : factor.severity === 'medium' ? 1.2 : 1.0;
      return sum + factor.score * weight;
    }, 0);

    // Cap at 100
    return Math.min(Math.round(weightedSum), 100);
  }

  /**
   * Determine risk level from score
   */
  private determineRiskLevel(
    riskScore: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (riskScore >= 80) return 'critical';
    if (riskScore >= 60) return 'high';
    if (riskScore >= 30) return 'medium';
    return 'low';
  }

  /**
   * Make decision based on risk score
   */
  private makeDecision(riskScore: number): 'approve' | 'review' | 'decline' {
    if (riskScore >= this.config.autoDeclineThreshold) {
      return 'decline';
    }
    if (riskScore >= this.config.manualReviewThreshold) {
      return 'review';
    }
    return 'approve';
  }

  /**
   * Generate recommendation message
   */
  private generateRecommendation(
    riskScore: number,
    factors: RiskFactor[],
  ): string {
    if (riskScore >= this.config.autoDeclineThreshold) {
      return 'Automatically decline this transaction due to high fraud risk';
    }

    if (riskScore >= this.config.manualReviewThreshold) {
      const highRiskFactors = factors
        .filter((f) => f.severity === 'high')
        .map((f) => f.type);
      return `Manual review required. Primary concerns: ${highRiskFactors.join(', ') || 'multiple medium-risk factors'}`;
    }

    return 'Approve transaction - risk level acceptable';
  }

  /**
   * Create low risk assessment for disabled fraud detection
   */
  private createLowRiskAssessment(
    transaction: PaymentTransaction,
  ): RiskAssessment {
    return {
      transactionId: transaction.id,
      riskScore: 0,
      riskLevel: 'low',
      decision: 'approve',
      factors: [],
      recommendation: 'Fraud detection disabled - auto-approved',
      assessedAt: new Date().toISOString(),
    };
  }

  /**
   * Create assessment for trusted customers
   */
  private createTrustedCustomerAssessment(
    transaction: PaymentTransaction,
  ): RiskAssessment {
    return {
      transactionId: transaction.id,
      riskScore: 5,
      riskLevel: 'low',
      decision: 'approve',
      factors: [
        {
          type: 'trusted_customer',
          severity: 'low',
          description: 'Customer has trusted status',
          score: -50, // Negative score to reduce risk
        },
      ],
      recommendation: 'Approve - trusted customer',
      assessedAt: new Date().toISOString(),
    };
  }

  /**
   * Get velocity tracking key for customer
   */
  private getVelocityKey(transaction: PaymentTransaction): string {
    const identifier = transaction.customerId || transaction.customerIp || 'anonymous';
    return createHash('sha256').update(identifier).digest('hex');
  }

  /**
   * Add entity to blocklist
   */
  addToBlocklist(identifier: string): void {
    this.blocklist.add(identifier);
  }

  /**
   * Remove entity from blocklist
   */
  removeFromBlocklist(identifier: string): void {
    this.blocklist.delete(identifier);
  }

  /**
   * Add customer to trusted list
   */
  addTrustedCustomer(customerId: string): void {
    this.trustedCustomers.add(customerId);
  }

  /**
   * Remove customer from trusted list
   */
  removeTrustedCustomer(customerId: string): void {
    this.trustedCustomers.delete(customerId);
  }

  /**
   * Clear velocity tracking (for testing)
   */
  clearVelocityTracking(): void {
    this.velocityTracker.clear();
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    blocklistSize: number;
    trustedCustomersCount: number;
    velocityRecordsCount: number;
  } {
    return {
      blocklistSize: this.blocklist.size,
      trustedCustomersCount: this.trustedCustomers.size,
      velocityRecordsCount: this.velocityTracker.size,
    };
  }
}
