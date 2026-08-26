/**
 * Payment domain module — registers analytics, verification, invoice, and categories services.
 */
import type { DIContainer } from '../container.js';

export function registerPaymentModule(c: DIContainer): void {
  c.register(
    'AnalyticsService',
    () => {
      const { analyticsService } = require('../../services/analytics.js');
      return analyticsService;
    },
    'singleton'
  );

  c.register(
    'VerificationService',
    () => {
      const { verificationService } = require('../../services/verification.js');
      return verificationService;
    },
    'singleton'
  );

  c.register(
    'InvoiceService',
    () => {
      const { invoiceService } = require('../../services/invoice.js');
      return invoiceService;
    },
    'singleton'
  );
}
