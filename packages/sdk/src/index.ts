import { AgenticPayClient } from './client.js';
import { buildAuthHeader, AuthProvider } from './auth.js';
import { PaymentsApi } from './payments.js';
import { RefundsApi } from './refunds.js';
import { VerificationApi } from './verification.js';
import { SubscriptionsApi } from './subscriptions.js';
import { InvoicesApi } from './invoices.js';
import { EscrowApi, DisputesApi } from './escrow.js';
import { StellarApi } from './stellar.js';
import { SandboxApi } from './sandbox.js';
import { AgenticPayClientOptions } from './types.js';
export { AgenticPayWebSocket } from './websocket.js';
export type { SdkWebSocketOptions, MessageHandler } from './websocket.js';

export * from './types.js';
export * from './errors.js';
export * from './auth.js';
export * from './webhooks/verifier.js';

// Re-export sub-module types
export type {
  SubscriptionPlan,
  Subscription,
  SubscriptionStatus,
  SubscriptionInterval,
  CreatePlanInput,
  CreateSubscriptionInput,
  CancelSubscriptionInput,
  PauseSubscriptionInput,
} from './subscriptions.js';

export type {
  Invoice,
  InvoiceStatus,
  GenerateInvoiceInput,
} from './invoices.js';

export type {
  Escrow,
  EscrowStatus,
  EscrowMilestone,
  CreateEscrowInput,
  FundEscrowInput,
  Dispute,
  DisputeStatus,
  CreateDisputeInput,
  DisputeResponseInput,
  DisputeResolveInput,
} from './escrow.js';

export type {
  StellarTransaction,
  StellarPayment,
  StellarNetwork,
} from './stellar.js';

export type {
  SandboxStatus,
  SandboxPaymentInput,
  SandboxPaymentResult,
} from './sandbox.js';

export type {
  ApiResponse,
  CurrencyCode,
  DomainEvent,
  DomainEventType,
  Merchant,
  PaginatedResult,
  Payment,
  Project,
  StoredEvent,
  Transaction,
  UUID,
} from '@agenticpay/types';

export type * as AgenticPayTypes from '@agenticpay/types';

export class AgenticPaySDK {
  readonly client: AgenticPayClient;
  readonly payments: PaymentsApi;
  readonly refunds: RefundsApi;
  readonly verification: VerificationApi;
  readonly subscriptions: SubscriptionsApi;
  readonly invoices: InvoicesApi;
  readonly escrow: EscrowApi;
  readonly disputes: DisputesApi;
  readonly stellar: StellarApi;
  readonly sandbox: SandboxApi;

  constructor(options: AgenticPayClientOptions, authProvider?: AuthProvider) {
    this.client = new AgenticPayClient(options);
    if (authProvider) {
      this.client.addRequestInterceptor(async (ctx) => {
        const token = await authProvider.getAccessToken();
        return {
          ...ctx,
          headers: {
            ...ctx.headers,
            ...buildAuthHeader(token),
          },
        };
      });
    }

    this.payments = new PaymentsApi(this.client);
    this.refunds = new RefundsApi(this.client);
    this.verification = new VerificationApi(this.client);
    this.subscriptions = new SubscriptionsApi(this.client);
    this.invoices = new InvoicesApi(this.client);
    this.escrow = new EscrowApi(this.client);
    this.disputes = new DisputesApi(this.client);
    this.stellar = new StellarApi(this.client);
    this.sandbox = new SandboxApi(this.client);
  }
}

export function createAgenticPaySDK(options: AgenticPayClientOptions, authProvider?: AuthProvider) {
  return new AgenticPaySDK(options, authProvider);
}
