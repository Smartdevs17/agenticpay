# Stripe webhook signing secret rotation

`constructWebhookEvent` verifies the raw request body with the current
`STRIPE_WEBHOOK_SECRET` and, when configured, the prior secret in
`STRIPE_WEBHOOK_SECRET_PREVIOUS`. It accepts the event when either verification
succeeds. Secret values are never included in logs. Successful verification with
the previous secret emits a warning so the overlap can be monitored.

## Zero downtime procedure

1. In Stripe Workbench, open the webhook endpoint and choose **Roll secret**.
   Keep the old secret active during the overlap (Stripe supports up to seven
   days and sends a signature for each active secret).
2. Store the newly generated secret in your secret manager as
   `STRIPE_WEBHOOK_SECRET`, and move the old value to
   `STRIPE_WEBHOOK_SECRET_PREVIOUS`.
3. Deploy the configuration to all application instances. Requests signed with
   either secret continue to pass while old and new instances overlap.
4. Watch for `Stripe webhook verified with previous signing secret` warnings.
   Once these stop and Stripe's overlap expires, remove
   `STRIPE_WEBHOOK_SECRET_PREVIOUS` and deploy again.

For an emergency rotation after compromise, expire the old secret immediately,
deploy only the replacement secret, and expect requests signed with the old
secret to be rejected. Do not put either secret in source control or log output.

Stripe documents that a rolled endpoint can have multiple active secrets during
the overlap, and emits one `v1` signature per active secret. This handler uses
Stripe's official SDK verification for each configured secret and accepts the
event only when a signature verifies.
