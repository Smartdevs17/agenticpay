# OpenAPI 3.1 Documentation — Issue #720

AgenticPay uses **OpenAPI 3.1.0** for comprehensive API documentation and automated SDK generation.

## Overview

- **Spec Version**: OpenAPI 3.1.0
- **Auto-generation**: TSOA (TypeScript OpenAPI)
- **Location**: `backend/docs/api/openapi/`
- **Formats**: JSON and YAML

## Generating OpenAPI Spec

```bash
cd backend
npm run openapi:generate
```

This generates:
- `docs/api/openapi/openapi.json`
- `docs/api/openapi/swagger.json`

## SDK Generation

Automated SDKs are generated from the OpenAPI 3.1 spec:

### TypeScript/JavaScript
```bash
npm run sdk:generate
```
Output: `packages/sdk/generated/typescript/`

### Python
```bash
npm run sdk:generate:python
```
Output: `packages/sdk/generated/python/`

### Go
```bash
npm run sdk:generate:go
```
Output: `packages/sdk/generated/go/`

## API Endpoint Documentation

All endpoints are self-documenting via OpenAPI decorators. Route handlers use TSOA decorators:

```typescript
import { Route, Get, Tags } from 'tsoa';

@Route('api/v1/health')
@Tags('Health')
export class HealthController {
  @Get('/')
  health() {
    return { status: 'ok' };
  }
}
```

## OpenAPI 3.1 Features

- **Request/Response Schemas**: Fully typed via Zod and TypeScript
- **Authentication**: Security schemes (Bearer tokens, API keys)
- **Server Definitions**: Development and production URLs
- **Component Reuse**: Shared schemas and responses
- **Examples**: Request/response examples for each endpoint

## Validation

```bash
npm run openapi:validate
```

Ensures the generated spec conforms to OpenAPI 3.1 standards.

## See Also

- [OpenAPI 3.1 Spec](https://spec.openapis.org/oas/v3.1.0)
- [TSOA Documentation](https://tsoa-community.github.io/docs/)
