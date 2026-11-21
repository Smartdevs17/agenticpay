# Sandbox Environment Guide

## Overview

The AgenticPay Sandbox provides a complete testing environment for API development without requiring real transactions on the blockchain.

## Quick Start

### 1. Setup Sandbox

```bash
bash scripts/setup-sandbox.sh
```

This will:
- Create sandbox directories
- Copy environment template
- Install dependencies
- Generate API documentation

### 2. Configure Environment

Edit `.env.sandbox`:

```bash
cp .env.sandbox.example .env.sandbox
```

Key settings:
- `SANDBOX_MODE=true` - Enable sandbox features
- `FAKE_PAYMENTS_ENABLED=true` - Use mock payment processing
- `TEST_DATA_SEEDING_ENABLED=true` - Generate test data
- `MOCK_WEBHOOKS_ENABLED=true` - Simulate webhook delivery

### 3. Start Services

**Backend:**
```bash
cd backend
npm run dev
```

**Frontend (in another terminal):**
```bash
cd frontend
npm run dev
```

**API is now available at:** `http://localhost:3000/api/v1`

## Sandbox Features

### Mock Payments

Process payments without Stellar transactions:

```bash
curl -X POST http://localhost:3000/api/v1/sandbox/payments/process \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj-123",
    "clientAddress": "GCLIENT...",
    "freelancerAddress": "GFREELANCER...",
    "amount": 100,
    "currency": "XLM",
    "delay": 1000
  }'
```

**Response:**
```json
{
  "success": true,
  "payment": {
    "transactionId": "mock_1234567890_abc123",
    "status": "success",
    "timestamp": 1234567890
  }
}
```

### Test Data Generation

Seed realistic test data:

```bash
curl -X POST http://localhost:3000/api/v1/sandbox/testdata/seed \
  -H "Content-Type: application/json" \
  -d '{
    "users": 10,
    "projects": 20,
    "payments": 50,
    "invoices": 30
  }'
```

**Response:**
```json
{
  "success": true,
  "seeded": {
    "userCount": 10,
    "projectCount": 20,
    "paymentCount": 50,
    "invoiceCount": 30
  }
}
```

### Generate Testnet Wallets

Create test wallets without funding:

```bash
curl -X POST http://localhost:3000/api/v1/sandbox/wallets/generate
```

**Response:**
```json
{
  "wallet": {
    "address": "GXXXXXXXXX...",
    "seed": "SXXXXXXXXX...",
    "publicKey": "GXXXXXXXXX...",
    "privateKey": "SXXXXXXXXX..."
  },
  "environment": "testnet",
  "fundingUrl": "https://friendbot.stellar.org/?addr=GXXXXXXXXX..."
}
```

### Mock Webhooks

Simulate webhook delivery:

```bash
curl -X POST http://localhost:3000/api/v1/sandbox/webhooks/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "event": "payment.completed",
    "data": {
      "projectId": "proj-123",
      "amount": 100,
      "status": "success"
    },
    "webhookUrl": "https://your-webhook-url.com/hook"
  }'
```

### Query Test Data

List generated test data:

```bash
# Get all users
curl http://localhost:3000/api/v1/sandbox/testdata/users

# Get all projects
curl http://localhost:3000/api/v1/sandbox/testdata/projects

# Get statistics
curl http://localhost:3000/api/v1/sandbox/testdata/statistics

# Clear all sandbox data
curl -X DELETE http://localhost:3000/api/v1/sandbox/testdata/clear
```

## API Playground

Interactive API explorer available at:
- **Swagger UI:** http://localhost:3000/docs
- **OpenAPI Spec:** http://localhost:3000/docs/openapi.json

Try API endpoints directly in the browser without writing code!

## Environment Variables

### Sandbox-Specific

```bash
# Enable sandbox mode
SANDBOX_MODE=true

# Features
FAKE_PAYMENTS_ENABLED=true
MOCK_WEBHOOKS_ENABLED=true
TEST_DATA_SEEDING_ENABLED=true

# Logging
SANDBOX_LOG_WEBHOOKS=true
LOG_LEVEL=debug

# Rate limiting (relaxed in sandbox)
RATE_LIMIT_ENABLED=false
```

### Testnet Configuration

```bash
STELLAR_NETWORK=testnet
STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
```

## Common Workflows

### Workflow 1: Test Invoice Generation

1. Seed test data:
```bash
curl -X POST http://localhost:3000/api/v1/sandbox/testdata/seed \
  -H "Content-Type: application/json" \
  -d '{"projects": 5}'
```

2. Generate invoice:
```bash
curl -X POST http://localhost:3000/api/v1/invoice/generate \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj-id",
    "workDescription": "Development work",
    "hoursWorked": 10,
    "hourlyRate": 50
  }'
```

### Workflow 2: Test Payment Processing

1. Generate testnet wallet:
```bash
curl -X POST http://localhost:3000/api/v1/sandbox/wallets/generate
```

2. Process mock payment:
```bash
curl -X POST http://localhost:3000/api/v1/sandbox/payments/process \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "proj-123",
    "clientAddress": "GCLIENT...",
    "freelancerAddress": "GFREELANCER...",
    "amount": 100
  }'
```

3. Check payment status:
```bash
curl http://localhost:3000/api/v1/sandbox/payments/mock_1234567890_abc123
```

### Workflow 3: Test Batch Verification

1. Seed test data
2. Batch verify submissions:
```bash
curl -X POST http://localhost:3000/api/v1/verification/verify/batch \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "verifications": [
      {"projectId": "proj-1", "status": "approved"},
      {"projectId": "proj-2", "status": "rejected"}
    ]
  }'
```

## Troubleshooting

### Sandbox Mode Not Working

Check environment variables:
```bash
curl http://localhost:3000/api/v1/sandbox/status
```

If you get 403, sandbox is disabled. Update `.env.sandbox`:
```bash
SANDBOX_MODE=true
```

### Test Data Not Persisting

Sandbox data is in-memory by default. It will clear on server restart.

To persist test data, configure a local database:
```bash
DATABASE_URL=postgresql://user:password@localhost:5432/agenticpay_sandbox
```

### Webhook Simulation Fails

Enable mock webhooks in `.env.sandbox`:
```bash
MOCK_WEBHOOKS_ENABLED=true
SANDBOX_LOG_WEBHOOKS=true
```

## Best Practices

1. **Isolation:** Always use sandbox for development
2. **Data:** Seed fresh test data between test runs
3. **Cleanup:** Clear sandbox data when done (`DELETE /sandbox/testdata/clear`)
4. **Logging:** Enable webhook logging for debugging (`SANDBOX_LOG_WEBHOOKS=true`)
5. **Documentation:** Keep `.env.sandbox.example` up to date

## Next Steps

- Explore API endpoints in Swagger UI
- Review auto-generated SDKs in `backend/docs/api/sdks/`
- Check OpenAPI specification: `backend/docs/api/openapi/openapi.json`
- Read full API docs: `backend/docs/api/INDEX.md`

## Support

- 📖 Full documentation: https://docs.agenticpay.com
- 🐛 Issue tracker: https://github.com/Smartdevs17/agenticpay/issues
- 💬 Discussion: https://github.com/Smartdevs17/agenticpay/discussions
