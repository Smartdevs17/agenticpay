"""Official Python SDK for AgenticPay APIs.

Type-safe client for the AgenticPay payment platform, supporting
escrow, subscriptions, verification, refunds, and Stellar integration.
"""

__version__ = "0.1.0"

from agenticpay.client import AgenticPayClient, ClientConfig
from agenticpay.sdk import AgenticPaySDK, create_agenticpay_sdk
from agenticpay.errors import (
    AgenticPayError,
    AuthenticationError,
    AuthorizationError,
    ValidationError,
    RateLimitError,
    NetworkError,
    NotFoundError,
)
from agenticpay.auth import AuthProvider, build_auth_header
from agenticpay.webhooks import verify_webhook_signature

__all__ = [
    "AgenticPayClient",
    "ClientConfig",
    "AgenticPaySDK",
    "create_agenticpay_sdk",
    "AgenticPayError",
    "AuthenticationError",
    "AuthorizationError",
    "ValidationError",
    "RateLimitError",
    "NetworkError",
    "NotFoundError",
    "AuthProvider",
    "build_auth_header",
    "verify_webhook_signature",
]
