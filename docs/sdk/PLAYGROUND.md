# SDK Playground

The SDK playground is a set of small, runnable examples that exercise the
`@agenticpay/sdk` client against a running API (the sandbox is a good target).

## Examples

| id | Description | Args |
|---|---|---|
| `sandbox-status` | Check sandbox health | none |
| `refund-policy` | Fetch a merchant's refund policy | `<merchantId>` |
| `merchant-splits` | List a merchant's payment splits | `<merchantId>` |
| `verification` | Fetch a work verification | `<verificationId>` |

## Usage

```ts
import { createAgenticPaySDK, getPlaygroundExample, PLAYGROUND_EXAMPLES } from '@agenticpay/sdk';

const sdk = createAgenticPaySDK({ baseUrl: process.env.AGENTICPAY_BASE_URL ?? 'http://localhost:3000/api/v1', apiKey: process.env.AGENTICPAY_API_KEY });

const example = getPlaygroundExample('sandbox-status');
console.log(await example.run(sdk, []));

console.log(PLAYGROUND_EXAMPLES.map((item) => item.id));
```

Unknown example ids and missing arguments throw descriptive errors.
