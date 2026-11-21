# AgenticPay Error Codes

All API errors use:

```json
{
  "error": {
    "code": "ERR_VALIDATION_FAILED",
    "message": "Request validation failed",
    "details": {},
    "requestId": "req_..."
  }
}
```

The live registry is available at `GET /api/errors`.

| Code | Category | HTTP | Resolution |
| --- | --- | ---: | --- |
| `ERR_AUTH_UNAUTHENTICATED` | auth | 401 | Send a valid bearer token or API key and retry. |
| `ERR_AUTH_FORBIDDEN` | auth | 403 | Check account permissions, tenant access, and API key scopes. |
| `ERR_VALIDATION_FAILED` | validation | 400 | Inspect `details` and send values matching the OpenAPI schema. |
| `ERR_RESOURCE_NOT_FOUND` | validation | 404 | Verify the URL, API version, path parameters, and resource identifier. |
| `ERR_CONFIG_INVALID_VALUE` | configuration | 400 | Check the configuration schema before updating the value. |
| `ERR_CONFIG_CONFLICT` | configuration | 409 | Reload the latest configuration and retry with the current version. |
| `ERR_PAYMENT_INSUFFICIENT_FUNDS` | payment | 402 | Add funds or choose a smaller amount. |
| `ERR_BLOCKCHAIN_TRANSACTION_FAILED` | blockchain | 502 | Review provider details, network health, and retry if appropriate. |
| `ERR_RATE_LIMIT_EXCEEDED` | rate_limit | 429 | Back off until the reset time or request a higher tier. |
| `ERR_INTERNAL` | internal | 500 | Retry later and contact support with the request ID if it persists. |
