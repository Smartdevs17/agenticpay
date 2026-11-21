# API Versioning

The AgenticPay backend supports multiple versions to ensure backward compatibility for our clients.

## Current Versions
- **v1**: Active

## Version Negotiation

API versioning can be done in two ways:

1. **URL-based (Recommended)**
   You can explicitly specify the API version in the URL path:
   `GET /api/v1/health`

2. **Header-based or media type versioning**
   You can omit the version from the URL and provide it via the `API-Version`, `X-API-Version`, or `Accept-Version` headers. You can also version requests through `Content-Type` or `Accept` media type versioning.
   `GET /api/health`
   `API-Version: 1`
   `Content-Type: application/vnd.agenticpay.v1+json`
   `Content-Type: application/json; version=1`

All responses include an `X-API-Version` header indicating the API version that processed the request.

## Version Lifecycle
- **Active**: The latest, fully supported version.
- **Deprecated**: Planned for removal. Will include a `Deprecation: true` header in the response. Clients should migrate as soon as possible.
- **Unsupported**: The version has been removed. Requests will return a `404 Not Found` with an `UNSUPPORTED_API_VERSION` error.
