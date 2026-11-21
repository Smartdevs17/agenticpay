/**
 * backend/src/routes/index.ts
 *
 * Central router module assembling all domain route modules.
 * Refactored under Issue #1400: preserves exact registration order, mount prefixes,
 * and middleware chains.
 */

import express, { Router, Request, Response, RequestHandler } from 'express';
import { tokenBucketRateLimit } from '../middleware/tokenBucketRateLimit.js';
import { getCompressionMetrics } from '../middleware/compression.js';
import { poolMetrics } from '../config/database.js';

// Domain router imports
import { verificationRouter } from './verification.js';
import { invoiceRouter } from './invoice.js';
import { stellarRouter } from './stellar.js';
import { catalogRouter } from './catalog.js';
import { jobsRouter } from './jobs.js';
import { queueRouter } from './queue.js';
import { bullMQMonitorRouter } from './bullmq-monitor.js';
import { slaRouter } from './sla.js';
import { onboardingRouter } from './onboarding.js';
import { legacyRouter } from './legacy.js';
import { flagsRouter } from './flags.js';
import { rateLimitAnalyticsRouter } from './rate-limit-analytics.js';
import { zkIdentityRouter } from './zk-identity.js';
import { kybRouter } from './kyb.js';
import { kycRouter } from './kyc.js';
import { batchRouter } from './batch.js';
import { relayerRouter } from './relayer.js';
import { paymentQueueRouter } from './payment-queue.js';
import { splitsRouter } from './splits.js';
import { refundsRouter } from './refunds.js';
import allowancesRouter from './allowances.js';
import { payoutsRouter } from './payouts.js';
import { reportsRouter } from './reports.js';
import { reconciliationRouter } from './reconciliation.js';
import { formsRouter } from './forms.js';
import { webhooksRouter } from './webhooks.js';
import webhooksDlqRouter from './webhooks-dlq.js';
import { webhookHandlersRouter } from './webhookHandlers.js';
import { disputeRoutes } from '../disputes/index.js';
import { emailRouter } from './email.js';
import { portfolioRouter } from './portfolio.js';
import { backupRouter } from './backup.js';
import { ipAllowlistRouter } from './ip-allowlist.js';
import { pushRouter } from './push.js';
import { stripeRouter } from './stripe.js';
import { taxReportingRouter } from './tax-reporting.js';
import { walletRouter } from './wallet.js';
import { gdprRouter } from './gdpr.js';
import { dataExportRouter } from './dataExport.js';
import { securityRouter } from './security.js';
import { commentsRouter } from './comments.js';
import { collaborationRouter } from './collaboration.js';
import { paymentStrategiesRouter } from './payment-strategies.js';
import { agentMarketplaceRouter } from './agent-marketplace.js';
import { streamingExportRouter } from './streaming-export.js';
import { poolMonitorRouter } from './pool-monitor.js';
import { databaseRouter } from './database.js';
import { archiveRouter } from './archive.js';
import { searchRouter } from './search.js';
import { cohortAnalyticsRouter } from './cohort-analytics.js';
import { churnPredictionRouter } from './churn-prediction.js';
import { slackRouter } from './slack.js';
import { githubIntegrationRouter } from './github-integration.js';
import { wooCommerceRouter } from './woocommerce.js';
import { salesforceRouter } from './salesforce.js';
import { xeroRouter } from './xero.js';
import { quickBooksRouter } from './quickbooks.js';
import { pluginsRouter } from './plugins.js';
import { funnelTrackingRouter } from './funnel-tracking.js';
import { mlForecastRouter } from './ml-forecast.js';
import { abTestingRouter } from './ab-testing.js';
import { customerHealthRouter } from './customer-health.js';
import { pnlRouter } from './pnl.js';
import { clvRouter } from './clv.js';
import { paymentMethodAnalyticsRouter } from './payment-method-analytics.js';
import { cashFlowRouter } from './cash-flow.js';
import { nfcRouter } from './nfc.js';
import { cacheRouter } from './cache.js';
import { circuitBreakerRouter } from './circuit-breaker.js';
import { fraudDetectionRouter } from './fraud-detection.js';
import { bridgeRouter } from './bridge.js';
import { tokenizationRouter } from './tokenization.js';
import { routingRouter } from './routing.js';
import { escrowRouter } from './escrow.js';
import { disputesRouter } from './disputes.js';
import { subscriptionsRouter } from './subscriptions.js';
import { workspacesRouter } from './workspaces.js';
import { marketplaceEscrowRouter } from './marketplace-escrow.js';
import { teamsRouter } from './teams.js';
import { walletPaymentsRouter } from './wallet-payments.js';
import { merchantAuditRouter } from './merchant-audit.js';
import { subscriptionBillingRouter } from './subscription-billing.js';
import { installmentsRouter } from './installments.js';
import { jobQueueRouter } from './job-queue.js';
import { recurringBillingRouter } from './recurring-billing.js';
import { splitPaymentsRouter } from './split-payments.js';
import { transfersRouter } from './transfers.js';
import { threeDSRouter } from './3ds.js';
import { merchantRiskRouter } from './merchant-risk.js';
import { chargebacksRouter } from './chargebacks.js';
import { healthRouter } from './health.js';
import { coldStartMonitorRouter } from './cold-start-monitor.js';
import { twoFactorAuthRouter } from './2fa.js';
import { notificationsRouter } from './notifications.js';
import { instamojoRouter } from './instamojo.js';
import { razorpayRouter } from './razorpay.js';
import { auditRouter } from './audit.js';
import { hedgingRouter } from './hedging.js';
import { complianceRouter } from './compliance.js';
import { amlMonitoringRouter } from './aml-monitoring.js';
import { sanctionsScreeningRouter } from './sanctions.js';
import { pciDssRouter } from './pci-dss.js';
import { nanoRouter } from './nano.js';
import { multisigRouter } from './multisig.js';
import { apiVersionsRouter } from './api-versions.js';
import { receiptsRouter } from './receipts.js';
import { eventsRouter } from './events.js';
import { threatDetectionRouter } from './threat-detection.js';
import { fileUploadRouter } from './file-upload.js';
import { credentialRotationRouter } from './credential-rotation.js';
import { providerCredentialsRouter } from './provider-credentials.js';
import { serviceMeshRouter } from './service-mesh.js';
import { fiatPaymentsRouter } from './fiat-payments.js';
import { fxRouter } from './fx.js';
import { crossBorderRouter } from './cross-border.js';
import { paymentLinksRouter } from './payment-links.js';
import { taxRouter } from './tax.js';
import { projectsRouter } from './projects.js';
import { emailV2Router } from './email-v2.js';

