# Wallet Payments (Apple Pay & Google Pay)

Issue: [#916](https://github.com/Smartdevs17/agenticpay/issues/916)

Accept Apple Pay and Google Pay at checkout. Merchants register per provider,
verify the domains they will take payments from, then run the standard wallet
flow against a payment session.

## Backend

Service: `backend/src/services/wallet-payments.ts`
Routes: `backend/src/routes/wallet-payments.ts` (mounted at `/api/v1/wallet-payments`)

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/merchants` | Register a merchant for `apple_pay` or `google_pay` |
| `GET` | `/merchants/:merchantId?provider=` | Fetch a merchant configuration |
| `GET` | `/networks/:provider` | Supported card networks for a provider |
| `POST` | `/merchants/:merchantId/domains` | Register a domain (returns a verification token) |
| `POST` | `/merchants/:merchantId/domains/verify` | Verify a domain with the token |
| `POST` | `/sessions` | Create a payment session for the cart amount |
| `GET` | `/sessions/:id` | Read a session (expires stale sessions on read) |
| `POST` | `/sessions/:id/validate` | Apple Pay merchant validation handshake |
| `POST` | `/sessions/:id/process` | Submit the encrypted wallet token and settle |
| `POST` | `/sessions/:id/expire` | Expire a session |

Apple Pay requires a `merchantIdentifier`; Google Pay derives a default. A
session can only be created once the merchant has at least one verified domain.

Wallet token processing validates that the token network is supported by the
provider and that the token has not expired. Failures (unsupported network,
expired token) mark the session `failed` with a `failureReason`.

## Frontend

`frontend/src/components/payments/WalletPayButtons.tsx` renders branded Apple
Pay / Google Pay buttons. Availability is feature-detected
(`ApplePaySession`, `PaymentRequest`) and can be overridden through props for
SSR and tests.

```tsx
<WalletPayButtons
  amount={42.5}
  currency="USD"
  onApplePay={() => pay('apple_pay')}
  onGooglePay={() => pay('google_pay')}
/>
```

## Tests

- `backend/src/services/__tests__/wallet-payments.test.ts`
- `frontend/src/components/payments/__tests__/WalletPayButtons.test.tsx`
