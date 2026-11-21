# Backend Routing Architecture

This directory contains the Express route modules for the AgenticPay backend, organized per domain under Issue #1400.

## Overview & Directory Layout

Routes are split into modular domain files under `backend/src/routes/` and centrally composed via `backend/src/routes/index.ts`. A thin re-export is maintained at `backend/src/routes.ts` for backward compatibility.

```
backend/src/routes/
├── index.ts                     # Central router mounting all v1 routes in preserved sequence
├── README.md                    # This documentation
├── health.ts                    # Health checks and status probes
├── invoice.ts                   # Invoicing and payment requests
├── stellar.ts                   # Stellar network transactions and account status
├── stripe.ts                    # Stripe card payment workflows
├── refunds.ts                   # Refund evaluation and processing
├── splits.ts                    # Split payments and distributions
├── webhooks.ts                  # Webhook subscriptions and deliveries
├── 2fa.ts                       # Two-factor authentication endpoints
├── ...                          # Additional domain modules
└── __tests__/                   # Route unit and characterization tests
```

## Domain Organization

| Domain | Key Route Modules | Description |
|--------|-------------------|-------------|
| **Health & Probes** | `health.ts`, `cold-start-monitor.ts` | Liveness, readiness, dependency checks |
| **Auth & Security** | `2fa.ts`, `auth-lockout.ts`, `credential-rotation.ts`, `signing-keys.ts` | Authentication, MFA, security administration |
| **Payments** | `stellar.ts`, `stripe.ts`, `fiat-payments.ts`, `transfers.ts`, `recurring-billing.ts`, `split-payments.ts`, `wallet-payments.ts`, `3ds.ts`, `chargebacks.ts`, `installments.ts`, `payment-strategies.ts`, `payment-links.ts` | On-chain and off-chain transaction processing |
| **Invoices** | `invoice.ts`, `catalog.ts` | Merchant invoicing, catalog items, pricing |
| **Webhooks** | `webhooks.ts`, `webhooks-dlq.ts`, `webhookHandlers.ts` | Inbound and outbound webhook delivery and retry queues |
| **Compliance** | `compliance.ts`, `aml-monitoring.ts`, `sanctions.ts`, `pci-dss.ts`, `gdpr.ts`, `dataExport.ts`, `merchant-risk.ts` | AML/KYC/KYB, sanctions screening, GDPR data subject rights |
| **Integrations** | `slack.ts`, `github-integration.ts`, `woocommerce.ts`, `salesforce.ts`, `xero.ts`, `quickbooks.ts`, `instamojo.ts`, `razorpay.ts`, `plugins.ts` | External SaaS and commerce connectors |
| **Analytics** | `reports.ts`, `reconciliation.ts`, `tax-reporting.ts`, `pnl.ts`, `clv.ts`, `cohort-analytics.ts`, `cash-flow.ts` | Financial reports, analytics, ML forecasting |

## Registration Order & Middleware Rules

Registration order in Express determines route resolution and middleware execution. In `backend/src/routes/index.ts`:

1. **Exact Order Preservation**: Parameterized routes (e.g. `/status/:id`) must not shadow static paths (e.g. `/status/health`). The registration order in `createApiV1Router` mirrors the historical sequence from `backend/src/index.ts` to ensure zero routing drift.
2. **Path-Specific Middleware**: Rate limiters (e.g. `invoiceLimiter` on `/invoice`) and body parsers (e.g. `webhookJsonParser` on `/api/v1/fiat-payments/webhooks`) are attached before handler dispatch.
3. **Mount Prefixes**: The sub-routers are mounted without their `/api/v1` prefix inside `createApiV1Router()`; the prefix is attached when the router is mounted in the root Express app.

## How to Add a New Route

1. **Locate or Create the Domain Router**:
   - If adding to an existing domain (e.g. payments), open `backend/src/routes/<domain>.ts`.
   - If introducing a new domain, create `backend/src/routes/<domain>.ts` exporting an Express `Router`.
2. **Define Handlers with Validation**:
   - Use Zod schemas from `backend/src/schemas/` for request validation.
   - Use `asyncHandler` from `backend/src/middleware/errorHandler.ts` for async error forwarding.
3. **Register in `backend/src/routes/index.ts`**:
   - Import the router and mount it in `createApiV1Router()`:
     ```ts
     router.use('/my-domain', myDomainRouter);
     ```
   - Export it in the appropriate domain group.
4. **Add Tests**:
   - Add unit tests in `backend/src/routes/__tests__/<domain>.test.ts`.
   - Ensure route-table characterization tests continue to pass.
