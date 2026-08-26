/**
 * Runnable example: npx tsx examples/getting-started.ts
 * Requires AGENTICPAY_API_KEY and optional AGENTICPAY_BASE_URL
 */
import { createAgenticPaySDK } from '../src/index.js';

async function main() {
  const sdk = createAgenticPaySDK({
    baseUrl: process.env.AGENTICPAY_BASE_URL ?? 'http://localhost:3001/api/v1',
    apiKey: process.env.AGENTICPAY_API_KEY ?? 'test_key',
  });

  const health = await fetch(
    (process.env.AGENTICPAY_BASE_URL ?? 'http://localhost:3001').replace(/\/api\/v1$/, '') + '/health',
  );
  console.log('API health:', health.status);

  console.log('SDK ready:', typeof sdk.payments.createSplitConfig === 'function');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
