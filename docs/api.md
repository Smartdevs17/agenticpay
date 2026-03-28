# API Documentation

GET /catalog/
Description: Retrieve the current catalog of items.
Request: None
Response (200 OK):
[
  {
    "id": "string",
    "name": "string",
    "price": 0
  }
]

GET /health
Description: Check service health status including dependencies.
Response (200 OK / 503 Service Unavailable):
{
  "status": "healthy|degraded|unhealthy",
  "service": "agenticpay-backend",
  "timestamp": "2026-03-26T07:00:00.000Z",
  "uptime": 12345.67,
  "dependencies": {
    "stellar": "healthy|unhealthy",
    "openai": "healthy|unhealthy",
    "scheduler": "healthy|unhealthy"
  },
  "latency_ms": 123
}

GET /ready
Description: Kubernetes readiness probe.
Response (200 OK):
{
  "status": "ready",
  "timestamp": "2026-03-26T07:00:00.000Z"
}

POST /invoice/generate
Description: Generate AI-powered invoice.
Request Body:
{
  "projectId": "string",
  "workDescription": "string",
  "hoursWorked": 10,
  "hourlyRate": 50
}
Response (200 OK):
{
  "invoiceId": "string",
  "projectId": "string",
  "total": 500,
  "details": "Invoice details"
}
Errors:
- 400 VALIDATION_ERROR – Missing required fields

GET /jobs/
Description: Retrieve all scheduled job statuses.
Response (200 OK):
{
  "jobs": [
    {
      "id": "string",
      "status": "pending|running|completed|failed",
      "lastRun": "2026-03-26T07:00:00.000Z"
    }
  ]
}

GET /stellar/account/:address
Description: Get Stellar account information.
Path Parameters:
- address – Stellar account address
Response (200 OK):
{
  "address": "string",
  "balances": [
    {
      "asset": "XLM",
      "amount": "100.0"
    }
  ]
}
Errors:
- 400 – InvalidStellarInputError
- 500 – Failed to fetch account info

GET /stellar/tx/:hash
Description: Get Stellar transaction status.
Path Parameters:
- hash – Transaction hash
Response (200 OK):
{
  "hash": "string",
  "status": "pending|success|failed",
  "ledger": 12345
}
Errors:
- 400 – InvalidStellarInputError
- 500 – Failed to fetch transaction

POST /verification/verify
Description: AI-powered work verification.
Request Body:
{
  "repositoryUrl": "string",
  "milestoneDescription": "string",
  "projectId": "string"
}
Response (200 OK):
{
  "verificationId": "string",
  "status": "passed|failed|pending",
  "score": 85,
  "summary": "Verification summary"
}

POST /verification/verify/batch
Description: Bulk verification of work.
Request Body:
{
  "items": [
    {
      "repositoryUrl": "string",
      "milestoneDescription": "string",
      "projectId": "string"
    }
  ]
}
Response (200 OK):
{
  "results": [
    { "index": 0, "status": "success", "data": {} },
    { "index": 1, "status": "error", "error": "Missing required fields" }
  ]
}

PATCH /verification/batch
Description: Bulk update verification results.
Request Body:
{
  "items": [
    {
      "id": "string",
      "status": "passed|failed|pending",
      "score": 90,
      "summary": "Updated summary",
      "details": ["detail1", "detail2"]
    }
  ]
}
Response (200 OK):
{
  "results": [
    { "index": 0, "status": "success", "data": {} },
    { "index": 1, "status": "error", "error": "Missing verification id" }
  ],
  "updatedCount": 1
}

DELETE /verification/batch
Description: Bulk delete verification results.
Request Body:
{
  "ids": ["string", "string"]
}
Response (200 OK):
{
  "results": [
    { "id": "string", "status": "deleted" },
    { "id": "string", "status": "not_found" }
  ],
  "deletedCount": 1
}

GET /verification/:id
Description: Get verification result by ID.
Response (200 OK):
{
  "verificationId": "string",
  "status": "passed|failed|pending",
  "score": 85,
  "summary": "Verification summary"
}
Errors:
- 404 – Verification not found