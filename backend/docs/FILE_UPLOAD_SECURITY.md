# Secure file uploads

The upload router is mounted at `/api/v1/uploads`.

- `POST /:category` accepts one multipart file (`kyc`, `dispute`, or `general`).
- `POST /:category/url` accepts JSON with a `url` and optional `filename` and
  `mimeType` fields. The remote upload path follows the same MIME, size, content
  signature, malware scan, polyglot detection, and quarantine checks as multipart
  uploads.

Remote URLs must use HTTP or HTTPS on ports 80 or 443 by default. The service
rejects credentials in URLs, private or reserved IP addresses, hostnames that
resolve to any private address, and redirects that fail those checks. DNS results
are pinned to the outbound connection to prevent a second lookup from changing
the destination. Redirects are checked individually. The response body is
streamed with a per-category byte cap.

The allowed ports, redirect count, and timeout can be configured with
`UPLOAD_FETCH_ALLOWED_PORTS`, `UPLOAD_FETCH_MAX_REDIRECTS`, and
`UPLOAD_FETCH_TIMEOUT_MS`. Defaults are `80,443`, `5`, and `30000` milliseconds.
Keep the upload and quarantine directories writable only by the application
account; accepted files and quarantined files use server-generated names.

URL uploads emit a structured warning for rejected fetches and storage or
validation failures. Logs include the rejection reason and category, not the
remote file contents.
