import { z } from 'zod';

export const PAYMENT_CATEGORIES = [
  'subscription',
  'invoice',
  'donation',
  'refund',
  'payroll',
  'software',
  'infrastructure',
  'uncategorized',
] as const;

export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number];

export interface PaymentMetadata {
  paymentId: string;
  category: PaymentCategory;
  lastUpdated: string;
}

// In-memory store for manual overrides
const manualOverrides: Map<string, PaymentCategory> = new Map();

/**
 * Automatically categorizes a payment based on its description, amount, and type.
 */
export function autoCategorize(description: string, amount: number, type?: string): PaymentCategory {
  const desc = description.toLowerCase();
  
  if (type === 'refund' || amount < 0 || desc.includes('refund')) {
    return 'refund';
  }
  
  if (desc.includes('subscription') || desc.includes('monthly') || desc.includes('yearly') || desc.includes('saas')) {
    return 'subscription';
  }
  
  if (desc.includes('invoice') || desc.includes('inv-') || desc.includes('billing')) {
    return 'invoice';
  }
  
  if (desc.includes('donation') || desc.includes('gift') || desc.includes('support')) {
    return 'donation';
  }
  
  if (desc.includes('payroll') || desc.includes('salary') || desc.includes('wage')) {
    return 'payroll';
  }
  
  if (desc.includes('software') || desc.includes('api') || desc.includes('license')) {
    return 'software';
  }
  
  if (desc.includes('infrastructure') || desc.includes('cloud') || desc.includes('aws') || desc.includes('hosting')) {
    return 'infrastructure';
  }
  
  return 'uncategorized';
}

/**
 * Gets the category for a payment, respecting manual overrides.
 */
export function getPaymentCategory(paymentId: string, description: string, amount: number, type?: string): PaymentCategory {
  if (manualOverrides.has(paymentId)) {
    return manualOverrides.get(paymentId)!;
  }
  return autoCategorize(description, amount, type);
}

/**
 * Manually overrides the category for a payment.
 */
export function overrideCategory(paymentId: string, category: PaymentCategory): void {
  manualOverrides.set(paymentId, category);
}

/**
 * Gets analytics based on categories.
 */
export function getCategoryAnalytics(payments: any[]) {
  const analytics: Record<PaymentCategory, { count: number; totalAmount: number }> = {} as any;
  
  PAYMENT_CATEGORIES.forEach(cat => {
    analytics[cat] = { count: 0, totalAmount: 0 };
  });
  
  payments.forEach(p => {
    const category = getPaymentCategory(p.id, p.description || p.projectTitle || '', p.amount, p.type);
    analytics[category].count++;
    analytics[category].totalAmount += parseFloat(p.amount) || 0;
  });
  
  return Object.entries(analytics).map(([category, data]) => ({
    category,
    ...data,
  }));
}

/**
 * Generates trend data for categories over time.
 */
export function getCategoryTrends(payments: any[], months: number = 6) {
  const trends: any[] = [];
  const now = new Date();
  
  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = date.toLocaleString('default', { month: 'short' });
    
    const monthData: any = { month: monthLabel };
    PAYMENT_CATEGORIES.forEach(cat => {
      monthData[cat] = 0;
    });
    
    payments.forEach(p => {
      const pDate = new Date(p.timestamp);
      if (pDate.getMonth() === date.getMonth() && pDate.getFullYear() === date.getFullYear()) {
        const category = getPaymentCategory(p.id, p.description || p.projectTitle || '', p.amount, p.type);
        monthData[category] += parseFloat(p.amount) || 0;
      }
    });
    
    trends.push(monthData);
  }
  
  return trends;
}
