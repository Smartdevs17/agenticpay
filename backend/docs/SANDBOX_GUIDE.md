# Sandbox Environment Guide

## Overview

The AgenticPay sandbox environment provides an isolated testing environment where merchants can test payment flows, API integration, and webhook delivery without using real funds or interacting with the actual blockchain.

## Features

### 1. Sandbox Account Creation with Fake Balance

Create sandbox accounts with pre-funded fake balances for testing.

```bash
POST /api/v1/sandbox/accounts
Content-Type: application/json

{
  "tenantId": "your-tenant-id",
  "name": "Test Merchant",
  "email": "test@merchant.com",
  "walletAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "fakeBalance": 10000,
  "currency": "XLM",
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

### 2. Mock Blockchain Responses

Simulate Stellar blockchain operations without real on-chain costs.

#### Submit a Mock Transaction

```bash
POST /api/v1/sandbox/blockchain/submit
Content-Type: application/json

{
  "fromAddress": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "toAddress": "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "amount": 100,
  "currency": "XLM",
  "memo": "Test payment"
}
```

#### Get Transaction Status

```bash
GET /api/v1/sandbox/blockchain/tx/:txHash
```

#### Fund an Account (Like Friendbot)

```bash
POST /api/v1/sandbox/blockchain/account/:address/fund
Content-Type: application/json

{
  "amount": 10000
}
```

#### Get Account Info

```bash
GET /api/v1/sandbox/blockchain/account/:address
```

#### Get Network Statistics

```bash
GET /api/v1/sandbox/blockchain/stats
```

### 3. Test Data Seeding

Generate realistic test data for comprehensive testing scenarios.

```bash
POST /api/v1/sandbox/testdata/seed
Content-Type: application/json

{
  "users": 10,
  "projects": 20,
  "payments": 50,
  "invoices": 30
}
```

#### Get Seeded Data

```bash
GET /api/v1/sandbox/testdata/users
GET /api/v1/sandbox/testdata/projects
GET /api/v1/sandbox/testdata/statistics
```

#### Clear Test Data

```bash
DELETE /api/v1/sandbox/testdata/clear
```

### 4. Sandbox-to-Production Migration Wizard

Migrate sandbox accounts and transactions to production environment.

#### Start Migration

```bash
POST /api/v1/sandbox/migration/start
Content-Type: application/json

{
  "tenantId": "your-tenant-id",
  "sourceAccountId": "sandbox-account-id",
  "targetUserId": "production-user-id", // optional
  "migrateTransactions": true,
  "dryRun": false
}
```

#### Get Migration Status

```bash
GET /api/v1/sandbox/migration/:migrationId
```

#### List Migrations

```bash
GET /api/v1/sandbox/migration?tenantId=your-tenant-id
```

#### Cancel Migration

```bash
POST /api/v1/sandbox/migration/:migrationId/cancel
```

### 5. Rate Limit Relaxation

Sandbox mode automatically applies relaxed rate limits for testing:

- **Free tier**: 1000 requests/min (vs 60 in production)
- **Pro tier**: 5000 requests/min (vs 300 in production)
- **Enterprise tier**: 20000 requests/min (vs 1200 in production)

The `X-Sandbox-Rate-Limit: relaxed` header indicates relaxed limits are active.

### 6. Periodic Data Cleanup

Automatic cleanup jobs run periodically:

- **Expired Account Cleanup**: Every 6 hours - deactivates expired sandbox accounts
- **Old Data Cleanup**: Daily at 2 AM - deletes data older than 30 days
- **Maintenance Statistics**: Daily at midnight - collects maintenance stats

## Environment Configuration

Set the following environment variables to enable sandbox mode:

```env
NODE_ENV=sandbox
# or
NODE_ENV=development
```

## API Endpoints Summary

### Sandbox Status
- `GET /api/v1/sandbox/status` - Check sandbox mode status
- `GET /api/v1/sandbox/info` - Get sandbox information and available endpoints

### Sandbox Accounts
- `POST /api/v1/sandbox/accounts` - Create sandbox account
- `GET /api/v1/sandbox/accounts/:id` - Get account details
- `GET /api/v1/sandbox/accounts` - List accounts (requires tenantId query param)
- `PATCH /api/v1/sandbox/accounts/:id/balance` - Update account balance
- `DELETE /api/v1/sandbox/accounts/:id` - Delete account

### Mock Blockchain
- `POST /api/v1/sandbox/blockchain/submit` - Submit mock transaction
- `GET /api/v1/sandbox/blockchain/tx/:txHash` - Get transaction status
- `GET /api/v1/sandbox/blockchain/account/:address` - Get account info
- `POST /api/v1/sandbox/blockchain/account/:address/fund` - Fund account
- `GET /api/v1/sandbox/blockchain/stats` - Get network statistics

### Test Data
- `POST /api/v1/sandbox/testdata/seed` - Seed test data
- `GET /api/v1/sandbox/testdata/users` - Get seeded users
- `GET /api/v1/sandbox/testdata/projects` - Get seeded projects
- `GET /api/v1/sandbox/testdata/statistics` - Get statistics
- `DELETE /api/v1/sandbox/testdata/clear` - Clear all test data

### Migration Wizard
- `POST /api/v1/sandbox/migration/start` - Start migration
- `GET /api/v1/sandbox/migration/:id` - Get migration status
- `GET /api/v1/sandbox/migration` - List migrations
- `POST /api/v1/sandbox/migration/:id/cancel` - Cancel migration

### Statistics
- `GET /api/v1/sandbox/stats` - Get tenant statistics

## Testing Workflow

### 1. Create a Sandbox Account

```bash
curl -X POST http://localhost:3001/api/v1/sandbox/accounts \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-123",
    "name": "Test Merchant",
    "email": "test@example.com",
    "walletAddress": "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "fakeBalance": 50000
  }'
