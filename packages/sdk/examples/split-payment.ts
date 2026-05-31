/**
 * Runnable example: npx tsx examples/split-payment.ts
 */
import { createAgenticPaySDK } from '../src/index.js';

async function main() {
  const sdk = createAgenticPaySDK({
    baseUrl: process.env.AGENTICPAY_BASE_URL ?? 'http://localhost:3001/api/v1',
    apiKey: process.env.AGENTICPAY_API_KEY!,
  });

  const split = await sdk.payments.createSplitConfig({
    merchantId: 'm_demo',
    platformFeePercentage: 2.5,
    recipients: [
      { recipientId: 'r1', walletAddress: '0xabc', percentage: 60, minimumThreshold: 1 },
      { recipientId: 'r2', walletAddress: '0xdef', percentage: 37.5, minimumThreshold: 1 },
    ],
  });

  console.log('Split config created:', split);
}

main().catch(console.error);
