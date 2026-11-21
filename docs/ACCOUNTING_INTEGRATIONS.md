# E-commerce & Accounting Integrations

AgenticPay ships first-party integrations that connect Stellar and fiat payments
to the systems merchants already use:

| Integration | Issue | Purpose |
| ----------- | ----- | ------- |
| WooCommerce | #954 | Turn WooCommerce orders into AgenticPay payments and write settlement status back to the store |
| Salesforce Billing | #955 | Sync AgenticPay invoices and payments into Salesforce Billing |
| Xero | #956 | Sync AgenticPay invoices and payments into Xero Accounting |
| QuickBooks Online | #957 | Sync AgenticPay invoices and payments into QuickBooks |

All four follow the same layout as the existing Zapier/Intercom integrations:
a typed client, a service that owns the business logic, an `index.ts` barrel, a
thin Express router and Vitest unit tests.

---

## WooCommerce

```
backend/src/integrations/woocommerce/
  types.ts                 # order schema (zod), payment draft mapping
  woocommerce-client.ts    # REST API v3 client + webhook signature verification
  woocommerce-service.ts   # payment drafts, webhook handling, status writeback
  __tests__/               # client + service tests
backend/src/routes/woocommerce.ts
```

WooCommerce order → payment draft → AgenticPay payment → status writeback:

```
POST   /api/v1/integrations/woocommerce/orders/:orderId/status
POST   /api/v1/integrations/woocommerce/webhooks   # X-WC-Webhook-Signature
GET    /api/v1/integrations/woocommerce/orders/:orderId/payment-draft
GET    /api/v1/integrations/woocommerce/status
```

The webhook route is mounted behind `webhookJsonParser` so the raw body is
preserved for HMAC-SHA256 verification (`X-WC-Webhook-Signature`,
base64-encoded digest).

```ts
import { wooCommerceService } from './integrations/woocommerce/index.js';

const draft = await wooCommerceService.getPaymentDraft(1001);
// → { reference, orderId, amount, currency, customer, lines, metadata }

const event = wooCommerceService.processWebhook({
  rawBody,                              // raw request body
  signature: req.headers['x-wc-webhook-signature'],
  topic: req.headers['x-wc-webhook-topic'],
});

await wooCommerceService.syncPaymentStatus(1001, 'paid', 'tx_abc');
```

Environment: `WOOCOMMERCE_STORE_URL`, `WOOCOMMERCE_CONSUMER_KEY`,
`WOOCOMMERCE_CONSUMER_SECRET`, `WOOCOMMERCE_WEBHOOK_SECRET`.

---

## Salesforce Billing

```
backend/src/integrations/salesforce/
  types.ts                       # client config + object name mapping
  salesforce-client.ts           # REST API client (SOQL + sObjects)
  salesforce-billing-service.ts  # idempotent account/invoice/payment sync
  __tests__/
backend/src/routes/salesforce.ts
```

```
GET  /api/v1/integrations/salesforce/status
POST /api/v1/integrations/salesforce/invoices/sync
POST /api/v1/integrations/salesforce/payments/sync
```

Records are keyed by an external id field (`External_Id__c` by default) so
repeated syncs update existing records instead of duplicating them. Object
names default to the Salesforce Billing package (`blng__Invoice__c`,
`blng__InvoiceLine__c`, `blng__Payment__c`) and can be overridden per call.

```ts
await salesforceBillingService.syncInvoice({
  externalId: 'inv_123',
  customer: { externalId: 'cus_123', name: 'Acme', email: 'ap@acme.test' },
  currency: 'USD',
  lines: [{ description: 'Platform fee', quantity: 1, unitAmount: 100 }],
});
```

Environment: `SALESFORCE_INSTANCE_URL`, `SALESFORCE_ACCESS_TOKEN`,
`SALESFORCE_API_VERSION`, `SALESFORCE_INVOICE_STATUS`,
`SALESFORCE_ACCOUNT_EMAIL_FIELD`.

---

## Xero

```
backend/src/integrations/xero/
  types.ts          # client config + API entity shapes
  xero-client.ts    # Accounting API client (tenant-scoped)
  xero-service.ts   # contact/invoice/payment sync
  __tests__/
backend/src/routes/xero.ts
```

```
GET  /api/v1/integrations/xero/status
POST /api/v1/integrations/xero/invoices/sync
POST /api/v1/integrations/xero/payments
```

Invoices are matched by their `Reference` (falling back to the external id) and
skipped when they already exist. Payments are submitted with the payment
external id as the Xero `Idempotency-Key`, so retries are safe. A payment
account code is required and validated up front.

```ts
await xeroService.syncInvoice({
  externalId: 'inv_123',
  customer: { externalId: 'cus_123', name: 'Acme', email: 'ap@acme.test' },
  currency: 'USD',
  lines: [{ description: 'Platform fee', quantity: 1, unitAmount: 100 }],
});
```

Environment: `XERO_ACCESS_TOKEN`, `XERO_TENANT_ID`, `XERO_API_URL`,
`XERO_DEFAULT_ACCOUNT_CODE`, `XERO_PAYMENT_ACCOUNT_CODE`, `XERO_INVOICE_STATUS`.

---

## QuickBooks Online

```
backend/src/integrations/quickbooks/
  types.ts                 # client config + API entity shapes
  quickbooks-client.ts     # Accounting API client (realm-scoped)
  quickbooks-service.ts    # customer/invoice/payment sync
  __tests__/
backend/src/routes/quickbooks.ts
```

```
GET  /api/v1/integrations/quickbooks/status
POST /api/v1/integrations/quickbooks/invoices/sync
POST /api/v1/integrations/quickbooks/payments/sync
```

Customers are matched by `DisplayName` and then email. Invoices are matched by
`DocNumber` and skipped when present. Payments are created with the payment
external id as the QuickBooks `requestid`, making retries idempotent, and are
linked to the invoice through `LinkedTxn`.

Environment: `QUICKBOOKS_ACCESS_TOKEN`, `QUICKBOOKS_REALM_ID`,
`QUICKBOOKS_API_URL`, `QUICKBOOKS_DEFAULT_ITEM_ID`.

---

## Shared accounting primitives

The Salesforce, Xero and QuickBooks integrations accept the same normalised
input, defined once in `backend/src/integrations/accounting/types.ts`:

```ts
type AccountingInvoice = {
  externalId: string;
  reference?: string;
  customer: { externalId: string; name: string; email?: string };
  currency: string;          // ISO-4217, defaults to USD
  invoiceDate?: string;
  dueDate?: string;
  lines: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    taxType?: string;
    accountCode?: string;
  }>;
};
```

This means the same payload can be fanned out to every provider without
per-provider translation at the call site.

## Testing

```bash
cd backend
npx vitest run src/integrations/woocommerce src/integrations/salesforce \
  src/integrations/xero src/integrations/quickbooks
```

Each integration covers success and failure paths, including invalid webhook
signatures, missing invoices, and provider API errors.