```

### 2. Fund the Account

```bash
curl -X POST http://localhost:3001/api/v1/sandbox/blockchain/account/GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ/fund \
  -H "Content-Type: application/json" \
  -d '{"amount": 100000}'
```

### 3. Submit a Mock Transaction

```bash
curl -X POST http://localhost:3001/api/v1/sandbox/blockchain/submit \
  -H "Content-Type: application/json" \
  -d '{
    "fromAddress": "GTEST1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "toAddress": "GRECIPIENT1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "amount": 1000,
    "currency": "XLM"
  }'
```

### 4. Seed Test Data

```bash
curl -X POST http://localhost:3001/api/v1/sandbox/testdata/seed \
  -H "Content-Type: application/json" \
  -d '{
    "users": 5,
    "projects": 10,
    "payments": 20,
    "invoices": 15
  }'
```

### 5. Check Statistics

```bash
curl http://localhost:3001/api/v1/sandbox/stats?tenantId=tenant-123
```

### 6. Migrate to Production (Optional)

```bash
curl -X POST http://localhost:3001/api/v1/sandbox/migration/start \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "tenant-123",
    "sourceAccountId": "sandbox-account-id",
    "migrateTransactions": true,
    "dryRun": true
  }'
```

## Database Schema

### SandboxAccount
- `id`: UUID
- `tenantId`: String
- `userId`: UUID (optional)
- `name`: String
- `email`: String
- `walletAddress`: String (unique)
- `fakeBalance`: Decimal
- `currency`: String (default: XLM)
- `isActive`: Boolean
- `expiresAt`: DateTime (optional)
- `createdAt`: DateTime
- `updatedAt`: DateTime
- `deletedAt`: DateTime (soft delete)

### SandboxTransaction
- `id`: UUID
- `accountId`: UUID
- `txHash`: String (unique)
- `amount`: Decimal
- `currency`: String
- `fromAddress`: String
- `toAddress`: String
- `status`: String
- `type`: String
- `mockData`: JSON
- `confirmedAt`: DateTime
- `createdAt`: DateTime
- `updatedAt`: DateTime
- `deletedAt`: DateTime (soft delete)

### SandboxMigration
- `id`: UUID
- `tenantId`: String
- `sourceAccountId`: String
- `targetAccountId`: String (optional)
- `status`: String
- `steps`: JSON
- `error`: String (optional)
- `startedAt`: DateTime
- `completedAt`: DateTime
- `createdAt`: DateTime
- `updatedAt`: DateTime

## Cleanup and Maintenance

### Manual Cleanup

```bash
# Cleanup expired accounts
# This is done automatically every 6 hours

# Cleanup old data (older than 30 days)
# This is done automatically daily at 2 AM
```

### Disable Sandbox Mode

To disable sandbox mode, set:

```env
NODE_ENV=production
```

## Best Practices

1. **Use descriptive account names** for easier identification
2. **Set expiration dates** on temporary test accounts
3. **Use dry-run mode** when testing migrations
4. **Monitor rate limits** even in sandbox mode (though relaxed)
5. **Clean up test data** after testing sessions
6. **Verify migrations** before applying to production
7. **Use unique wallet addresses** to avoid conflicts

## Troubleshooting

### Sandbox Mode Not Enabled

Check that `NODE_ENV` is set to `sandbox` or `development`.

### Rate Limits Still Strict

Verify that the `X-Sandbox-Rate-Limit: relaxed` header is present in responses.

### Transactions Not Confirming

Mock transactions have a 2-second confirmation delay by default. Check transaction status after waiting.

### Migration Fails

- Verify source account exists and is active
- Check that target user belongs to the same tenant
- Review migration steps for specific error messages
- Try dry-run mode first to validate

## Security Considerations

- Sandbox accounts are isolated from production
- Mock transactions never touch the real blockchain
- Sandbox data is automatically cleaned up
- Rate limits are relaxed but still enforced
- Migration wizard requires explicit confirmation
- All sandbox operations are logged

## Support

For issues or questions about the sandbox environment:
- Check the API documentation
- Review server logs for detailed error messages
- Contact support with tenant ID and migration ID (if applicable)
