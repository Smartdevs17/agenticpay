# AgenticPay Documentation

Use this page as the entry point for the repository's maintained guides. API-specific implementation notes live in [`backend/docs`](../backend/docs/).

## Start here

- [Local development with the dev container](DEVCONTAINER.md)
- [Architecture overview](architecture.md)
- [API overview](api.md)
- [Deployment guide](deployment.md)
- [Troubleshooting](troubleshooting.md)
- [Contributing](../CONTRIBUTING.md)

## Payments and billing

- [Chargeback management](CHARGEBACK_MANAGEMENT.md)
- [Instant transfers](INSTANT_TRANSFERS.md)
- [Marketplace escrow](MARKETPLACE_ESCROW.md)
- [Merchant risk tiering](MERCHANT_RISK_TIERING.md)
- [Nano (XNO) settle rail](NANO_SETTLE_RAIL.md)
- [Payment links](PAYMENT_LINKS.md)
- [Payment correctness](PAYMENT_CORRECTNESS.md)
- [Payment provider routing](PAYMENT_ROUTING.md)
- [Payout approvals](PAYOUT_APPROVALS.md)
- [Payout idempotency](PAYOUT_IDEMPOTENCY.md)
- [Payout reliability](PAYOUT_RELIABILITY.md)
- [Subscription usage billing](SUBSCRIPTION_USAGE_BILLING.md)
- [Multi-currency balances](MULTI_CURRENCY_BALANCES.md)
- [Wallet payments](WALLET_PAYMENTS.md)
- [Withdrawal approval security](WITHDRAWAL_SECURITY.md)

## Integrations and SDKs

- [API documentation](API-DOCS.md)
- [SDK overview](sdk/README.md)
- [SDK error handling](sdk/ERROR-HANDLING.md)
- [Payment and payout security](security/payment-security.md)
- [Webhook signature verification](security/webhook-signatures.md)

## Operations and security

- [Disaster recovery](DISASTER_RECOVERY.md)
- [Logging](logging.md)
- [Security policy](security-policy.md)
- [Audit logging](security/audit-logging.md)
- [Provider credentials encryption](security/provider-credentials-encryption.md)
- [AML transaction monitoring](AML_TRANSACTION_MONITORING.md)
- [Sanctions screening](SANCTIONS_SCREENING.md)
- [PCI DSS compliance dashboard](PCI_DSS_DASHBOARD.md)
- [Configuration reference](config/CONFIGURATION.md)

## Keeping this index healthy

Run `npm run test:docs` from the repository root after moving or renaming a linked guide. The test checks every local Markdown link on this page and fails when its target does not exist.