export interface CreateApiV1RouterOptions {
  invoiceLimiter?: RequestHandler;
}

/**
 * Creates and configures the Express Router for /api/v1 endpoints,
 * registering every sub-router in the exact order required for matching.
 */
export function createApiV1Router(options: CreateApiV1RouterOptions = {}): Router {
  const router = express.Router();

  const invoiceLimiter =
    options.invoiceLimiter ??
    tokenBucketRateLimit({
      keyPrefix: 'rl:invoice',
      capacity: 20,
      refillRate: 5,
    });

  // Preserve exact registration order from backend/src/index.ts
  router.use('/verification', verificationRouter);
  router.use('/invoice', invoiceLimiter, invoiceRouter);
  router.use('/stellar', stellarRouter);
  router.use('/catalog', catalogRouter);
  router.use('/jobs', jobsRouter);
  router.use('/queue', queueRouter);
  router.use('/queue', bullMQMonitorRouter);
  router.use('/sla', slaRouter);
  router.use('/onboarding', onboardingRouter);
  router.use('/legacy', legacyRouter);
  router.use('/flags', flagsRouter);
  router.use('/rate-limit', rateLimitAnalyticsRouter);
  router.use('/zk-identity', zkIdentityRouter);
  router.use('/kyb', kybRouter);
  router.use('/kyc', kycRouter);
  router.use('/batch', batchRouter);
  router.use('/relayer', relayerRouter);
  router.use('/queue/payments', paymentQueueRouter);
  router.use('/splits', splitsRouter);
  router.use('/refunds', refundsRouter);
  router.use('/allowances', allowancesRouter);
  router.use('/payouts', payoutsRouter);
  router.use('/reports', reportsRouter);
  router.use('/reconciliation', reconciliationRouter);
  router.use('/forms', formsRouter);
  router.use('/webhooks', webhooksRouter);
  router.use('/disputes', disputeRoutes);
  router.use('/emails', emailRouter);
  router.use('/portfolio', portfolioRouter);
  router.use('/backup', backupRouter);
  router.use('/ip-allowlist', ipAllowlistRouter);
  router.use('/push', pushRouter);
  router.use('/stripe', stripeRouter);
  router.use('/tax-reporting', taxReportingRouter);
  router.use('/wallet', walletRouter);
  router.use('/gdpr', gdprRouter);
  router.use('/data-export', dataExportRouter);
  router.use('/security', securityRouter);
  router.use('/comments', commentsRouter);
  router.use('/collaboration', collaborationRouter);
  router.use('/payment-strategies', paymentStrategiesRouter);
  router.use('/marketplace', agentMarketplaceRouter);
  router.use('/exports', streamingExportRouter);
  router.use('/monitoring', poolMonitorRouter);
  router.use('/database', databaseRouter);
  router.use('/archive', archiveRouter);
  router.use('/search', searchRouter);
  router.use('/analytics/cohorts', cohortAnalyticsRouter);
  router.use('/analytics/churn', churnPredictionRouter);
  router.use('/integrations/slack', slackRouter);
  router.use('/integrations/github', githubIntegrationRouter);
  router.use('/integrations/woocommerce', wooCommerceRouter);
  router.use('/integrations/salesforce', salesforceRouter);
  router.use('/integrations/xero', xeroRouter);
  router.use('/integrations/quickbooks', quickBooksRouter);
  router.use('/plugins', pluginsRouter);
  router.use('/funnels', funnelTrackingRouter);
  router.use('/forecast/ml', mlForecastRouter);
  router.use('/ab-tests', abTestingRouter);
  router.use('/customer-health', customerHealthRouter);
  router.use('/reports/pnl', pnlRouter);
  router.use('/clv', clvRouter);
  router.use('/payment-methods/analytics', paymentMethodAnalyticsRouter);
  router.use('/cash-flow', cashFlowRouter);
  router.use('/nfc', nfcRouter);
  router.use('/cache', cacheRouter);
  router.use('/circuit-breaker', circuitBreakerRouter);
  router.use('/fraud-detection', fraudDetectionRouter);
  router.use('/bridge', bridgeRouter);
  router.use('/tokenization', tokenizationRouter);
  router.use('/routing', routingRouter);
  router.use('/escrow', escrowRouter);
  router.use('/disputes', disputesRouter);
  router.use('/subscriptions', subscriptionsRouter);
  router.use('/workspaces', workspacesRouter);
  router.use('/marketplace-escrow', marketplaceEscrowRouter);
  router.use('/teams', teamsRouter);
  router.use('/wallet-payments', walletPaymentsRouter);
  router.use('/merchant-audit', merchantAuditRouter);
  router.use('/billing', subscriptionBillingRouter);
  router.use('/installments', installmentsRouter);
  router.use('/job-queue', jobQueueRouter);
  router.use('/recurring-payments', recurringBillingRouter);
  router.use('/split-payments', splitPaymentsRouter);
  router.use('/transfers', transfersRouter);
  router.use('/3ds', threeDSRouter);
  router.use('/merchant-risk', merchantRiskRouter);
  router.use('/chargebacks', chargebacksRouter);

  router.get('/compression/metrics', (_req: Request, res: Response) => {
    res.json(getCompressionMetrics());
  });

  router.get('/pool/metrics', (_req: Request, res: Response) => {
    res.json(poolMetrics.snapshot());
  });

  return router;
}

