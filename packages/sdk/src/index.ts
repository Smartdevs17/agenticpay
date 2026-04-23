import { AgenticPayClient } from './client.js';
import { buildAuthHeader, AuthProvider } from './auth.js';
import { PaymentsApi } from './payments.js';
import { RefundsApi } from './refunds.js';
import { VerificationApi } from './verification.js';
import { AgenticPayClientOptions } from './types.js';

export * from './types.js';
export * from './errors.js';
export * from './auth.js';

export class AgenticPaySDK {
  readonly client: AgenticPayClient;
  readonly payments: PaymentsApi;
  readonly refunds: RefundsApi;
  readonly verification: VerificationApi;

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
  }
}

export function createAgenticPaySDK(options: AgenticPayClientOptions, authProvider?: AuthProvider) {
  return new AgenticPaySDK(options, authProvider);
}
