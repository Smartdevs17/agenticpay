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

- [Instant transfers](INSTANT_TRANSFERS.md)
- [Marketplace escrow](MARKETPLACE_ESCROW.md)
- [Payment links](PAYMENT_LINKS.md)
- [Payment provider routing](PAYMENT_ROUTING.md)
- [Payout approvals](PAYOUT_APPROVALS.md)
- [Subscription usage billing](SUBSCRIPTION_USAGE_BILLING.md)
- [Wallet payments](WALLET_PAYMENTS.md)
- [Withdrawal approval security](WITHDRAWAL_SECURITY.md)

## Integrations and SDKs

- [API documentation](API-DOCS.md)
- [SDK overview](sdk/README.md)
- [SDK error handling](sdk/ERROR-HANDLING.md)
- [Webhook signature verification](security/webhook-signatures.md)

## Operations and security

- [Disaster recovery](DISASTER_RECOVERY.md)
- [Logging](logging.md)
- [Security policy](security-policy.md)
- [Audit logging](security/audit-logging.md)
- [Configuration reference](config/CONFIGURATION.md)

## Keeping this index healthy

Run `npm run test:docs` from the repository root after moving or renaming a linked guide. The test checks every local Markdown link on this page and fails when its target does not exist.
