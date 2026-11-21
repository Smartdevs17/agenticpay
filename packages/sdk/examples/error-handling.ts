/**
 * Runnable example: npx tsx examples/error-handling.ts
 */
import { createAgenticPaySDK, RateLimitError, AgenticPayError } from '../src/index.js';

async function main() {
  const sdk = createAgenticPaySDK({
    baseUrl: process.env.AGENTICPAY_BASE_URL ?? 'http://localhost:3001/api/v1',
    apiKey: 'invalid_key_for_demo',
  });

  try {
    await sdk.payments.getSplitConfig('nonexistent');
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.log('Rate limited', err.details);
    } else if (err instanceof AgenticPayError) {
      console.log('API error:', err.code, err.status, err.message);
    } else {
      console.log('Unexpected:', err);
    }
  }
}

main();
