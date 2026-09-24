# Blue-green deployment

AgenticPay production uses two equivalent Kubernetes deployments, `agenticpay-blue`
and `agenticpay-green`. The stable `agenticpay` service selects exactly one slot with
the labels `app=agenticpay,color=<slot>`. Each slot also has a preview service named
after its deployment so it can be checked before receiving public traffic.

Run the **Blue-Green Deployment** workflow with an immutable image digest. The workflow
updates only the inactive slot, waits for Kubernetes rollout readiness, checks its
private health endpoint, and atomically changes the stable service selector. If the
optional public health check fails after the switch, traffic is immediately restored
to the previous color. The previous deployment remains available for manual rollback.

Required repository configuration:

- `KUBE_CONFIG_B64` secret with least-privilege access to deployments and services.
- `KUBE_NAMESPACE` variable (defaults to `production`).
- `PRODUCTION_HEALTH_URL` variable for post-switch verification.
- Required reviewers on the GitHub `production` environment.

Validate without changing a cluster:

```bash
scripts/blue-green-deploy.sh --image registry.example/agenticpay@sha256:abc --target green --dry-run
```