/** Pre-configured default apiV1Router instance */
export const apiV1Router: Router = createApiV1Router();

// Domain groups for direct access
export const healthRoutes = { healthRouter, coldStartMonitorRouter };
export const authRoutes = { twoFactorAuthRouter, credentialRotationRouter, providerCredentialsRouter };
export const invoiceRoutes = { invoiceRouter, catalogRouter };
export const paymentRoutes = {
  stellarRouter,
  stripeRouter,
  fiatPaymentsRouter,
  transfersRouter,
  recurringBillingRouter,
  splitPaymentsRouter,
  walletPaymentsRouter,
  threeDSRouter,
  chargebacksRouter,
  installmentsRouter,
  paymentStrategiesRouter,
  receiptsRouter,
  paymentLinksRouter,
  fxRouter,
  crossBorderRouter,
  refundsRouter,
  allowancesRouter,
  payoutsRouter,
};
export const webhookRoutes = { webhooksRouter, webhooksDlqRouter, webhookHandlersRouter };
export const complianceRoutes = {
  complianceRouter,
  amlMonitoringRouter,
  sanctionsScreeningRouter,
  pciDssRouter,
  gdprRouter,
  dataExportRouter,
  merchantAuditRouter,
  merchantRiskRouter,
};
export const integrationRoutes = {
  slackRouter,
  githubIntegrationRouter,
  wooCommerceRouter,
  salesforceRouter,
  xeroRouter,
  quickBooksRouter,
  instamojoRouter,
  razorpayRouter,
  pluginsRouter,
};
export const analyticsRoutes = {
  cohortAnalyticsRouter,
  churnPredictionRouter,
  funnelTrackingRouter,
  mlForecastRouter,
  abTestingRouter,
  customerHealthRouter,
  pnlRouter,
  clvRouter,
  paymentMethodAnalyticsRouter,
  cashFlowRouter,
  reportsRouter,
  reconciliationRouter,
  taxReportingRouter,
  taxRouter,
};

export default apiV1Router;
