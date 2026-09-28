# Kubernetes Deployment Manifests — Issue #840

AgenticPay Kubernetes deployment manifests for production and development environments.

## Architecture

The deployment consists of:
- **Namespace**: Isolated `agenticpay` namespace
- **Deployment**: Backend API service with 3+ replicas
- **Service**: ClusterIP service for internal communication
- **Ingress**: HTTPS ingress with cert-manager
- **HPA**: Horizontal Pod Autoscaling (3-10 replicas based on CPU/Memory)
- **ServiceAccount & RBAC**: Security-isolated service account
- **ConfigMap**: Configuration management
- **Secrets**: Sensitive data (database URLs, API keys)

## Prerequisites

1. Kubernetes cluster (1.24+)
2. Installed: kubectl, Kustomize, Helm
3. Ingress controller (nginx recommended)
4. Cert-manager for TLS
5. Datadog agent (optional, for metrics)

## Installation

### 1. Create Secrets

Edit `secret-template.yaml` with your actual values:

```bash
kubectl create secret generic agenticpay-secrets \
  --from-literal=database-url="postgresql://..." \
  --from-literal=redis-url="redis://..." \
  --from-literal=openai-api-key="sk-..." \
  -n agenticpay
```

### 2. Deploy with Kustomize

```bash
# Review the manifests
kubectl kustomize . | less

# Apply manifests
kubectl apply -k .

# Verify deployment
kubectl get deployments -n agenticpay
kubectl get pods -n agenticpay
kubectl logs -n agenticpay deployment/agenticpay-backend
```

### 3. Customize for Your Environment

Use Kustomize overlays for different environments:

```bash
# Development
kubectl apply -k overlays/dev/

# Staging
kubectl apply -k overlays/staging/

# Production
kubectl apply -k overlays/prod/
```

## Manifest Descriptions

| File | Purpose |
|------|---------|
| `namespace.yaml` | Isolated namespace for AgenticPay |
| `serviceaccount.yaml` | ServiceAccount + RBAC for backend |
| `configmap.yaml` | Non-sensitive configuration |
| `secret-template.yaml` | Template for sensitive data (DO NOT commit values) |
| `backend-deployment.yaml` | Backend pod deployment with health checks |
| `backend-service.yaml` | ClusterIP service for backend |
| `ingress.yaml` | HTTPS ingress with cert-manager |
| `hpa.yaml` | Auto-scaling policy (3-10 replicas) |
| `kustomization.yaml` | Kustomize build configuration |

## Deployment Best Practices

### Security
- ✓ Non-root container user (UID 1000)
- ✓ Read-only root filesystem
- ✓ Dropped Linux capabilities
- ✓ Resource requests/limits defined
- ✓ Pod anti-affinity for high availability

### Observability
- ✓ Prometheus metrics endpoint (:9090/metrics)
- ✓ Liveness & readiness probes
- ✓ Structured logging (stdout/stderr)
- ✓ Datadog agent integration

### Performance
- ✓ Rolling updates (1 surge, 0 unavailable)
- ✓ Pod disruption budgets
- ✓ CPU/Memory based autoscaling
- ✓ Efficient resource requests

## Monitoring & Troubleshooting

### Check Deployment Status
```bash
kubectl get all -n agenticpay
kubectl describe deployment agenticpay-backend -n agenticpay
```

### View Logs
```bash
# Recent logs
kubectl logs -n agenticpay deployment/agenticpay-backend

# Follow logs
kubectl logs -f -n agenticpay deployment/agenticpay-backend

# Logs from specific pod
kubectl logs -n agenticpay pod/agenticpay-backend-xyz
```

### Port Forward for Local Testing
```bash
kubectl port-forward -n agenticpay svc/agenticpay-backend 3000:80
curl http://localhost:3000/health
```

### Scale Manually
```bash
kubectl scale deployment/agenticpay-backend --replicas=5 -n agenticpay
```

## Upgrades & Rollbacks

### Update Deployment
```bash
# Update image tag in kustomization.yaml or use kubectl patch
kubectl set image deployment/agenticpay-backend \
  backend=agenticpay-backend:v1.2.0 \
  -n agenticpay

# Check rollout status
kubectl rollout status deployment/agenticpay-backend -n agenticpay
```

### Rollback
```bash
kubectl rollout undo deployment/agenticpay-backend -n agenticpay
kubectl rollout history deployment/agenticpay-backend -n agenticpay
```

## Cost Optimization

For dev/staging environments, consider:
- Reducing replicas in HPA
- Using spot instances
- Enabling pod disruption budgets
- Setting resource requests to match actual usage

## Integration with Terraform

Use Terraform to provision:
- EKS cluster (`modules/eks/`)
- RDS database (`modules/rds/`)
- ECR registry (`modules/ecr/`)

Then deploy these manifests to the provisioned cluster.

## Support

See issue #840 for implementation details.
