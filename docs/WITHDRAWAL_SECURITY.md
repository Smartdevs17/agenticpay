# Withdrawal Approval Security

Withdrawals to destinations outside a wallet's allowlist remain in `pending_approval` until the configured approval threshold is met.

## Approver configuration

Configure an explicit, non-empty list of approver IDs for every wallet that can create non-allowlisted withdrawals. Approval and rejection both fail closed when the list is empty, and both reject identities that are not present in the list.

```ts
configureWallet('wallet-1', {
  approvalThreshold: 2,
  approvers: ['finance-user-1', 'finance-user-2'],
});
```

Do not use request-body identity as the authentication mechanism at the API edge. The caller must be authenticated and authorized before its trusted identity is passed to the withdrawal service.

## Destination and velocity controls

Allowlisted destinations may be approved automatically when the configured threshold permits it. Hourly count, hourly amount, and daily amount velocity limits still apply to every destination, including allowlisted ones.
