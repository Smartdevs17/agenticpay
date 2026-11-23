# Worker service tokens and mutual TLS

Calls from the Cloudflare edge worker (`workers/`) to the backend are
authenticated with a short-lived service token bound to the worker's TLS
client certificate (#1474).

Code: [`workers/src/serviceAuth.ts`](../../workers/src/serviceAuth.ts) (minting),
[`backend/src/middleware/serviceAuth.ts`](../../backend/src/middleware/serviceAuth.ts) (verification).

## The token

Each backend call gets its own token in `X-Service-Token`. It is a compact JWS
(`alg: EdDSA`, `typ: svc+jwt`) with these claims:

| Claim | Value |
| --- | --- |
| `iss` | `agenticpay-edge`; must match the service the key is registered for |
| `aud` | `agenticpay-backend` |
| `iat`, `exp` | 60 s lifetime by default; the backend rejects anything over 300 s |
| `jti` | Random ID; each token is accepted once |
| `htm`, `htu` | The HTTP method and path the token was minted for |
| `scope` | Space-separated scopes, limited to the scopes registered for the key |
| `cnf.x5t#S256` | SHA-256 thumbprint of the worker's client certificate (RFC 8705) |

The backend accepts a token only if the connection it arrives on was
authenticated with that same certificate. A stolen token is useless without
the certificate's private key, and only for one request on one path, for at
most five minutes.

The worker signs with an Ed25519 private key. The backend only holds public
keys, so its configuration cannot be used to mint tokens.

Scopes in use:

| Scope | Used for |
| --- | --- |
| `edge:proxy` | Proxied user requests |
| `edge:forward-client-ip` | Lets the backend trust `X-Real-IP` as the end-user's IP (used for per-agent verification quotas) |
| `edge:warmup` | `POST /api/v1/cold-start/warmup`, which requires it |

## Setup

1. **Signing key.**
   `openssl genpkey -algorithm ed25519 -out edge-signing.pem`, then:
   - Worker secret `SERVICE_TOKEN_PRIVATE_KEY`: the base64 PKCS#8 DER,
     `openssl pkey -in edge-signing.pem -outform DER | base64`.
   - Worker secret `SERVICE_TOKEN_KEY_ID`: a key ID such as `edge-2026-11`.
   - Backend `SERVICE_TOKEN_KEYS`: the public key, as JSON:
     ```json
     [{"kid":"edge-2026-11","service":"agenticpay-edge",
       "publicKey":"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
       "scopes":["edge:proxy","edge:forward-client-ip","edge:warmup"]}]
     ```
     Get the public key with `openssl pkey -in edge-signing.pem -pubout`.
2. **Client certificate.** Issue a certificate for the worker from the CA the
   backend's TLS terminator trusts, then:
   - `wrangler mtls-certificate upload --cert edge.pem --key edge-key.pem`, and
     put the returned ID in `workers/wrangler.toml` (`BACKEND_MTLS`).
   - Worker secret `SERVICE_MTLS_CERT_SHA256`: the certificate's SHA-256
     fingerprint, `openssl x509 -in edge.pem -noout -fingerprint -sha256`.
   - Optionally pin it on the backend key with `"certThumbprints": ["<base64url>"]`.
3. **Backend TLS.** Either:
   - terminate TLS in Node with `requestCert: true` and the CA, so
     `req.socket.authorized` is set; or
   - terminate at a proxy that verifies the client certificate and forwards
     it. Set `SERVICE_AUTH_CLIENT_CERT_HEADER` (for example
     `x-ssl-client-cert` for nginx `$ssl_client_escaped_cert`, or a header
     carrying the SHA-256 fingerprint) and `SERVICE_AUTH_CLIENT_VERIFY_HEADER`
     (for example `x-ssl-client-verify`, which must be `SUCCESS`). Set
     `SERVICE_AUTH_TRUSTED_PROXIES` to the proxy addresses. Without it, the
     headers are trusted from any peer, which is only safe if the backend
     cannot be reached except through the proxy.

## Rollout

`SERVICE_AUTH_MODE` controls enforcement:

| Mode | Behaviour |
| --- | --- |
| `off` | Tokens are ignored |
| `optional` (default) | Tokens are verified when present; failures and missing tokens are logged and counted, nothing is rejected |
| `enforce` | A present-but-invalid token gets `401`; `requireServiceToken` routes reject callers without a valid token |

1. Deploy the backend with the keys in `optional` mode.
2. Deploy the worker with its secrets and the `BACKEND_MTLS` binding.
3. Watch the `service-auth` logs and `getServiceTokenVerifier().stats()` until
   every call is `verified`.
4. Switch the backend to `enforce`.

Error codes: `SERVICE_TOKEN_MALFORMED`, `SERVICE_TOKEN_UNKNOWN_KEY`,
`SERVICE_TOKEN_INVALID`, `SERVICE_TOKEN_EXPIRED`,
`SERVICE_TOKEN_TOO_LONG_LIVED`, `SERVICE_TOKEN_WRONG_REQUEST`,
`SERVICE_TOKEN_SCOPE`, `SERVICE_TOKEN_REPLAY`, `SERVICE_TOKEN_UNBOUND`,
`SERVICE_MTLS_REQUIRED`, `SERVICE_MTLS_MISMATCH`, `SERVICE_AUTH_REQUIRED`.

## Key rotation

Add the new public key to `SERVICE_TOKEN_KEYS` next to the old one, switch the
worker's `SERVICE_TOKEN_PRIVATE_KEY` and `SERVICE_TOKEN_KEY_ID`, then remove
the old key (or give it a `notAfter` time). Certificates rotate the same way:
upload the new one, update `SERVICE_MTLS_CERT_SHA256` and any pins.

## Limits

The single-use check (`jti`) is kept per backend instance, so within its
lifetime a token could be replayed once against a different instance. Doing so
still requires the worker's client certificate and the same method and path.
