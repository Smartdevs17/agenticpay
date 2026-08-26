"""Webhook signature verification for the AgenticPay SDK."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any, Dict, Optional, Union


def verify_webhook_signature(
    payload: Union[str, bytes, Dict[str, Any]],
    signature: str,
    secret: str,
    timestamp: Union[str, int],
    tolerance_seconds: int = 300,
) -> bool:
    """Verify an AgenticPay webhook signature.

    Args:
        payload: The raw webhook body (string, bytes, or dict).
        signature: The ``X-Signature`` header value (e.g. ``v1=abc123...``).
        secret: Your webhook signing secret.
        timestamp: The ``X-Timestamp`` header value (Unix seconds).
        tolerance_seconds: Maximum allowed clock skew in seconds (default 300).

    Returns:
        ``True`` if the signature is valid and within the time tolerance.
    """
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False

    now = int(time.time())
    if abs(now - ts) > tolerance_seconds:
        return False

    if isinstance(payload, dict):
        body = json.dumps(payload, separators=(",", ":"))
    elif isinstance(payload, bytes):
        body = payload.decode("utf-8")
    else:
        body = str(payload)

    version = signature.split("=")[0] or "v1"
    digest = hmac.new(
        secret.encode("utf-8"),
        f"{ts}.{body}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    expected = f"{version}={digest}"

    return hmac.compare_digest(signature, expected)
