# Payment Adapters — Issue #766

AgenticPay supports multiple payment providers through a pluggable adapter architecture.

## Architecture

Payment adapters implement a common interface for:
- Payment initialization
- Fund escrow/release
- Transaction status checking
- Settlement and reconciliation

## Adapter Interface

```typescript
// src/adapters/PaymentAdapter.ts
export interface PaymentAdapter {
  name: string;
  version: string;
  
  // Initialize payment
  initiate(params: PaymentInitParams): Promise<PaymentResult>;
  
  // Release escrowed funds
  release(escrowId: string, amount: number): Promise<TransactionResult>;
  
  // Check transaction status
  getStatus(transactionId: string): Promise<TransactionStatus>;
  
  // Settlement
  settle(batchId: string): Promise<SettlementResult>;
  
  // Reconciliation
  reconcile(startDate: Date, endDate: Date): Promise<ReconciliationReport>;
}
```

## Supported Adapters

### Stellar Network (Native)

Production adapter using Soroban smart contracts for XLM and Stellar token escrow.

```typescript
import { StellarAdapter } from './adapters/stellar.js';
const stellar = new StellarAdapter();
```

### Stripe

Payment processing for card payments and transfers.

```typescript
import { StripeAdapter } from './adapters/stripe.js';
const stripe = new StripeAdapter(apiKey);
```

## Tencent SkillHub Pay Adapter — Issue #766

**Status**: Documentation/Specification

### Overview

The Tencent SkillHub Pay adapter enables integration with Tencent Cloud's payment infrastructure for AI agent skill marketplace workflows.

### Use Cases

- **Paid AI Skill Workflows**: Enable users to purchase access to premium AI skills
- **Agent Payment Services**: Process payments for autonomous agent service execution
- **Skill Marketplace**: Monetize AI skill templates and workflows
- **Payment State Management**: Track fulfillment and settlement

### Architecture

```typescript
interface TencentSkillHubPayAdapter extends PaymentAdapter {
  // Tencent-specific methods
  authorizeSkillPurchase(skillId: string, userId: string): Promise<PaymentToken>;
  resolvePaymentState(paymentId: string): Promise<FulfillmentStatus>;
  processAgentPayment(agentId: string, amount: number): Promise<TransactionId>;
}
```

### Configuration

```typescript
// .env
TENCENT_SKILLHUB_SECRET_ID=your_secret_id
TENCENT_SKILLHUB_SECRET_KEY=your_secret_key
TENCENT_SKILLHUB_REGION=ap-shanghai
```

### Integration Points

#### 1. Skill Marketplace Payment Flow

```
User Purchase → Tencent Pay → Escrow → Skill Access → Settlement
```

#### 2. Agent Service Payment

```
Trigger Agent → Calculate Fee → Tencent Charge → Execute → Release Payment
```

#### 3. Payment State Tracking

```typescript
const state = await tencent.resolvePaymentState(paymentId);
// Returns: pending | processing | completed | failed | refunded
```

### Settlement & Fulfillment

- **Settlement**: Daily/weekly automated settlement to merchant accounts
- **Fulfillment**: Skill access granted after payment confirmation
- **Reconciliation**: Automated transaction reconciliation with Tencent

### Error Handling

```typescript
try {
  const result = await tencent.authorizeSkillPurchase(skillId, userId);
} catch (error) {
  if (error.code === 'PAYMENT_FAILED') {
    // Handle payment failure
  } else if (error.code === 'SKILL_NOT_FOUND') {
    // Handle missing skill
  }
}
```

## Implementing a New Adapter

### Step 1: Create Adapter Class

```typescript
// src/adapters/TencentAdapter.ts
import { PaymentAdapter, PaymentInitParams, PaymentResult } from './PaymentAdapter.js';

export class TencentAdapter implements PaymentAdapter {
  name = 'tencent-skillhub';
  version = '1.0.0';

  async initiate(params: PaymentInitParams): Promise<PaymentResult> {
    // Implementation
  }

  async release(escrowId: string, amount: number) {
    // Implementation
  }

  async getStatus(transactionId: string) {
    // Implementation
  }

  async settle(batchId: string) {
    // Implementation
  }

  async reconcile(startDate: Date, endDate: Date) {
    // Implementation
  }
}
```

### Step 2: Register Adapter

```typescript
// src/adapters/index.ts
import { TencentAdapter } from './TencentAdapter.js';

export const adapters = {
  stellar: new StellarAdapter(),
  stripe: new StripeAdapter(),
  tencent: new TencentAdapter(), // Add here
};
```

### Step 3: Use in Routes

```typescript
// src/routes/payments.ts
import { adapters } from '../adapters/index.js';

router.post('/pay/tencent', async (req, res) => {
  const result = await adapters.tencent.initiate(req.body);
  res.json(result);
});
```

## Provider Documentation

- [Tencent Cloud Payments](https://cloud.tencent.com/product/payment)
- [Stellar Network](https://developers.stellar.org/)
- [Stripe](https://stripe.com/docs)

## See Also

- [Adapter Pattern](https://refactoring.guru/design-patterns/adapter)
- [Payment Processing Best Practices](https://stripe.com/docs/payments)
