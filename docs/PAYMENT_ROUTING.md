# Payment Provider Routing

The provider router selects a payment rail from the requested network first, then from the token or currency. A valid explicit provider preference takes precedence.

## Amount contract

`PaymentInput.amount` must be a finite number greater than zero. The router rejects zero, negative amounts, `NaN`, and positive or negative infinity with HTTP status `400` and code `INVALID_PAYMENT_AMOUNT` before any provider is invoked.

Callers should still format amounts to the precision supported by the selected asset. Provider-specific conversion to on-chain or fiat minor units happens after this shared validation boundary.

## Provider fallback

When a provider returns a failure, the router tries the remaining registered providers in registration order. If every provider fails, it returns `PROVIDER_UNAVAILABLE` with HTTP status `502`.
