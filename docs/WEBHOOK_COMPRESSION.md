# Webhook Payload Compression (gzip + streaming JSON)

Implemented under **Issue #1456**.

## Overview

AgenticPay supports opt-in gzip compression for outbound merchant webhook payloads.
By compressing serialized JSON payloads above a configurable threshold (default `1,024` bytes / 1 KiB), egress bandwidth is reduced by 60%–85% on realistic financial events while maintaining full backward compatibility.

## Key Design Principles

1. **Opt-in per Endpoint (Default OFF)**:
   Existing receivers and merchants do not necessarily decompress. Compression is disabled by default (`compressPayloads: false`).
   Endpoints that do not opt in receive the exact same bytes, status codes, and HTTP headers as before.
2. **Signature Covers Uncompressed Canonical JSON**:
   `X-Webhook-Signature` is an HMAC-SHA256 signature calculated over the **uncompressed UTF-8 JSON payload**.
   Because HTTP server frameworks (Express, Fastify, Spring, Flask, etc.) or reverse proxies (Cloudflare, AWS ALB, Envoy) transparently decompress request bodies before routing to request handlers, signing the uncompressed JSON ensures that:
   - Receiver code does not need complex raw-socket interception.
   - Migrating to gzip requires zero changes to the receiver's cryptographic signature verification logic.
   - The header `X-Webhook-Signature-Representation: uncompressed-json` explicitly signals the signed representation.
3. **Outbox & Retry Invariance**:
   Stored delivery logs, outbox queues, and replay mechanisms preserve the uncompressed payload.
   Compression is dynamically applied per transmission attempt. Replays, manual retries, and dead-letter re-drives behave identically.
4. **Fail-Open Fallback**:
   If compression throws an unexpected error, the dispatcher transmits the uncompressed JSON payload. Events are never dropped due to a compression failure.
5. **Observability**:
   Logged fields per delivery include `isCompressed`, `rawBytes`, `compressedBytes`, and `compressionRatio`. No personal data or transaction payload content is logged.

---

## How to Opt In

When registering or updating your webhook endpoint via `POST /api/v1/webhooks/config` or through the developer portal:

```json
{
  "url": "https://merchant.example.com/api/webhooks",
  "secret": "whsec_...",
  "compressPayloads": true,
  "compressionMinBytes": 1024
}
```

---

## Verifying Signatures on Compressed Webhooks

When `Content-Encoding: gzip` is present, the body sent over the wire is a gzip stream.

### Node.js / Express Example
```javascript
import express from 'express';
import crypto from 'crypto';

const app = express();

// Express raw body parser with automatic gzip inflation
app.use(express.json({
  inflate: true, // Automatically inflates gzip-encoded bodies
  verify: (req, _res, buf) => {
    // Store the raw uncompressed body buffer for signature verification
    req.rawBody = buf;
  }
}));

app.post('/api/webhooks', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const secret = process.env.WEBHOOK_SECRET;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('hex');

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    // Verified
    const event = req.body;
    console.log(`Received event: ${event.type}`);
    return res.status(200).json({ received: true });
  }

  return res.status(401).send('Invalid signature');
});
```

### Python / Flask Example
```python
import hmac
import hashlib
import gzip
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/webhooks', methods=['POST'])
def handle_webhook():
    secret = b"whsec_..."
    signature = request.headers.get('X-Webhook-Signature', '')
    encoding = request.headers.get('Content-Encoding', '')

    data = request.get_data()
    # Decompress if gzipped
    if encoding == 'gzip':
        uncompressed_data = gzip.decompress(data)
    else:
        uncompressed_data = data

    # Verify signature over uncompressed JSON bytes
    expected = hmac.new(secret, uncompressed_data, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return ("Invalid signature", 401)

    return jsonify({"received": True})
```

### Go Example
```go
package main

import (
	"bytes"
	"compress/gzip"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
)

func webhookHandler(w http.ResponseWriter, r *http.Request) {
	secret := []byte("whsec_...")
	signature := r.Header.Get("X-Webhook-Signature")

	var bodyBytes []byte
	var err error

	if r.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(r.Body)
		if err != nil {
			http.Error(w, "Decompression error", http.StatusBadRequest)
			return
		}
		defer gz.Close()
		bodyBytes, err = io.ReadAll(gz)
	} else {
		bodyBytes, err = io.ReadAll(r.Body)
	}
	if err != nil {
		http.Error(w, "Read error", http.StatusInternalServerError)
		return
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write(bodyBytes)
	expected := hex.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(signature), []byte(expected)) {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	w.WriteHeader(http.StatusOK)
}
```
