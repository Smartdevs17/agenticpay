# API Documentation

AgenticPay API docs are generated from Zod schemas and a central route registry.

## Generate locally

```bash
cd backend
npm run openapi:generate
```

Outputs:

- `backend/docs/api/openapi/openapi.json` — OpenAPI 3.1 spec
- `backend/docs/api/postman/` — Postman collection
- `backend/docs/api/sdks/typescript/` — TypeScript client (`openapi-fetch` + generated types)

## Swagger UI

With the backend running:

```http
http://localhost:3001/docs
```

## Authentication

Protected routes require:

```http
Authorization: Bearer <your-api-token>
```

The OpenAPI spec documents `bearerAuth` (JWT) and `apiKeyAuth` (`X-API-Key`) under `components.securitySchemes`.

## CI

- **generate-docs.yml** — Regenerates the spec on `main` when backend routes change; uploads artifacts and optionally commits the spec.
- **benchmarks.yml** — Performance regression gate for the top 10 endpoints.
